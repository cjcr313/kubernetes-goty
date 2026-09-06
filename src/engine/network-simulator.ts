/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Motor del Datapath — el corazón de kubernetes-goty.
 *
 * Dado (request, estado del clúster, stack de red activo) produce la lista
 * ordenada de "saltos" (hops) que sufre un paquete, con capa, componente
 * kernel, operaciones (DNAT/ENCAP/BPF-LOOKUP/...) y latencia sintética.
 *
 * Combinaciones soportadas:
 *   CNI:     flannel (vxlan | host-gw) · cilium (native | tunnel) ·
 *            calico (ipip | bgp) · aws-vpc-cni
 *   Proxy:   iptables (KUBE-SERVICES→KUBE-SVC→KUBE-SEP, lineal) ·
 *            ipvs (hash O(1)) · none-ebpf (Cilium kube-proxy replacement)
 *   DNS:     CoreDNS + NodeLocal cache + ndots configurable
 *   Edge:    ingress-nginx · Gateway API (Envoy / Istio ambient) ·
 *            LB/NodePort directo
 *
 * Modelo de latencia 100% sintético pero pedagógicamente correcto:
 * iptables escala O(nº servicios), IPVS y eBPF son ~O(1).
 * ─────────────────────────────────────────────────────────────────────────────
 */
import type {
  ClusterState,
  CniConfig,
  DnsQueryAttempt,
  EdgeStack,
  Endpoint,
  KubeService,
  NetworkPolicyResource,
  PacketHop,
  PacketTrace,
  Pod,
  ProxyMode,
  StackConfig,
  TrafficRequest,
  TraceOutcome,
} from '@/domain/types';
import { resolveDns } from './dns-resolver';
import { hash32, mulberry32 } from '@/lib/rng';

// ── Constantes del modelo sintético ─────────────────────────────────────────
const IPTABLES_BASE_RULES = 180;    // cadenas base del sistema
const RULES_PER_SERVICE = 4;        // KUBE-SVC-* + KUBE-SEP-* promedio
const US_PER_RULE = 8;              // µs por regla recorrida (lineal)
const UNDERLAY_MS = 0.35;           // tránsito físico entre nodos
const VXLAN_ENCAP_MS = 0.06;
const UPSTREAM_EDGE_MS = 0.9;       // internet → CDN/LB

export function iptablesRuleCount(cluster: ClusterState): number {
  const svcs = cluster.services.length + cluster.syntheticServiceCount;
  const seps = cluster.services.reduce((a, s) => a + s.endpoints.length, 0);
  return IPTABLES_BASE_RULES + svcs * RULES_PER_SERVICE + seps;
}

/** Costo del lookup de service IP según el proxy activo. */
export function serviceLookupLatencyMs(cluster: ClusterState, proxy: ProxyMode): number {
  if (proxy === 'iptables') return (iptablesRuleCount(cluster) * US_PER_RULE) / 1000;
  if (proxy === 'ipvs') return 0.02 + Math.log(1 + cluster.services.length) * 0.001;
  return 0.004; // eBPF map lookup
}

function chainHash(id: string): string {
  return hash32(id).toString(16).toUpperCase().padEnd(8, '0').slice(0, 8);
}

export function proxyLabel(proxy: ProxyMode): string {
  switch (proxy) {
    case 'iptables': return 'kube-proxy · iptables';
    case 'ipvs': return 'kube-proxy · IPVS';
    case 'none-ebpf': return 'Cilium eBPF (sin kube-proxy)';
  }
}

export function cniLabel(cni: CniConfig): string {
  switch (cni.plugin) {
    case 'flannel': return `flannel (${cni.flannel.backend})`;
    case 'cilium': return `cilium (${cni.cilium.tunnel === 'disabled' ? 'native routing' : 'tunnel/vxlan'}${cni.cilium.kubeProxyReplacement ? ', kube-proxy replacement' : ''})`;
    case 'calico': return `calico (${cni.calico.encapsulation})`;
    case 'aws-vpc-cni': return 'aws-vpc-cni (VPC nativo)';
  }
}

