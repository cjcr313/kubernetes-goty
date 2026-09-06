/**
 * Escenario 5 — "NetworkPolicy Isolation Failure"
 * default-deny sobre el pod db: solo la app puede hablar con él.
 * Muestra DÓNDE cae el paquete según el enforcement (ebpf vs iptables).
 */
import type { Scenario } from './index';
import { addCoreDns, addNode, addService, addWorkload, createBaseCluster } from '@/domain/cluster-factory';
import type { NetworkPolicyResource } from '@/domain/types';

const scenario: Scenario = {
  id: 'netpol-isolation',
  name: 'NetworkPolicy Isolation Failure',
  tagline: 'El DROP: policy map en el veth (eBPF) vs. cadena iptables del netns',
  difficulty: 'avanzada',
  objectives: [
    'El loader (namespace demo) intenta hablar con la DB → POLICY-DENIED',
    'Inspecciona el hop DROP: con Cilium ocurre en el BPF map del veth (kernel, mismo hook)',
    'Cambia el CNI a flannel: el drop se mueve a las cadenas iptables del netns del pod',
    'Edita la policy: agrega un peer que acepte al loader y el paquete pasa',
  ],
  focusNamespace: 'secure',
  defaultRps: 300,
  cpuPerRps: 0.1,
  defaultStack: {
    cni: { plugin: 'cilium', flannel: { backend: 'vxlan' }, cilium: { kubeProxyReplacement: true, tunnel: 'vxlan' }, calico: { encapsulation: 'ipip' } },
    proxy: 'none-ebpf',
    dns: { ndots: 2, nodeLocalCache: true, coreDnsReplicas: 2, upstreamLatencyMs: 10 },
    edge: 'none',
    mtu: 1500,
  },
  buildCluster: () => {
    const cluster = createBaseCluster('netpol-lab');
    addNode(cluster, { name: 'cp-1', role: 'control-plane', ip: '192.168.50.10', cidr: '10.244.0.0/24' });
    addNode(cluster, { name: 'worker-1', role: 'worker', ip: '192.168.50.11', cidr: '10.244.1.0/24' });
    addNode(cluster, { name: 'worker-2', role: 'worker', ip: '192.168.50.12', cidr: '10.244.2.0/24' });
    addCoreDns(cluster, 2);

    // atacante legítimo: loader en demo
    addWorkload(cluster, {
      name: 'loader',
      namespace: 'demo',
      replicas: 1,
      labels: { app: 'loader' },
      containers: [
        {
          name: 'loader',
          image: 'ghcr.io/goty/loadgen:0.9',
          resources: { requests: { cpuMillis: 200, memoryMi: 64 }, limits: { cpuMillis: 400, memoryMi: 128 } },
          env: { TARGET: 'db.secure' },
        },
      ],
    });

    // app permitida en secure
    addWorkload(cluster, {
      name: 'app',
      namespace: 'secure',
      replicas: 2,
      labels: { app: 'app' },
      containers: [
        {
          name: 'app',
          image: 'ghcr.io/goty/app:1.7.3',
          port: 8080,
          resources: { requests: { cpuMillis: 250, memoryMi: 128 }, limits: { cpuMillis: 500, memoryMi: 256 } },
          env: { DB: 'db' },
        },
      ],
    });

    addWorkload(cluster, {
      name: 'db',
      namespace: 'secure',
      replicas: 2,
      labels: { app: 'db', tier: 'data' },
      containers: [
        {
          name: 'postgres',
          image: 'postgres:16.4',
          port: 5432,
          resources: { requests: { cpuMillis: 400, memoryMi: 512 }, limits: { cpuMillis: 800, memoryMi: 1024 } },
          env: { POSTGRES_PASSWORD: 'sim' },
        },
      ],
    });
    addService(cluster, { name: 'db', namespace: 'secure', selector: { app: 'db' }, port: 5432, targetPort: 5432 });

    const denyDb: NetworkPolicyResource = {
      id: 'np-secure-db-isolate',
      name: 'db-isolation',
      namespace: 'secure',
      policyTypes: ['Ingress'],
      podSelector: { app: 'db' },
      ingressRules: [
        {
          from: [{ podSelector: { app: 'app' } }],
        },
      ],
      enforcement: 'ebpf',
    };
    cluster.networkPolicies.push(denyDb);
    return cluster;
  },
  requestProfiles: [
    // app → db: permitido
    {
      weight: 5,
      request: {
        source: { kind: 'pod', ref: 'secure/app', namespace: 'secure' },
        destination: { kind: 'service', name: 'db', namespace: 'secure' },
        protocol: 'grpc',
      },
    },
    // loader → db: DENIED por policy
    {
      weight: 5,
      request: {
        source: { kind: 'pod', ref: 'demo/loader', namespace: 'demo' },
        destination: { kind: 'service', name: 'db.secure', namespace: 'demo' },
        protocol: 'http',
      },
    },
  ],
};

export default scenario;
