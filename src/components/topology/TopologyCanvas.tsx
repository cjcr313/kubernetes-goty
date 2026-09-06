'use client';

/**
 * Canvas de topología: construye el grafo desde el estado del clúster y
 * superpone la ruta del paquete activo (traza seleccionada).
 */
import { useMemo } from 'react';
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  type Edge as RFEdge,
  type Node as RFNode,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { ClusterState, PacketTrace, Pod, StackConfig } from '@/domain/types';
import { resolveSourcePod } from '@/engine/network-simulator';
import { usePlayground } from '@/lib/store';
import { getScenario } from '@/scenarios';
import { OUTCOME_COLORS } from '@/lib/utils';
import { nodeTypes } from './cards';
import { edgeTypes } from './PacketEdge';

interface Graph {
  nodes: RFNode[];
  edges: RFEdge[];
}

const NODE_W = 360;
const POD_H = 92;
const KUBE_HEADER = 64;
const KUBE_GAP = 90;

export function buildGraph(
  cluster: ClusterState,
  stack: StackConfig,
  trace: PacketTrace | null,
  running: boolean,
  focusNamespace: string
): Graph {
  const nodes: RFNode[] = [];
  const edges: RFEdge[] = [];

  // ── cliente ──
  nodes.push({
    id: 'client',
    type: 'client',
    position: { x: 0, y: 300 },
    data: { label: 'Cliente' },
  });

  // ── edge gateway ──
  if (stack.edge !== 'none') {
    nodes.push({
      id: 'edge-gw',
      type: 'edgeGw',
      position: { x: 300, y: 280 },
      data: { stack: stack.edge },
    });
    edges.push(baseEdge('client', 'edge-gw', 'e-client-edge'));
  }

  // ── services (namespace en foco) ──
  const focusServices = cluster.services.filter((s) => s.namespace === focusNamespace);
  focusServices.forEach((svc, i) => {
    nodes.push({
      id: `svc-${svc.id}`,
      type: 'svc',
      position: { x: 660, y: 40 + i * 190 },
      data: { svc, highlighted: trace?.targetServiceId === svc.id },
    });
    // conexión desde el edge (si existe) hacia el service
    if (stack.edge !== 'none') {
      edges.push(baseEdge('edge-gw', `svc-${svc.id}`, `e-edge-${svc.id}`));
    }
    // service → endpoints
    for (const ep of svc.endpoints) {
      edges.push(baseEdge(`svc-${svc.id}`, `pod-${ep.podId}`, `e-${svc.id}-${ep.podId}`, running));
    }
  });

  // ── kube nodes + pods ──
  cluster.nodes.forEach((kn, col) => {
    const podsHere = cluster.pods.filter((p) => p.nodeName === kn.name);
    const x = 1080 + col * (NODE_W + KUBE_GAP);
    const y = 20;
    const height = KUBE_HEADER + Math.max(1, podsHere.length) * POD_H + 8;
    nodes.push({
      id: `kube-${kn.id}`,
      type: 'kube',
      position: { x, y },
      data: { node: kn, podCount: podsHere.length },
      style: { width: NODE_W, height },
      draggable: true,
    });
    podsHere.forEach((pod, i) => {
      nodes.push({
        id: `pod-${pod.id}`,
        type: 'pod',
        position: { x: x + 26, y: y + KUBE_HEADER + i * POD_H },
        data: { pod, highlighted: trace?.chosenPod === pod.name },
        draggable: true,
      });
    });
  });

  // ── overlay del paquete (traza activa) ──
  if (trace) {
    const chain: string[] = [];
    const srcPod = resolveSourcePod(cluster, trace.request);

    if (trace.request.source.kind === 'external-client') {
      chain.push('client');
      if (stack.edge !== 'none') chain.push('edge-gw');
    } else if (srcPod) {
      chain.push(`pod-${srcPod.id}`);
      // salto DNS hacia CoreDNS
      if (trace.dnsQueries?.length) {
        const coredns = cluster.pods.find(
          (p) => p.owner?.name === 'coredns' && p.status === 'Running'
        );
        if (coredns) {
          edges.push(
            packetEdge(`pod-${srcPod.id}`, `pod-${coredns.id}`, `pkt-dns-${trace.id}`, '#fbbf24', true)
          );
        }
      }
    }

    if (trace.targetServiceId) chain.push(`svc-${trace.targetServiceId}`);
    const chosen = trace.chosenPod ? cluster.pods.find((p) => p.name === trace.chosenPod) : undefined;
    if (chosen) chain.push(`pod-${chosen.id}`);

    const color = OUTCOME_COLORS[trace.outcome] ?? '#22d3ee';
    for (let i = 0; i < chain.length - 1; i++) {
      edges.push(packetEdge(chain[i], chain[i + 1], `pkt-${trace.id}-${i}`, color, false));
    }
  }

  return { nodes, edges };
}

function baseEdge(source: string, target: string, id: string, animated = false): RFEdge {
  return {
    id,
    source,
    target,
    type: 'default',
    animated,
    style: { stroke: '#334155', strokeWidth: 1, opacity: animated ? 0.8 : 0.45 },
  };
}

function packetEdge(source: string, target: string, id: string, color: string, dashed: boolean): RFEdge {
  return {
    id,
    source,
    target,
    type: 'packet',
    data: { color, dashed, dur: '1.2s' },
    zIndex: 10,
  };
}

export function TopologyCanvas() {
  const cluster = usePlayground((s) => s.cluster);
  const stack = usePlayground((s) => s.stack);
  const traces = usePlayground((s) => s.recentTraces);
  const selectedTraceId = usePlayground((s) => s.selectedTraceId);
  const running = usePlayground((s) => s.running);
  const scenarioId = usePlayground((s) => s.scenarioId);
  const focusNamespace = getScenario(scenarioId).focusNamespace;

  const trace = useMemo(
    () => traces.find((t) => t.id === selectedTraceId) ?? null,
    [traces, selectedTraceId]
  );

  const graph = useMemo(
    () => buildGraph(cluster, stack, trace, running, focusNamespace),
    [cluster, stack, trace, running, focusNamespace]
  );

  return (
    <div className="h-full w-full">
      <ReactFlow
        nodes={graph.nodes}
        edges={graph.edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={{ padding: 0.12, maxZoom: 0.95 }}
        minZoom={0.15}
        maxZoom={1.6}
        proOptions={{ hideAttribution: true }}
        nodesConnectable={false}
        deleteKeyCode={null}
        className="bg-transparent"
      >
        <Background variant={BackgroundVariant.Dots} gap={26} size={1.4} color="#1e293b" />
        <Controls
          className="!border !border-slate-700 !bg-slate-900 [&>button]:!border-slate-700 [&>button]:!bg-slate-900 [&>button]:!fill-slate-300 [&>button:hover]:!bg-slate-800"
          showInteractive={false}
        />
        <MiniMap
          pannable
          zoomable
          className="!border !border-slate-700 !bg-slate-950"
          maskColor="rgba(9,9,11,0.75)"
          nodeColor={(n) => {
            if (n.type === 'kube') return '#1e293b';
            if (n.type === 'pod') return '#166534';
            if (n.type === 'svc') return '#78350f';
            return '#312e81';
          }}
        />
      </ReactFlow>
    </div>
  );
}

/** helpers reutilizables */
export function podNodeId(pod: Pod): string {
  return `pod-${pod.id}`;
}
