/**
 * Escenario 2 — "Iptables Explosion vs. eBPF Performance"
 * Un clúster con 2.000 servicios: kube-proxy iptables evalúa reglas
 * linealmente en CADA paquete nuevo; el lookup BPF es O(1).
 */
import type { Scenario } from './index';
import { addCoreDns, addNode, addService, addWorkload, createBaseCluster } from '@/domain/cluster-factory';
import type { HpaResource } from '@/domain/types';

const scenario: Scenario = {
  id: 'iptables-vs-ebpf',
  name: 'Iptables Explosion vs. eBPF Performance',
  tagline: '2.000 servicios: cadenas lineales vs. lookup O(1) en BPF maps',
  difficulty: 'media',
  objectives: [
    'Mira el p99 con kube-proxy iptables: ~8.000 reglas recorridas por flow',
    'Cambia el proxy a IPVS: hash table del kernel, latencia plana',
    'Activa Cilium con kube-proxy replacement (none-ebpf): lookup en BPF map, sin conntrack',
    'Sube el RPS a 5.000 y observa el HPA escalando el backend "web"',
  ],
  focusNamespace: 'demo',
  defaultRps: 2000,
  cpuPerRps: 0.55,
  defaultStack: {
    cni: { plugin: 'flannel', flannel: { backend: 'vxlan' }, cilium: { kubeProxyReplacement: true, tunnel: 'vxlan' }, calico: { encapsulation: 'ipip' } },
    proxy: 'iptables',
    dns: { ndots: 2, nodeLocalCache: true, coreDnsReplicas: 2, upstreamLatencyMs: 12 },
    edge: 'none',
    mtu: 1500,
  },
  buildCluster: () => {
    const cluster = createBaseCluster('scale-lab');
    cluster.syntheticServiceCount = 2000; // el resto del clúster (no se renderiza)
    addNode(cluster, { name: 'cp-1', role: 'control-plane', ip: '192.168.20.10', cidr: '10.244.0.0/24' });
    addNode(cluster, { name: 'worker-1', role: 'worker', ip: '192.168.20.11', cidr: '10.244.1.0/24' });
    addNode(cluster, { name: 'worker-2', role: 'worker', ip: '192.168.20.12', cidr: '10.244.2.0/24' });
    addNode(cluster, { name: 'worker-3', role: 'worker', ip: '192.168.20.13', cidr: '10.244.3.0/24' });
    addCoreDns(cluster, 3);

    addWorkload(cluster, {
      name: 'loader',
      namespace: 'demo',
      replicas: 2,
      labels: { app: 'loader' },
      containers: [
        {
          name: 'loader',
          image: 'ghcr.io/goty/loadgen:0.9',
          resources: { requests: { cpuMillis: 200, memoryMi: 64 }, limits: { cpuMillis: 400, memoryMi: 128 } },
          env: { TARGET: 'web' },
        },
      ],
    });

    addWorkload(cluster, {
      name: 'web',
      namespace: 'demo',
      replicas: 3,
      labels: { app: 'web' },
      containers: [
        {
          name: 'web',
          image: 'ghcr.io/goty/web:3.0.1',
          port: 8080,
          resources: { requests: { cpuMillis: 300, memoryMi: 192 }, limits: { cpuMillis: 600, memoryMi: 384 } },
          env: {},
        },
      ],
    });
    addService(cluster, { name: 'web', namespace: 'demo', selector: { app: 'web' }, port: 80, targetPort: 8080 });

    const hpa: HpaResource = {
      id: 'hpa-demo-web',
      name: 'web-autoscaler',
      namespace: 'demo',
      spec: { scaleTargetRef: { kind: 'Deployment', name: 'web' }, minReplicas: 3, maxReplicas: 12, targetCpuPercent: 70 },
      currentReplicas: 3,
      lastScaleTick: 0,
    };
    cluster.hpas.push(hpa);
    return cluster;
  },
  requestProfiles: [
    {
      weight: 10,
      request: {
        source: { kind: 'pod', ref: 'demo/loader', namespace: 'demo' },
        destination: { kind: 'service', name: 'web', namespace: 'demo' },
        protocol: 'http',
      },
    },
  ],
};

export default scenario;
