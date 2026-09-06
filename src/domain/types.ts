/**
 * ─────────────────────────────────────────────────────────────────────────────
 * kubernetes-goty · Domain Model
 * Esquemas de estado del clúster + modelo de trazas de paquetes.
 * Capa pura: sin imports de UI ni de engine. Todo lo demás depende de esto.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ══════════════════════════ Clúster base ══════════════════════════

export type K8sVersion = 'v1.28' | 'v1.29' | 'v1.30' | 'v1.31' | 'v1.32';
export type NodeRole = 'control-plane' | 'worker';

export interface KubeNode {
  id: string;
  name: string;
  role: NodeRole;
  internalIP: string;
  podCIDR: string;
  cpuMillis: number;
  memoryMi: number;
  status: 'Ready' | 'NotReady';
  /** contador interno para asignar IPs de pod dentro del CIDR del nodo */
  podIpCounter: number;
}

export type PodPhase =
  | 'Pending'
  | 'ContainerCreating'
  | 'Running'
  | 'CrashLoopBackOff'
  | 'Terminating';

export type WorkloadKind = 'Deployment' | 'StatefulSet' | 'DaemonSet';

export interface Resources {
  cpuMillis: number;
  memoryMi: number;
}

export interface ResourceRequirements {
  requests?: Resources;
  limits?: Resources;
}

export interface Container {
  name: string;
  image: string;
  port?: number;
  resources: ResourceRequirements;
  env: Record<string, string>;
}

export interface Pod {
  id: string;
  name: string;
  namespace: string;
  nodeName: string;
  status: PodPhase;
  podIP?: string;
  labels: Record<string, string>;
  containers: Container[];
  cpuUsageMillis: number;
  memUsageMi: number;
  restarts: number;
  createdAtTick: number;
  owner?: { kind: WorkloadKind; name: string };
}

export interface Workload {
  id: string;
  name: string;
  namespace: string;
  kind: WorkloadKind;
  replicas: number;
  labels: Record<string, string>;
  template: { containers: Container[] };
}

// ══════════════════════════ Services & endpoints ══════════════════════════

export type ServiceType = 'ClusterIP' | 'NodePort' | 'LoadBalancer' | 'Headless';

export interface Endpoint {
  podId: string;
  ip: string;
  port: number;
  ready: boolean;
}

export interface KubeService {
  id: string;
  name: string;
  namespace: string;
  type: ServiceType;
  clusterIP?: string; // undefined solo en Headless
  nodePort?: number;
  externalIP?: string;
  selector: Record<string, string>;
  port: number;
  targetPort: number;
  sessionAffinity: 'None' | 'ClientIP';
  internalTrafficPolicy: 'Cluster' | 'Local';
  endpoints: Endpoint[];
}

// ══════════════════════════ Ingress & Gateway API ══════════════════════════

export interface IngressRule {
  host: string;
  path: string;
  serviceName: string;
  serviceNamespace: string;
  servicePort: number;
}

export interface IngressResource {
  id: string;
  name: string;
  namespace: string;
  className: string;
  rules: IngressRule[];
}

export interface HTTPRouteBackendRef {
  name: string;
  namespace: string;
  port: number;
  weight: number;
}

export interface FaultInjection {
  httpStatus: number;
  percentage: number; // 0–100
}

export interface HTTPRouteRule {
  matches: { path?: string }[];
  backends: HTTPRouteBackendRef[];
  faultInjection?: FaultInjection;
}

export interface HTTPRouteResource {
  id: string;
  name: string;
  namespace: string;
  gatewayName: string;
  hostnames: string[];
  rules: HTTPRouteRule[];
}

// ══════════════════════════ HPA ══════════════════════════

export interface HpaSpec {
  scaleTargetRef: { kind: WorkloadKind; name: string };
  minReplicas: number;
  maxReplicas: number;
  targetCpuPercent: number;
}

export interface HpaResource {
  id: string;
  name: string;
  namespace: string;
  spec: HpaSpec;
  currentReplicas: number;
  lastScaleTick: number;
}

// ══════════════════════════ NetworkPolicy ══════════════════════════

export interface PolicyPeer {
  podSelector?: Record<string, string>;
  namespaceSelector?: Record<string, string>;
  ipBlock?: { cidr: string; except?: string[] };
}

export interface PolicyIngressRule {
  ports?: { port: number; protocol: 'TCP' | 'UDP' }[];
  from?: PolicyPeer[];
}

export interface NetworkPolicyResource {
  id: string;
  name: string;
  namespace: string;
  policyTypes: ('Ingress' | 'Egress')[];
  podSelector: Record<string, string>;
  ingressRules: PolicyIngressRule[];
  /** dónde se aplica el enforcement según el stack activo */
  enforcement: 'iptables' | 'ebpf';
}

// ══════════════════════════ Stack de red (lo conmutable) ══════════════════════════

