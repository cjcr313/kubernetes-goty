/**
 * Escenario 1 — "The ndots:5 DNS Penalty"
 * Una app resuelve dominios externos sin FQDN y satura CoreDNS:
 * cada request camina TODA la search list (NXDOMAIN × 3) antes del upstream.
 */
import type { Scenario } from './index';
import { addCoreDns, addNode, addService, addWorkload, createBaseCluster } from '@/domain/cluster-factory';

const scenario: Scenario = {
  id: 'ndots-dns-penalty',
  name: 'The ndots:5 DNS Penalty',
  tagline: 'Resolución externa sin FQDN: 4 queries por request, CoreDNS en llamas',
  difficulty: 'intro',
  objectives: [
    'Observa el hop DNS: cada request a api.twitter.com hace 4 consultas (3 NXDOMAIN + 1 upstream)',
    'Cambia ndots:5 → ndots:2 en el panel de stack y mira caer la latencia y el DNS QPS',
    'Activa NodeLocal DNSCache: los NXDOMAIN negativos se cachean en el nodo',
    'Compara con el request interno al service "api" (1 sola query, HIT inmediato)',
  ],
  focusNamespace: 'demo',
  defaultRps: 500,
  cpuPerRps: 0.02,
  defaultStack: {
    cni: { plugin: 'flannel', flannel: { backend: 'vxlan' }, cilium: { kubeProxyReplacement: false, tunnel: 'vxlan' }, calico: { encapsulation: 'ipip' } },
    proxy: 'iptables',
    dns: { ndots: 5, nodeLocalCache: false, coreDnsReplicas: 2, upstreamLatencyMs: 15 },
    edge: 'none',
    mtu: 1500,
  },
  buildCluster: () => {
    const cluster = createBaseCluster('ndots-lab');
    addNode(cluster, { name: 'cp-1', role: 'control-plane', ip: '192.168.10.10', cidr: '10.244.0.0/24' });
    addNode(cluster, { name: 'worker-1', role: 'worker', ip: '192.168.10.11', cidr: '10.244.1.0/24' });
    addNode(cluster, { name: 'worker-2', role: 'worker', ip: '192.168.10.12', cidr: '10.244.2.0/24' });
    addCoreDns(cluster, 2);

    addWorkload(cluster, {
      name: 'frontend',
      namespace: 'demo',
      replicas: 2,
      labels: { app: 'frontend' },
      containers: [
        {
          name: 'web',
          image: 'ghcr.io/goty/frontend:1.4.2',
          port: 8080,
          resources: { requests: { cpuMillis: 250, memoryMi: 128 }, limits: { cpuMillis: 500, memoryMi: 256 } },
          env: { UPSTREAM: 'api.twitter.com' },
        },
      ],
    });
    addService(cluster, { name: 'frontend', namespace: 'demo', selector: { app: 'frontend' }, port: 80, targetPort: 8080 });

    addWorkload(cluster, {
      name: 'api',
      namespace: 'demo',
      replicas: 2,
      labels: { app: 'api' },
      containers: [
        {
          name: 'api',
          image: 'ghcr.io/goty/api:2.1.0',
          port: 8080,
          resources: { requests: { cpuMillis: 250, memoryMi: 128 }, limits: { cpuMillis: 500, memoryMi: 256 } },
          env: {},
        },
      ],
    });
    addService(cluster, { name: 'api', namespace: 'demo', selector: { app: 'api' }, port: 80, targetPort: 8080 });
    return cluster;
  },
  requestProfiles: [
    {
      weight: 8,
      request: {
        source: { kind: 'pod', ref: 'demo/frontend', namespace: 'demo' },
        destination: { kind: 'external-url', name: 'api.twitter.com' },
        protocol: 'http',
      },
    },
    {
      weight: 2,
      request: {
        source: { kind: 'pod', ref: 'demo/frontend', namespace: 'demo' },
        destination: { kind: 'service', name: 'api', namespace: 'demo' },
        protocol: 'http',
      },
    },
  ],
};

export default scenario;
