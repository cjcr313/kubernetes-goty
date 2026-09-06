/**
 * Escenario 4 — "Traffic Shifting con Gateway API & Envoy"
 * Canary 90/10 entre web-v1/web-v2 + fault injection (HTTP 500) sobre v2.
 */
import type { Scenario } from './index';
import { addCoreDns, addNode, addService, addWorkload, createBaseCluster } from '@/domain/cluster-factory';

const scenario: Scenario = {
  id: 'traffic-shifting-canary',
  name: 'Traffic Shifting con Gateway API & Envoy',
  tagline: 'Canary 90/10 por HTTPRoute, fault injection y circuit breaking',
  difficulty: 'media',
  objectives: [
    'Observa el hop "weighted backend": Envoy decide v1 (90%) vs v2 (10%) por request',
    'El 30% del tráfico a v2 recibe HTTP 500 inyectado → error rate ≈ 3% global',
    'Cambia el edge a ingress-nginx: sin soporte nativo de pesos, el canary desaparece',
    'Baja el RPS y verifica que la proporción de traces v1/v2 respeta el peso',
  ],
  focusNamespace: 'demo',
  defaultRps: 1000,
  cpuPerRps: 0.35,
  defaultStack: {
    cni: { plugin: 'cilium', flannel: { backend: 'vxlan' }, cilium: { kubeProxyReplacement: true, tunnel: 'vxlan' }, calico: { encapsulation: 'ipip' } },
    proxy: 'none-ebpf',
    dns: { ndots: 2, nodeLocalCache: true, coreDnsReplicas: 2, upstreamLatencyMs: 10 },
    edge: 'gateway-envoy',
    mtu: 1500,
  },
  buildCluster: () => {
    const cluster = createBaseCluster('canary-lab');
    addNode(cluster, { name: 'cp-1', role: 'control-plane', ip: '192.168.40.10', cidr: '10.244.0.0/24' });
    addNode(cluster, { name: 'worker-1', role: 'worker', ip: '192.168.40.11', cidr: '10.244.1.0/24' });
    addNode(cluster, { name: 'worker-2', role: 'worker', ip: '192.168.40.12', cidr: '10.244.2.0/24' });
    addCoreDns(cluster, 2);

    addWorkload(cluster, {
      name: 'web-v1',
      namespace: 'demo',
      replicas: 3,
      labels: { app: 'web', version: v1() },
      containers: [
        {
          name: 'web',
          image: 'ghcr.io/goty/web:3.0.1',
          port: 8080,
          resources: { requests: { cpuMillis: 300, memoryMi: 192 }, limits: { cpuMillis: 600, memoryMi: 384 } },
          env: { VERSION: 'v1' },
        },
      ],
    });
    addService(cluster, { name: 'web-v1', namespace: 'demo', selector: { app: 'web', version: v1() }, port: 80, targetPort: 8080 });

    addWorkload(cluster, {
      name: 'web-v2',
      namespace: 'demo',
      replicas: 2,
      labels: { app: 'web', version: 'v2' },
      containers: [
        {
          name: 'web',
          image: 'ghcr.io/goty/web:3.1.0-rc2',
          port: 8080,
          resources: { requests: { cpuMillis: 300, memoryMi: 192 }, limits: { cpuMillis: 600, memoryMi: 384 } },
          env: { VERSION: 'v2' },
        },
      ],
    });
    addService(cluster, { name: 'web-v2', namespace: 'demo', selector: { app: 'web', version: 'v2' }, port: 80, targetPort: 8080 });

    // Gateway API: HTTPRoute con pesos + fault injection sobre v2
    cluster.httpRoutes.push({
      id: 'hr-demo-app',
      name: 'app-routes',
      namespace: 'demo',
      gatewayName: 'edge-gateway',
      hostnames: ['app.example.com'],
      rules: [
        {
          matches: [{ path: '/' }],
          backends: [
            { name: 'web-v1', namespace: 'demo', port: 80, weight: 90 },
            { name: 'web-v2', namespace: 'demo', port: 80, weight: 10 },
          ],
          faultInjection: { httpStatus: 500, percentage: 30 },
        },
      ],
    });
    return cluster;
  },
  requestProfiles: [
    {
      weight: 10,
      request: {
        source: { kind: 'external-client' },
        destination: { kind: 'external-url', name: 'app.example.com' },
        protocol: 'http',
      },
    },
  ],
};

function v1(): string {
  return 'v1';
}

export default scenario;