export type CniPlugin = 'flannel' | 'cilium' | 'calico' | 'aws-vpc-cni';

export interface CniConfig {
  plugin: CniPlugin;
  flannel: { backend: 'vxlan' | 'host-gw' };
  cilium: { kubeProxyReplacement: boolean; tunnel: 'disabled' | 'vxlan' };
  calico: { encapsulation: 'ipip' | 'bgp' };
}

export type ProxyMode =
  | 'iptables' // cadenas KUBE-SERVICES → KUBE-SVC → KUBE-SEP (lineal)
  | 'ipvs' // hash table O(1), schedulers rr/lc
  | 'none-ebpf'; // kube-proxy replacement total (Cilium BPF)

export interface DnsConfig {
  ndots: number;
  nodeLocalCache: boolean;
  coreDnsReplicas: number;
  upstreamLatencyMs: number;
}

export type EdgeStack = 'none' | 'ingress-nginx' | 'gateway-envoy' | 'gateway-istio-ambient';

export interface StackConfig {
  cni: CniConfig;
  proxy: ProxyMode;
  dns: DnsConfig;
  edge: EdgeStack;
  mtu: number;
}

export interface ClusterState {
  name: string;
  version: K8sVersion;
  serviceCIDR: string;
  podCIDR: string;
  nodes: KubeNode[];
  workloads: Workload[];
  pods: Pod[];
  services: KubeService[];
  ingresses: IngressResource[];
  httpRoutes: HTTPRouteResource[];
  hpas: HpaResource[];
  networkPolicies: NetworkPolicyResource[];
  /**
   * Servicios virtuales extra (no se renderizan): representan el resto del
   * clúster para el modelo de escala de iptables (escenario 2.000 servicios).
   */
  syntheticServiceCount: number;
  /** contador para asignar ClusterIPs */
  nextClusterIpOctet: number;
  tick: number;
}

// ══════════════════════════ Tráfico & trazas de paquetes ══════════════════════════

export interface TrafficRequest {
  id: string;
  source:
    | { kind: 'external-client'; ref?: string }
    | { kind: 'pod'; ref: string; namespace: string };
  destination: {
    kind: 'external-url' | 'service';
    name: string; // nombre DNS tal como lo llama la app (con o sin punto final)
    namespace?: string;
    port?: number;
  };
  protocol: 'http' | 'grpc';
}

export interface RequestProfile {
  weight: number;
  request: Omit<TrafficRequest, 'id'>;
}

export type HopLayer =
  | 'client'
  | 'edge'
  | 'dns'
  | 'L4'
  | 'L3'
  | 'kernel'
  | 'pod'
  | 'return';

export type HopOperation =
  | 'DNS-QUERY'
  | 'DNS-HIT'
  | 'DNS-NXDOMAIN'
  | 'DNS-UPSTREAM'
  | 'ROUTE'
  | 'DNAT'
  | 'SNAT'
  | 'ENCAP'
  | 'DECAP'
  | 'BPF-LOOKUP'
  | 'POLICY-CHECK'
  | 'DROP'
  | 'ACCEPT'
  | 'FORWARD'
  | 'LB-SELECT'
  | 'RULE-MATCH'
  | 'WEIGHTED-SPLIT'
  | 'FAULT-INJECT';

export interface PacketHop {
  index: number;
  layer: HopLayer;
  /** nodo K8s donde ocurre ('(internet)' para el lado externo) */
  node: string;
  /** componente kernel/stack involucrado, formato corto legible */
  component: string;
  /** explicación pedagógica del salto */
  detail: string;
  ops: HopOperation[];
  /** latencia sintética aportada por este salto (ms) */
  latencyMs: number;
}

export interface DnsQueryAttempt {
  qname: string;
  outcome: 'HIT' | 'NXDOMAIN' | 'UPSTREAM';
  latencyMs: number;
  answeredBy: string;
}

export type TraceOutcome =
  | 'DELIVERED'
  | 'POLICY-DENIED'
  | 'FAULT-500'
  | 'DNS-Failure'
  | 'NO-ENDPOINTS'
  | 'NO-ROUTE';

export interface PacketTrace {
  id: string;
  requestId: string;
  createdAtTick: number;
  request: TrafficRequest;
  hops: PacketHop[];
  dnsQueries?: DnsQueryAttempt[];
  outcome: TraceOutcome;
  totalLatencyMs: number;
  chosenPod?: string;
  targetServiceId?: string;
  annotations: string[];
}

// ══════════════════════════ Métricas & eventos ══════════════════════════

export interface MetricsSnapshot {
  tick: number;
  rps: number;
  latency: { p50: number; p95: number; p99: number };
  errorRate: number; // %
  dnsQps: number;
  replicasByDeployment: Record<string, number>;
  cpuUsageMillis: number; // total del clúster
}

export interface LogEntry {
  tick: number;
  text: string;
  kind: 'info' | 'scale' | 'net' | 'warn';
}