export function edgeLabel(edge: EdgeStack): string {
  switch (edge) {
    case 'none': return 'sin ingress';
    case 'ingress-nginx': return 'Ingress NGINX';
    case 'gateway-envoy': return 'Gateway API · Envoy';
    case 'gateway-istio-ambient': return 'Gateway API · Istio ambient';
  }
}

// ═══════════════════════════ TRACE ═══════════════════════════

export function tracePacket(
  req: TrafficRequest,
  cluster: ClusterState,
  stack: StackConfig
): PacketTrace {
  const rand = mulberry32(hash32(req.id));
  const hops: PacketHop[] = [];
  const annotations: string[] = [];
  let totalMs = 0;
  let idx = 0;

  const push = (
    layer: PacketHop['layer'],
    node: string,
    component: string,
    detail: string,
    ops: PacketHop['ops'] = [],
    latencyMs = 0
  ) => {
    hops.push({ index: idx++, layer, node, component, detail, ops, latencyMs });
    totalMs += latencyMs;
  };

  const srcPod = resolveSourcePod(cluster, req);
  const srcNodeName = srcPod?.nodeName ?? '(internet)';

  let outcome: TraceOutcome = 'DELIVERED';
  let dnsQueries: DnsQueryAttempt[] | undefined;
  let targetService: KubeService | undefined;
  let chosenPod: Pod | undefined;

  // ── 1) Origen ────────────────────────────────────────────────────────────
  push(
    'client',
    srcNodeName,
    srcPod ? `socket() @ ${srcPod.name}` : `Cliente externo → ${req.destination.name}`,
    srcPod
      ? `Aplicación en ${srcPod.namespace}/${srcPod.name} abre conexión hacia "${req.destination.name}"`
      : 'Usuario final iniciando request HTTP',
    ['ROUTE'],
    0.01
  );

  // ── 2) DNS (todo tráfico desde pods que usa nombres) ────────────────────
  if (req.source.kind === 'pod') {
    const dnsPenalty = serviceLookupLatencyMs(cluster, stack.proxy);
    const res = resolveDns(
      req.destination.name,
      req.source.namespace,
      cluster,
      stack.dns,
      dnsPenalty
    );
    dnsQueries = res.queries;
    push(
      'dns',
      srcNodeName,
      stack.dns.nodeLocalCache ? 'NodeLocal DNSCache (169.254.20.10)' : 'CoreDNS (ClusterIP kube-dns)',
      `ndots:${stack.dns.ndots} → ${res.queries.length} consulta(s): ${res.queries
        .map((q) => `${shorten(q.qname)}=${q.outcome}`)
        .join(', ')}`,
      res.queries.some((q) => q.outcome === 'UPSTREAM') ? ['DNS-QUERY', 'DNS-UPSTREAM'] : ['DNS-QUERY', 'DNS-HIT'],
      res.latencyMs
    );

    if (req.destination.kind === 'external-url') {
      // destino externo: egress del clúster hacia internet
      annotations.push(`DNS externo: ${shorten(req.destination.name)} → respuesta de upstream`);
      push('L3', srcNodeName, 'route lookup → default route', 'La IP de destino no pertenece a podCIDR ni serviceCIDR: el kernel usa la ruta por defecto del nodo', ['ROUTE'], 0.02);
      if (stack.proxy === 'none-ebpf') {
        push('kernel', srcNodeName, 'Cilium BPF SNAT (masquerade)', 'Programa BPF reescribe la IP origen del pod por la IP del nodo: sin iptables POSTROUTING', ['SNAT'], 0.04);
      } else {
        push('L4', srcNodeName, 'iptables · POSTROUTING (masquerade)', 'SNAT: la IP del pod (10.244.x.x) se reemplaza por la IP del nodo para salir a internet', ['SNAT'], 0.05);
      }
      push('return', 'internet', `upstream ${shorten(req.destination.name)}`, 'Request HTTP hacia el servidor externo; la respuesta vuelve por la conexión SNAT-eada', ['FORWARD'], 2.5);
      return finish();
    }

    if (!res.resolved) {
      outcome = 'DNS-Failure';
      return finish();
    }
    targetService = res.targetService;
    if (targetService?.clusterIP) {
      annotations.push(`DNS: ${shorten(req.destination.name)} → ${targetService.clusterIP}`);
    }
  }

  // ── 3) Entrada por el edge (cliente externo) ────────────────────────────
  if (req.source.kind === 'external-client') {
    const host = req.destination.name;
    push('edge', '(internet)', 'CDN / Cloud LoadBalancer', 'Terminación TLS y anycast hacia el clúster', ['FORWARD'], UPSTREAM_EDGE_MS);

    if (stack.edge === 'ingress-nginx') {
      const hit = cluster.ingresses
        .flatMap((ing) => ing.rules.map((r) => ({ ing, r })))
        .find(({ r }) => r.host === host);
      if (!hit) {
        outcome = 'NO-ROUTE';
        push('edge', 'ingress-nginx', 'default server → 404', `Ninguna regla Ingress matchea Host "${host}"`, ['RULE-MATCH'], 0.01);
        return finish();
      }
      push(
        'edge',
        'ingress-nginx',
        `Ingress ${hit.ing.name} · ${hit.r.host}${hit.r.path}`,
        'match Host/Path → upstream. NGINX mantiene keepalive connections a los upstreams; los reloads (SIGHUP) drenan workers y recrean conexiones.',
        ['RULE-MATCH'],
        0.12
      );
      targetService = cluster.services.find(
        (s) => s.name === hit.r.serviceName && s.namespace === hit.r.serviceNamespace
      );
    } else if (stack.edge === 'gateway-envoy' || stack.edge === 'gateway-istio-ambient') {
      const route = cluster.httpRoutes.find((r) => r.hostnames.includes(host));
      if (!route) {
        outcome = 'NO-ROUTE';
        push('edge', 'envoy', 'no route matched → 404', `Ningún HTTPRoute declara hostname "${host}"`, ['RULE-MATCH'], 0.01);
        return finish();
      }
      const dataPlane = stack.edge === 'gateway-envoy' ? 'Envoy Gateway' : 'Istio ambient (ztunnel L4 + waypoint L7)';
      const weights = route.rules[0]?.backends ?? [];
      if (weights.length > 1) {
        // selección ponderada estilo canary 90/10
        const total = weights.reduce((a, b) => a + b.weight, 0);
        let roll = rand() * total;
        let picked = weights[0];
        for (const b of weights) {
          roll -= b.weight;
          if (roll <= 0) { picked = b; break; }
        }
        annotations.push(
          `Canary split: ${weights.map((b) => `${b.name}=${b.weight}%`).join(' / ')} → elegido ${picked.name}`
        );
        push(
          'edge',
          'envoy',
          `HTTPRoute ${route.name} · weighted backend`,
          `${dataPlane}: route match + balanceo por peso (${total} puntos). El filtro decide el backend por request, sin regenerar configuración.`,
          ['RULE-MATCH', 'WEIGHTED-SPLIT', 'LB-SELECT'],
          0.05
        );
        const fault = route.rules[0]?.faultInjection;
        if (fault && picked.name.includes('v2') && rand() * 100 < fault.percentage) {
          push('edge', 'envoy', 'fault injection filter', `HTTP ${fault.httpStatus} inyectado (${fault.percentage}% del tráfico a ${picked.name})`, ['FAULT-INJECT'], 0.01);
          outcome = 'FAULT-500';
          return finish();
        }
        targetService = cluster.services.find((s) => s.name === picked.name && s.namespace === picked.namespace);
      } else {
        push('edge', 'envoy', `HTTPRoute ${route.name}`, `${dataPlane}: route match → backend único`, ['RULE-MATCH'], 0.05);
        const b = weights[0];
        targetService = cluster.services.find((s) => s.name === b.name && s.namespace === b.namespace);
      }
    } else {
      // sin ingress: solo services de tipo LoadBalancer / NodePort exponen
      targetService = cluster.services.find(
        (s) => s.name === req.destination.name && s.namespace === (req.destination.namespace ?? 'default')
      );
      if (targetService?.type === 'LoadBalancer') {
        push('edge', '(internet)', `Service LB (${targetService.externalIP ?? 'cloud-LB'})`, 'Proveedor de cloud crea el balanceador externo (1 IP pública, health-checks a NodePorts)', ['FORWARD'], 0.4);
      } else if (targetService?.type === 'NodePort') {
        push('edge', cluster.nodes[0]?.name ?? 'node', `NodePort :${targetService.nodePort ?? 30000}`, 'Cualquier nodo acepta el tráfico en el puerto alto del service', ['FORWARD'], 0.3);
      } else if (targetService) {
        outcome = 'NO-ROUTE';
        push('edge', '—', 'sin entrada externa', 'El Service es ClusterIP y no hay Ingress/Gateway: el paquete no tiene por dónde entrar al clúster', ['DROP'], 0);
        return finish();
      }
    }
    if (!targetService) {
      outcome = 'NO-ROUTE';
      return finish();
    }
    annotations.push(`Edge: ${edgeLabel(stack.edge)}`);
  }

  // ── 4) Traducción de Service (DNAT) según proxy ─────────────────────────
  if (outcome === 'DELIVERED' && targetService) {
    if (!targetService.clusterIP && targetService.type !== 'Headless') {
      outcome = 'NO-ENDPOINTS';
      return finish();
    }
    const readyEndpoints = targetService.endpoints.filter((e) => e.ready);
    if (readyEndpoints.length === 0) {
      outcome = 'NO-ENDPOINTS';
      push('L4', srcNodeName, `${targetService.name} sin endpoints`, 'El selector no matchea ningún pod en Running: el ClusterIP es una IP virtual sin destino (connection refused / timeout)', ['DROP'], 0);
      return finish();
    }
    const ep = pickEndpoint(targetService, readyEndpoints, srcPod?.id ?? req.id);
    chosenPod = cluster.pods.find((p) => p.id === ep.podId);
    annotations.push(
      `${targetService.name}.${targetService.namespace} (${targetService.clusterIP ?? 'headless'}) → endpoint ${ep.ip}:${ep.port}`
    );

    switch (stack.proxy) {
      case 'iptables': {
        const svcChain = `KUBE-SVC-${chainHash(targetService.id)}`;
        const sepChain = `KUBE-SEP-${chainHash(ep.podId)}`;
        const lookupMs = serviceLookupLatencyMs(cluster, stack.proxy);
        push('L4', srcNodeName, 'iptables · PREROUTING (nat)', `conntrack → mangle → nat: el paquete entra a la cadena KUBE-SERVICES y se evalúan las reglas UNA A UNA (${iptablesRuleCount(cluster).toLocaleString('en-US')} reglas en el clúster)`, ['ROUTE'], lookupMs);
        push('L4', srcNodeName, svcChain, `match dst=${targetService.clusterIP}:${targetService.port} → salto a ${svcChain}`, ['RULE-MATCH'], 0.005);
        push('L4', srcNodeName, `${svcChain} → ${sepChain}`, `statistic --mode random --probability 1/${readyEndpoints.length}: balanceo probabilístico dentro de la cadena`, ['LB-SELECT'], 0.005);
        push('L4', srcNodeName, `${sepChain} · DNAT`, `DNAT a ${ep.ip}:${ep.port} — la IP virtual desaparece del paquete`, ['DNAT'], 0.005);
        break;
      }
      case 'ipvs': {
        push('L4', srcNodeName, 'IPVS · tabla hash', `ip_vs: lookup O(1) de ${targetService.clusterIP}:${targetService.port} en la hash table del kernel (scheduler rr/least-conn)`, ['BPF-LOOKUP', 'LB-SELECT'], serviceLookupLatencyMs(cluster, stack.proxy));
        push('L4', srcNodeName, 'IPVS · DNAT', `DNAT a ${ep.ip}:${ep.port} — conntrack registra la conexión`, ['DNAT'], 0.004);
        break;
      }
      case 'none-ebpf': {
        push('kernel', srcNodeName, 'Cilium eBPF @ veth ingress', `Programa BPF (tail-call) consulta el mapa de servicios en el kernel: lookup O(1), sin conntrack ni iptables. KUBE-SERVICES ya no existe.`, ['BPF-LOOKUP', 'LB-SELECT', 'DNAT'], serviceLookupLatencyMs(cluster, stack.proxy));
        break;
      }
    }
  }

  // ── 5) Encaminamiento hacia el pod (CNI datapath) ───────────────────────
  if (outcome === 'DELIVERED' && chosenPod) {
    const sameNode = chosenPod.nodeName === srcNodeName;
    if (sameNode) {
      push('L3', srcNodeName, 'ruta local host → veth', `El pod destino vive en el mismo nodo: frame entregado por el bridge/switch del host al veth pair de ${chosenPod.name}`, ['FORWARD'], 0.04);
    } else {
      pushCniPath(push, cluster, stack, srcNodeName, chosenPod, annotations);
    }
  }

  // ── 6) NetworkPolicy enforcement ────────────────────────────────────────
  if (outcome === 'DELIVERED' && chosenPod) {
    const verdict = evaluateNetworkPolicies(srcPod, chosenPod, cluster.networkPolicies, stack);
    if (!verdict.allowed) {
      push('kernel', verdict.enforcedAt, verdict.component, verdict.reason, ['DROP'], 0);
      outcome = 'POLICY-DENIED';
      annotations.push(`NetworkPolicy DROP: ${verdict.policyName}`);
      return finish();
    }
    if (verdict.checked) {
      push('kernel', verdict.enforcedAt, verdict.component, verdict.reason, ['POLICY-CHECK', 'ACCEPT'], 0.002);
    }
  }

  // ── 7) Entrega + retorno ────────────────────────────────────────────────
  if (outcome === 'DELIVERED' && chosenPod) {
    push('pod', chosenPod.nodeName, `veth pair → eth0 @ ${chosenPod.name}`, `El frame cruza el veth y entra al network namespace del pod. La app responde desde ${chosenPod.podIP}`, ['ACCEPT'], 0.02);
    push('return', chosenPod.nodeName, 'camino de retorno', 'La respuesta sigue la entrada de conntrack/BPF invertida: un-DNAT y route de vuelta hacia el origen', ['SNAT'], 0.02);
  }

  return finish();

  function finish(): PacketTrace {
    const jitter = 0.8 + rand() * 0.4; // ±20% para percentiles realistas
    return {
      id: `trace-${req.id}`,
      requestId: req.id,
      createdAtTick: cluster.tick,
      request: req,
      hops,
      dnsQueries,
      outcome,
      totalLatencyMs: Math.round(totalMs * jitter * 1000) / 1000,
      chosenPod: chosenPod?.name,
      targetServiceId: targetService?.id,
      annotations,
    };
  }
}

