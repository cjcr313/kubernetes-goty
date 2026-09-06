/**
 * Ciclo de vida de pods: state machine por tick.
 * Pending → ContainerCreating → Running (o CrashLoopBackOff)
 * Terminating → removido.
 * Además reconcilia replicas de workloads (apply YAML / HPA).
 */
import type { ClusterState, Pod } from '@/domain/types';
import { allocatePodIp, refreshAllEndpoints, spawnPodFor } from '@/domain/cluster-factory';

/** ticks que demora cada fase (a 1 tick ≈ 1s) */
const IMAGE_PULL_TICKS = 2;

export function advanceLifecycles(cluster: ClusterState): string[] {
  const events: string[] = [];

  // 1) reconciliar replicas declaradas vs pods vivos
  for (const wl of cluster.workloads) {
    const mine = cluster.pods.filter(
      (p) => p.owner?.name === wl.name && p.owner?.kind === wl.kind && p.namespace === wl.namespace
    );
    const alive = mine.filter((p) => p.status !== 'Terminating');
    if (alive.length < wl.replicas) {
      const n = wl.replicas - alive.length;
      for (let i = 0; i < n; i++) {
        const pod = spawnPodFor(cluster, wl);
        events.push(`Pod ${pod.namespace}/${pod.name}: Pending (pull de imagen)`);
      }
    } else if (alive.length > wl.replicas) {
      // terminar los más nuevos primero
      const sorted = [...alive].sort((a, b) => b.createdAtTick - a.createdAtTick);
      for (let i = 0; i < alive.length - wl.replicas; i++) {
        sorted[i].status = 'Terminating';
        events.push(`Pod ${sorted[i].name}: Terminating (scale down)`);
      }
    }
  }

  // 2) avanzar fases
  for (const pod of [...cluster.pods]) {
    if (pod.status === 'Pending' && cluster.tick - pod.createdAtTick >= 1) {
      pod.status = 'ContainerCreating';
    } else if (
      pod.status === 'ContainerCreating' &&
      cluster.tick - pod.createdAtTick >= 1 + IMAGE_PULL_TICKS
    ) {
      pod.podIP = allocatePodIp(cluster, pod.nodeName);
      if (isCrashy(pod)) {
        pod.status = 'CrashLoopBackOff';
        pod.restarts += 1;
        events.push(`Pod ${pod.name}: CrashLoopBackOff (exit 1, backoff exponencial)`);
      } else {
        pod.status = 'Running';
        events.push(`Pod ${pod.name}: Running (${pod.podIP})`);
      }
    } else if (pod.status === 'CrashLoopBackOff') {
      if (cluster.tick % 6 === 0) {
        if (!isCrashy(pod)) {
          pod.status = 'Running';
        } else {
          pod.restarts += 1;
        }
      }
    } else if (pod.status === 'Terminating') {
      if (cluster.tick - pod.createdAtTick >= 0) {
        // remoción al tick siguiente
        cluster.pods = cluster.pods.filter((p) => p.id !== pod.id);
      }
    }
  }

  refreshAllEndpoints(cluster);
  return events;
}

function isCrashy(pod: Pod): boolean {
  return pod.containers.some((c) => c.env['SIM_CRASH'] === '1');
}
