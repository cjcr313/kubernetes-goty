/**
 * Controlador HPA: reconcile loop simplificado (sin tolerancia/estabilización
 * completa, pero con cooldown) que respeta la fórmula oficial:
 *   desired = ceil(replicas × currentMetric / targetMetric)
 */
import type { ClusterState, HpaResource, Workload } from '@/domain/types';

const SCALE_COOLDOWN_TICKS = 15; // ~15s

export function reconcileHpas(cluster: ClusterState): string[] {
  const events: string[] = [];

  for (const hpa of cluster.hpas) {
    const workload = cluster.workloads.find(
      (w) => w.name === hpa.spec.scaleTargetRef.name && w.namespace === hpa.namespace
    );
    if (!workload) continue;

    const pods = cluster.pods.filter(
      (p) =>
        p.owner?.name === workload.name &&
        p.namespace === hpa.namespace &&
        (p.status === 'Running' || p.status === 'ContainerCreating' || p.status === 'Pending')
    );
    const running = pods.filter((p) => p.status === 'Running');
    if (running.length === 0) continue;

    const usages = running.map((p) => {
      const req = p.containers[0]?.resources.requests?.cpuMillis ?? 100;
      return p.cpuUsageMillis / req;
    });
    const avgRatio = usages.reduce((a, b) => a + b, 0) / usages.length;
    const avgPct = avgRatio * 100;

    const desired = Math.max(
      hpa.spec.minReplicas,
      Math.min(
        hpa.spec.maxReplicas,
        Math.ceil(running.length * (avgPct / hpa.spec.targetCpuPercent))
      )
    );
    hpa.currentReplicas = running.length;

    if (desired !== running.length && cluster.tick - hpa.lastScaleTick >= SCALE_COOLDOWN_TICKS) {
      scaleWorkload(cluster, workload, desired);
      hpa.lastScaleTick = cluster.tick;
      events.push(
        `HPA ${hpa.namespace}/${hpa.name}: ${running.length} → ${desired} réplicas (CPU ${avgPct.toFixed(0)}% / target ${hpa.spec.targetCpuPercent}%)`
      );
    }
  }
  return events;
}

export function scaleWorkload(cluster: ClusterState, workload: Workload, replicas: number): void {
  workload.replicas = Math.max(0, replicas);
  // el reconciler de lifecycle materializa los pods en el próximo tick
}