// ═══════════════════════════ CNI hops ═══════════════════════════

type PushFn = (layer: PacketHop['layer'], node: string, component: string, detail: string, ops: PacketHop['ops'], latencyMs?: number) => void;

function pushCniPath(
  push: PushFn,
  cluster: ClusterState,
  stack: StackConfig,
  srcNodeName: string,
  dstPod: Pod,
  annotations: string[]
): void {
  const cni = stack.cni;
  const dstNode = cluster.nodes.find((n) => n.name === dstPod.nodeName);
  const dstSubnet = dstNode?.podCIDR.split('/')[0] ?? '10.244.0.0';

  switch (cni.plugin) {
    case 'flannel': {
      if (cni.flannel.backend === 'vxlan') {
        const overheadB = 50;
        annotations.push(`VXLAN: +${overheadB}B de cabeceras → MTU efectivo ${stack.mtu - overheadB}`);
        push('L3', srcNodeName, 'route lookup', `${dstSubnet}/24 dev flannel.1 — el kernel decide encapsular`, ['ROUTE'], 0.01);
        push('L3', srcNodeName, 'flannel.1 · VXLAN encap', `Outer UDP dst-port 8472 (IP del nodo ${dstPod.nodeName}): MAC+IP+UDP+VXLAN headers se apilan sobre el paquete original`, ['ENCAP'], VXLAN_ENCAP_MS);
        push('L3', 'underlay', `red física de nodos`, `UDP overlay viaja por la underlay (latencia física entre nodos)`, ['FORWARD'], UNDERLAY_MS);
        push('L3', dstPod.nodeName, 'flannel.1 · VXLAN decap', `El nodo destino desencapsula y recupera el frame original con src=IP pod origen`, ['DECAP'], 0.03);
        push('L3', dstPod.nodeName, 'cni0 bridge → veth', `El bridge del nodo entrega el frame al veth pair del pod`, ['FORWARD'], 0.03);
      } else {
        annotations.push('host-gw: sin encapsulación, rutas L2 estáticas por nodo');
        push('L3', srcNodeName, 'route lookup (host-gw)', `${dstSubnet}/24 via ${dstNode?.internalIP ?? 'gw'} dev eth0 — ruta plana agregada por flannel, sin túnel`, ['ROUTE'], 0.01);
        push('L3', 'underlay', 'L2/L3 nativo entre nodos', 'El paquete viaja intacto: cero overhead de MTU, pero exige L2 alcanzable entre nodos', ['FORWARD'], UNDERLAY_MS);
        push('L3', dstPod.nodeName, 'cni0 bridge → veth', 'Entrega directa al veth del pod', ['FORWARD'], 0.03);
      }
      break;
    }
    case 'cilium': {
      if (cni.cilium.tunnel === 'disabled') {
        annotations.push('Cilium native routing: sin encapsular, eBPF en ambos extremos');
        push('L3', srcNodeName, 'eBPF direct routing', `BPF (tc/tcx) en el veth del host: lookup de ruta nativo hacia ${dstSubnet}/24 — el paquete NUNCA se encapsula`, ['BPF-LOOKUP', 'ROUTE'], 0.02);
        push('L3', 'underlay', 'ruteo nativo entre nodos', 'Paquete original íntegro por la red física (requiere rutas/BNP entre CIDRs de pod)', ['FORWARD'], UNDERLAY_MS);
        push('kernel', dstPod.nodeName, 'BPF @ veth ingress destino', 'Programa BPF del lado receptor: policy check + map lookup en el mismo hook, sin re-recorrer iptables del host', ['BPF-LOOKUP', 'FORWARD'], 0.01);
      } else {
        push('L3', srcNodeName, 'cilium_vxlan · encap', 'Túnel VXLAN gestionado por Cilium con maps BPF para el overlay', ['ENCAP'], VXLAN_ENCAP_MS);
        push('L3', 'underlay', 'UDP overlay', 'Tránsito por la underlay', ['FORWARD'], UNDERLAY_MS);
        push('kernel', dstPod.nodeName, 'cilium_vxlan · decap + BPF', 'Desencapsulado y policy check en el mismo pase BPF', ['DECAP', 'BPF-LOOKUP'], 0.02);
      }
      break;
    }
    case 'calico': {
      if (cni.calico.encapsulation === 'ipip') {
        annotations.push('IPIP: +20B (IP-in-IP proto 4)');
        push('L3', srcNodeName, 'tunl0 · IP-in-IP encap', `Cabecera IP extra con dst=${dstNode?.internalIP}: enrutamiento por túnel`, ['ENCAP'], VXLAN_ENCAP_MS);
        push('L3', 'underlay', 'underlay', 'Paquete IPIP entre nodos', ['FORWARD'], UNDERLAY_MS);
        push('L3', dstPod.nodeName, 'tunl0 · decap', 'Desencapsulado y entrega al veth', ['DECAP'], 0.03);
      } else {
        annotations.push('Calico BGP: rutas distribuidas sin túnel');
        push('L3', srcNodeName, 'BGP route', `Sesión BGP entre nodos anuncia ${dstSubnet}/24: ruta nativa, sin overhead`, ['ROUTE'], 0.01);
        push('L3', 'underlay', 'ruteo BGP nativo', 'Paquete íntegro por la underlay', ['FORWARD'], UNDERLAY_MS);
        push('L3', dstPod.nodeName, 'veth directo', 'Entrega al pod', ['FORWARD'], 0.03);
      }
      break;
    }
    case 'aws-vpc-cni': {
      annotations.push('aws-vpc-cni: cada pod tiene una IP real de la VPC (ENI secundaria)');
      push('L3', srcNodeName, 'VPC native routing', `La IP del pod (${dstPod.podIP}) ES una IP de VPC asignada a una ENI del nodo: routing nativo de AWS, cero túneles`, ['ROUTE'], 0.01);
      push('L3', 'underlay', 'fabric de la VPC (ENI)', 'El hipervisor de AWS_SWITCH entrega el paquete a la ENI del pod', ['FORWARD'], UNDERLAY_MS * 0.8);
      break;
    }
  }
}

