/**
 * Resolución DNS estilo stub-resolver + CoreDNS.
 *
 * Modela el comportamiento de /etc/resolv.conf del pod:
 *   search <ns>.svc.cluster.local svc.cluster.local cluster.local
 *   options ndots:N
 *
 * - ndots alto + nombre corto => recorre TODA la search list antes de
 *   consultar el nombre "pelado" (la penalización del escenario ndots:5).
 * - FQDN con punto final => consulta absoluta, un solo query.
 * - Cada query paga el round-trip por el datapath (incluido el lookup del
 *   ClusterIP de kube-dns: con iptables + 2.000 servicios, duele).
 */
import type { ClusterState, DnsConfig, DnsQueryAttempt, KubeService } from '@/domain/types';

export interface DnsResolution {
  resolved: boolean;
  address?: string;
  targetService?: KubeService;
  queries: DnsQueryAttempt[];
  latencyMs: number;
}

const COREDNS_PROCESS_MS = 0.3;
const NODELOCAL_HIT_MS = 0.05;

export function resolveDns(
  rawName: string,
  sourceNs: string,
  cluster: ClusterState,
  dns: DnsConfig,
  datapathPenaltyMs: number
): DnsResolution {
  const isAbsolute = rawName.endsWith('.');
  const name = rawName.replace(/\.+$/, '');
  const dots = name.split('.').length - 1;
  const searchList = [`${sourceNs}.svc.cluster.local`, 'svc.cluster.local', 'cluster.local'];

  const queries: DnsQueryAttempt[] = [];
  let resolved = false;
  let address: string | undefined;
  let targetService: KubeService | undefined;

  const query = (qname: string): DnsQueryAttempt => {
    // ¿es <svc>.<ns>.svc.cluster.local ?
    const svcMatch = qname.match(/^([^.]+)\.([^.]+)\.svc\.cluster\.local$/);
    if (svcMatch) {
      const svc = cluster.services.find(
        (s) => s.name === svcMatch[1] && s.namespace === svcMatch[2]
      );
      if (svc && svc.type === 'Headless' && svc.endpoints.length > 0) {
        resolved = true;
        address = svc.endpoints[0].ip;
        targetService = svc;
        return {
          qname,
          outcome: 'HIT',
          latencyMs: r(COREDNS_PROCESS_MS + datapathPenaltyMs),
          answeredBy: dns.nodeLocalCache ? 'NodeLocal cache' : 'CoreDNS',
        };
      }
      if (svc?.clusterIP) {
        resolved = true;
        address = svc.clusterIP;
        targetService = svc;
        return {
          qname,
          outcome: 'HIT',
          latencyMs: r(COREDNS_PROCESS_MS + datapathPenaltyMs + (dns.nodeLocalCache ? NODELOCAL_HIT_MS : 0.3)),
          answeredBy: dns.nodeLocalCache ? 'NodeLocal cache' : 'CoreDNS',
        };
      }
      // CoreDNS es autoritativo para cluster.local => NXDOMAIN inmediato
      return {
        qname,
        outcome: 'NXDOMAIN',
        latencyMs: r(COREDNS_PROCESS_MS + datapathPenaltyMs * 0.6 + (dns.nodeLocalCache ? NODELOCAL_HIT_MS : 0)),
        answeredBy: dns.nodeLocalCache ? 'NodeLocal cache (negativo)' : 'CoreDNS (autoritativo)',
      };
    }

    // sufijos internos sin match de servicio
    if (qname.endsWith('.svc.cluster.local') || qname === 'cluster.local' || qname.endsWith('.cluster.local')) {
      return {
        qname,
        outcome: 'NXDOMAIN',
        latencyMs: r(COREDNS_PROCESS_MS + datapathPenaltyMs * 0.6),
        answeredBy: dns.nodeLocalCache ? 'NodeLocal cache (negativo)' : 'CoreDNS (autoritativo)',
      };
    }

    // nombre externo: forward hacia upstream
    return {
      qname,
      outcome: 'UPSTREAM',
      latencyMs: r(dns.upstreamLatencyMs + COREDNS_PROCESS_MS + datapathPenaltyMs),
      answeredBy: dns.nodeLocalCache ? 'NodeLocal → CoreDNS → upstream' : 'CoreDNS → upstream (/etc/resolv.conf forward)',
    };
  };

  if (isAbsolute || dots >= dns.ndots) {
    // consulta absoluta: nombre tal cual, sin search list
    queries.push(query(name));
  } else {
    // expansión de search list hasta HIT
    for (const suffix of searchList) {
      const q = query(`${name}.${suffix}`);
      queries.push(q);
      if (q.outcome === 'HIT') break;
    }
    // agotada la lista: consultar el nombre pelado (external forward)
    if (!resolved) queries.push(query(name));
  }

  return {
    resolved,
    address,
    targetService,
    queries,
    latencyMs: r(queries.reduce((a, q) => a + q.latencyMs, 0)),
  };
}

function r(n: number): number {
  return Math.round(n * 1000) / 1000;
}
