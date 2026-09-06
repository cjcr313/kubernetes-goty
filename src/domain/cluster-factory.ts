/**
 * Fábrica de clústeres — helpers para que los escenarios se construyan
 * de forma declarativa y legible.
 */
import type {
  ClusterState,
  Container,
  KubeNode,
  KubeService,
  Pod,
  ServiceType,
  Workload,
  WorkloadKind,
} from './types';
import { hash32 } from '@/lib/rng';

export function createBaseCluster(name = 'goty-cluster'): ClusterState {
  return {
    name,
    version: 'v1.32',
    serviceCIDR: '10.96.0.0/12',
    podCIDR: '10.244.0.0/16',
    nodes: [],
    workloads: [],
    pods: [],
    services: [],
    ingresses: [],
    httpRoutes: [],
    hpas: [],
    networkPolicies: [],
    syntheticServiceCount: 0,
    nextClusterIpOctet: 10,
    tick: 0,
  };
}

export function addNode(
  cluster: ClusterState,
  opts: { name: string; role: 'control-plane' | 'worker'; ip: string; cidr: string }
): KubeNode {
  const node: KubeNode = {
    id: `node-${opts.name}`,
    name: opts.name,
    role: opts.role,
    internalIP: opts.ip,
    podCIDR: opts.cidr,
    cpuMillis: opts.role === 'control-plane' ? 4000 : 8000,
    memoryMi: opts.role === 'control-plane' ? 8192 : 16384,
    status: 'Ready',
    podIpCounter: 2,
  };
  cluster.nodes.push(node);
  return node;
}

export function addWorkload(
  cluster: ClusterState,
  opts: {
    name: string;
    namespace: string;
    kind?: WorkloadKind;
    replicas?: number;
    labels?: Record<string, string>;
    containers: Container[];
  }
): Workload {
  const workload: Workload = {
    id: `wl-${opts.namespace}-${opts.name}`,
    name: opts.name,
    namespace: opts.namespace,
    kind: opts.kind ?? 'Deployment',
    replicas: opts.replicas ?? 1,
    labels: opts.labels ?? { app: opts.name },
    template: { containers: opts.containers },
  };
  cluster.workloads.push(workload);
  for (let i = 0; i < workload.replicas; i++) spawnPodFor(cluster, workload);
  return workload;
}

let podSeq = 0;

export function spawnPodFor(cluster: ClusterState, workload: Workload): Pod {
  const node = pickNodeForPod(cluster, workload);
  const suffix = Math.random().toString(36).slice(2, 7);
  const name = `${workload.name}-${(podSeq++).toString(36)}${suffix}`;
  const pod: Pod = {
    id: `pod-${workload.namespace}-${name}`,
    name,
    namespace: workload.namespace,
    nodeName: node.name,
    status: 'Pending',
    labels: { ...workload.labels },
    containers: JSON.parse(JSON.stringify(workload.template.containers)),
    cpuUsageMillis: 5,
    memUsageMi: 32,
    restarts: 0,
    createdAtTick: cluster.tick,
    owner: { kind: workload.kind, name: workload.name },
  };
  cluster.pods.push(pod);
  return pod;
}

function pickNodeForPod(cluster: ClusterState, workload: Workload): KubeNode {
  const workers = cluster.nodes.filter((n) => n.role === 'worker');
  const pool = workers.length ? workers : cluster.nodes;
  // spread determinista por nombre del workload
  const idx = hash32(workload.id) % pool.length;
  const node = pool[idx];
  // anti-colisión simple: siguiente worker si ya hay pods de este workload ahí
  const mine = cluster.pods.filter((p) => p.owner?.name === workload.name);
  const onNode = mine.filter((p) => p.nodeName === node.name).length;
  if (onNode > 0 && pool.length > 1 && mine.length < pool.length) {
    return pool[(idx + mine.length) % pool.length];
  }
  return node;
}