// ═══════════════════════════ Endpoint selection ═══════════════════════════

function pickEndpoint(svc: KubeService, endpoints: Endpoint[], clientKey: string): Endpoint {
  if (svc.sessionAffinity === 'ClientIP') {
    // sticky: mismo cliente → mismo endpoint
    return endpoints[hash32(clientKey) % endpoints.length];
  }
  return endpoints[Math.floor(Math.random() * endpoints.length) % endpoints.length];
}

// ═══════════════════════════ NetworkPolicy evaluation ═══════════════════════════

interface PolicyVerdict {
  allowed: boolean;
  checked: boolean;
  reason: string;
  enforcedAt: string;
  component: string;
  policyName?: string;
}

function matchesSelector(selector: Record<string, string>, labels: Record<string, string>): boolean {
  return Object.entries(selector).every(([k, v]) => labels[k] === v);
}

/**
 * Semántica simplificada pero fiel: si alguna policy con tipo Ingress
 * selecciona al pod destino, se vuelve default-deny para ingreso salvo
 * que una regla `from` acepte explícitamente al origen.
 */
export function evaluateNetworkPolicies(
  srcPod: Pod | undefined,
  dstPod: Pod,
  policies: NetworkPolicyResource[],
  stack: StackConfig
): PolicyVerdict {
  const isEbpf = stack.cni.plugin === 'cilium';
  const enforcedAt = isEbpf ? dstPod.nodeName : dstPod.nodeName;
  const component = isEbpf
    ? 'Cilium policy map @ veth (L3/L4)'
    : 'iptables · POD-INGRESS chain (netns del pod)';
  const hookDetail = isEbpf
    ? 'El veredicto vive en un BPF map consultado por el programa cargado en el veth: el drop ocurre en el mismo hook de ingress, sin recorrer cadenas'
    : 'El drop ocurre en las cadenas iptables dentro del netns / FORWARD del host';

  const applicable = policies.filter(
    (p) =>
      p.namespace === dstPod.namespace &&
      p.policyTypes.includes('Ingress') &&
      matchesSelector(p.podSelector, dstPod.labels)
  );
  if (applicable.length === 0) {
    return { allowed: true, checked: false, reason: 'Sin policies que seleccionen al pod', enforcedAt, component };
  }

  for (const policy of applicable) {
    const hasAllowRule = policy.ingressRules.some((rule) =>
      (rule.from ?? []).some((peer) => {
        if (!srcPod && peer.ipBlock) return peer.ipBlock.cidr.includes('0.0.0.0');
        if (!srcPod) return false;
        if (peer.podSelector) {
          return srcPod.namespace === policy.namespace && matchesSelector(peer.podSelector, srcPod.labels);
        }
        return false;
      })
    );
    if (!hasAllowRule) {
      return {
        allowed: false,
        checked: true,
        policyName: policy.name,
        reason: `Policy "${policy.name}" aísla a ${dstPod.name}: el origen ${srcPod?.name ?? 'externo'} no matchea ningún peer permitido. ${hookDetail}`,
        enforcedAt,
        component,
      };
    }
  }
  return {
    allowed: true,
    checked: true,
    reason: `Policy aplicada y origen permitido por regla from. ${hookDetail}`,
    enforcedAt,
    component,
  };
}

function shorten(s: string): string {
  return s.length > 42 ? `${s.slice(0, 39)}...` : s;
}

/** Resuelve el pod origen de un request (acepta pod-id, pod-name o "ns/workload"). */
export function resolveSourcePod(cluster: ClusterState, req: TrafficRequest): Pod | undefined {
  if (req.source.kind !== 'pod') return undefined;
  const ref = req.source.ref;
  const direct = cluster.pods.find((p) => p.id === ref || p.name === ref);
  if (direct) return direct;
  if (ref.includes('/')) {
    const [ns, wlName] = ref.split('/');
    return (
      cluster.pods.find(
        (p) => p.namespace === ns && p.owner?.name === wlName && p.status === 'Running'
      ) ??
      cluster.pods.find((p) => p.namespace === ns && p.owner?.name === wlName)
    );
  }
  return undefined;
}
