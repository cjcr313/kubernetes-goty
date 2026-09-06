/**
 * Generador de tráfico sintético: muestrea requests representativos por tick,
 * los traza con el motor de datapath, agrega métricas y quema CPU en los pods
 * de destino (señal que alimenta el HPA).
 */
import type {
  ClusterState,
  MetricsSnapshot,
  PacketTrace,
  RequestProfile,
  StackConfig,
} from '@/domain/types';
import { tracePacket } from './network-simulator';
import { hash32, mulberry32, pickWeighted } from '@/lib/rng';

export interface TickTrafficResult {
  traces: PacketTrace[];
  metrics: MetricsSnapshot;
}

export function runTickTraffic(
  cluster: ClusterState,
  stack: StackConfig,
  rps: number,
  profiles: RequestProfile[],
  cpuPerRpsMilli: number
): TickTrafficResult {
  const rand = mulberry32(hash32(`tick-${cluster.tick}`));
  const traces: PacketTrace[] = [];
  const latencies: number[] = [];
  let errors = 0;
  let dnsQueriesTotal = 0;

  const samples = Math.min(16, Math.max(4, Math.round(rps / 25)));

  for (let s = 0; s < samples; s++) {
    const profile = pickWeighted(profiles, rand);
    const req = {
      id: `req-${cluster.tick}-${s}`,
      ...profile.request,
    };
    const trace = tracePacket(req, cluster, stack);
    traces.push(trace);
    latencies.push(trace.totalLatencyMs);
    dnsQueriesTotal += trace.dnsQueries?.length ?? 0;
    if (trace.outcome !== 'DELIVERED') errors += 1;
  }

  // ── quemar CPU en los pods que recibieron tráfico ──
  burnCpu(cluster, rps, traces, cpuPerRpsMilli);

  // ── métricas agregadas ──
  const sorted = [...latencies].sort((a, b) => a - b);
  const pct = (q: number) =>
    sorted.length ? Math.round((sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] + Number.EPSILON) * 100) / 100 : 0;

  const replicasByDeployment: Record<string, number> = {};
  for (const wl of cluster.workloads) {
    if (wl.namespace === 'kube-system') continue;
    replicasByDeployment[wl.name] = cluster.pods.filter(
      (p) => p.owner?.name === wl.name && p.status === 'Running'
    ).length;
  }

  const metrics: MetricsSnapshot = {
    tick: cluster.tick,
    rps,
    latency: { p50: pct(0.5), p95: pct(0.95), p99: pct(0.99) },
    errorRate: Math.round((errors / samples) * 1000) / 10,
    dnsQps: Math.round(((dnsQueriesTotal / samples) * rps * 10) / 10),
    replicasByDeployment,
    cpuUsageMillis: cluster.pods
      .filter((p) => p.status === 'Running')
      .reduce((a, p) => a + p.cpuUsageMillis, 0),
  };

  return { traces, metrics };
}

/** Distribuye la carga entre los pods running de cada workload destino. */
function burnCpu(
  cluster: ClusterState,
  rps: number,
  traces: PacketTrace[],
  cpuPerRpsMilli: number
): void {
  // contar hits por workload (solo los entregados)
  const hitsByWorkload = new Map<string, number>();
  for (const t of traces) {
    if (t.outcome !== 'DELIVERED' || !t.chosenPod) continue;
    const pod = cluster.pods.find((p) => p.name === t.chosenPod);
    if (!pod?.owner) continue;
    hitsByWorkload.set(pod.owner.name, (hitsByWorkload.get(pod.owner.name) ?? 0) + 1);
  }

  const samples = Math.max(1, traces.length);
  for (const pod of cluster.pods) {
    if (pod.status !== 'Running' || !pod.owner) continue;
    const share = (hitsByWorkload.get(pod.owner.name) ?? 0) / samples;
    const myRps = share * rps;
    const siblings = cluster.pods.filter(
      (p) => p.owner?.name === pod.owner?.name && p.status === 'Running'
    ).length;
    const perPodRps = siblings > 0 ? myRps / siblings : myRps;
    const limit = pod.containers[0]?.resources.limits?.cpuMillis ?? 2000;
    const target = 8 + perPodRps * cpuPerRpsMilli;
    // suavizado: 70% hacia el target
    pod.cpuUsageMillis = Math.round(
      Math.min(limit * 1.15, pod.cpuUsageMillis + (target - pod.cpuUsageMillis) * 0.7)
    );
    pod.memUsageMi = Math.round(Math.min(
      (pod.containers[0]?.resources.limits?.memoryMi ?? 2048) * 0.9,
      48 + perPodRps * 0.08
    ));
  }
}
