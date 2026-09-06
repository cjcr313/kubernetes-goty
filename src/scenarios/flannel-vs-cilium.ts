/**
 * Escenario 3 — "Flannel VXLAN Overhead vs. Cilium Native Routing"
 * Tráfico cross-node: compara encapsulación VXLAN (+50B, MTU 1450)
 * contra eBPF direct routing sin túnel.
 */
import type { Scenario } from './index';
import { addCoreDns, addNode, addService, addWorkload, createBaseCluster } from '@/domain/cluster-factory';

const scenario: Scenario = {
  id: 'flannel-vs-cilium',
  name: 'Flannel VXLAN Overhead vs. Cilium Native Routing',
  tagline: 'Encapsular vs. rutar directo: overhead de MTU y saltos extra',
  difficulty: 'intro',
  objectives: [
    'Sigue el paquete cross-node: ENCAP en flannel.1 → underlay → DECAP en el nodo destino',
    'Cambia flannel a host-gw: rutas planas, cero overhead de cabeceras',
    'Activa Cilium native routing: BPF en ambos veth, sin túnel ni iptables del host',
    'Compara el contador de hops y el detalle de cada salto en el inspector',
  ],
  focusNamespace: 'demo',
  defaultRps: 800,
  cpuPerRps: 0.15,
  defaultStack: {
    cni: { plugin: 'flannel', flannel: { backend: 'vxlan' }, cilium: { kubeProxyReplacement: true, tunnel: 'disabled' }, calico: { encapsulation: 'ipip' } },
    proxy: 'iptables',
    dns: { ndots: 2, nodeLocalCache: true, coreDnsReplicas: 2, upstreamLatencyMs: 10 },
    edge: 'none',
    mtu: 1500,
  },
  buildCluster: () => {
    const cluster = createBaseCluster('cni-lab');
    addNode(cluster, { name: 'cp-1', role: 'control-plane', ip: '192.168.30.10', cidr: '10.244.0.0/24' });
    addNode(cluster, { name: 'worker-1', role: 'worker', ip: '192.168.30.11', cidr: '10.244.1.0/24' });
    addNode(cluster, { name: 'worker-2', role: 'worker', ip: '192.168.30.12', cidr: '10.244.2.0/24' });
    addCoreDns(cluster, 2);

    // loader en worker-1, web en worker-2: cross-node garantizado
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