/** Asigna la próxima IP de pod dentro del CIDR del nodo (10.244.X.Y). */
export function allocatePodIp(cluster: ClusterState, nodeName: string): string {
  const node = cluster.nodes.find((n) => n.name === nodeName);
  if (!node) return '10.244.0.99';
  const subnet = node.podCIDR.split('/')[0].split('.').slice(0, 3).join('.');
  const ip = `${subnet}.${node.podIpCounter}`;
  node.podIpCounter = (node.podIpCounter + 1) % 250 || 2;
  return ip;
}

export function nextClusterIp(cluster: ClusterState): string {
  const ip = `10.96.0.${cluster.nextClusterIpOctet}`;
  cluster.nextClusterIpOctet += 1;
  return ip;
}

export function addService(
  cluster: ClusterState,
  opts: {
    name: string;
    namespace: string;
    type?: ServiceType;
    selector: Record<string, string>;
    port?: number;
    targetPort?: number;
    sessionAffinity?: 'None' | 'ClientIP';
    internalTrafficPolicy?: 'Cluster' | 'Local';
  }
): KubeService {
  const svc: KubeService = {
    id: `svc-${opts.namespace}-${opts.name}`,
    name: opts.name,
    namespace: opts.namespace,
    type: opts.type ?? 'ClusterIP',
    clusterIP: (opts.type ?? 'ClusterIP') === 'Headless' ? undefined : nextClusterIp(cluster),
    selector: opts.selector,
    port: opts.port ?? 80,
    targetPort: opts.targetPort ?? opts.port ?? 8080,
    sessionAffinity: opts.sessionAffinity ?? 'None',
    internalTrafficPolicy: opts.internalTrafficPolicy ?? 'Cluster',
    endpoints: [],
  };
  cluster.services.push(svc);
  refreshServiceEndpoints(cluster, svc);
  return svc;
}

export function selectorMatches(selector: Record<string, string>, labels: Record<string, string>): boolean {
  return Object.entries(selector).every(([k, v]) => labels[k] === v);
}

export function refreshServiceEndpoints(cluster: ClusterState, svc: KubeService): void {
  if (svc.type === 'Headless') {
    svc.endpoints = cluster.pods
      .filter((p) => p.namespace === svc.namespace && p.status === 'Running' && selectorMatches(svc.selector, p.labels))
      .map((p) => ({ podId: p.id, ip: p.podIP ?? '0.0.0.0', port: svc.targetPort, ready: true }));
    return;
  }
  svc.endpoints = cluster.pods
    .filter((p) => p.namespace === svc.namespace && selectorMatches(svc.selector, p.labels))
    .filter((p) => p.status === 'Running')
    .map((p) => ({ podId: p.id, ip: p.podIP ?? '0.0.0.0', port: svc.targetPort, ready: true }));
}

export function refreshAllEndpoints(cluster: ClusterState): void {
  for (const svc of cluster.services) refreshServiceEndpoints(cluster, svc);
}

/** Namespace "invisible" kube-system con CoreDNS, presente en todos los escenarios. */
export function addCoreDns(cluster: ClusterState, replicas = 2): void {
  addWorkload(cluster, {
    name: 'coredns',
    namespace: 'kube-system',
    replicas,
    labels: { 'k8s-app': 'kube-dns' },
    containers: [
      {
        name: 'coredns',
        image: 'registry.k8s.io/coredns/coredns:v1.11.1',
        port: 53,
        resources: { requests: { cpuMillis: 100, memoryMi: 70 }, limits: { cpuMillis: 500, memoryMi: 512 } },
        env: {},
      },
    ],
  });
  addService(cluster, {
    name: 'kube-dns',
    namespace: 'kube-system',
    selector: { 'k8s-app': 'kube-dns' },
    port: 53,
    targetPort: 53,
  });
  // madurar pods de sistema: Running con IP
  for (const pod of cluster.pods) {
    if (pod.namespace === 'kube-system') {
      pod.status = 'Running';
      pod.podIP = allocatePodIp(cluster, pod.nodeName);
    }
  }
  refreshAllEndpoints(cluster);
}
