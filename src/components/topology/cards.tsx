'use client';

/**
 * Custom node cards para React Flow (v12).
 */
import { memo } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { Server, Box, Globe, Waypoints, Cpu, TriangleAlert, Cloud } from 'lucide-react';
import type { EdgeStack, KubeNode, KubeService, Pod } from '@/domain/types';
import { POD_STATUS_COLORS, cn } from '@/lib/utils';

/** Handles invisibles pero medibles: React Flow ancla las aristas aquí. */
const hiddenHandle = '!h-1.5 !w-1.5 !border-0 !bg-transparent !opacity-0 !pointer-events-none';
function HocHandles({ target = true, source = true }: { target?: boolean; source?: boolean }) {
  return (
    <>
      {target && <Handle type="target" position={Position.Left} className={hiddenHandle} isConnectable={false} />}
      {source && <Handle type="source" position={Position.Right} className={hiddenHandle} isConnectable={false} />}
    </>
  );
}

// ── tipos RF ──
export type ClientRFNode = Node<{ label?: string }, 'client'>;
export type EdgeGwRFNode = Node<{ stack: EdgeStack }, 'edgeGw'>;
export type ServiceRFNode = Node<{ svc: KubeService; highlighted?: boolean }, 'svc'>;
export type PodRFNode = Node<{ pod: Pod; highlighted?: boolean }, 'pod'>;
export type KubeNodeRFNode = Node<{ node: KubeNode; podCount: number }, 'kube'>;

const EDGE_LABELS: Record<EdgeStack, string> = {
  none: 'sin edge',
  'ingress-nginx': 'Ingress NGINX',
  'gateway-envoy': 'Gateway API · Envoy',
  'gateway-istio-ambient': 'Gateway API · Istio ambient',
};

export function ClientCard({ data }: NodeProps<ClientRFNode>) {
  return (
    <div className="w-[170px] rounded-lg border border-slate-700 bg-slate-900/90 px-3 py-2.5 shadow-lg backdrop-blur">
      <div className="flex items-center gap-2">
        <Globe className="h-4 w-4 text-sky-400" />
        <div className="text-xs font-semibold text-slate-200">{data.label ?? 'Cliente'}</div>
      </div>
      <div className="mt-1 font-mono text-[10px] text-slate-500">internet / navegador</div>
      <HocHandles source />
    </div>
  );
}

export function EdgeGwCard({ data }: NodeProps<EdgeGwRFNode>) {
  return (
    <div className="w-[210px] rounded-lg border border-indigo-700/60 bg-indigo-950/70 px-3 py-2.5 shadow-lg">
      <div className="flex items-center gap-2">
        <Waypoints className="h-4 w-4 text-indigo-300" />
        <div className="text-xs font-semibold text-indigo-100">Edge</div>
      </div>
      <div className="mt-1 font-mono text-[10px] text-indigo-300/80">{EDGE_LABELS[data.stack]}</div>
      <HocHandles />
    </div>
  );
}

export function ServiceCard({ data }: NodeProps<ServiceRFNode>) {
  const { svc, highlighted } = data;
  return (
    <div
      className={cn(
        'w-[230px] rounded-lg border px-3 py-2.5 shadow-lg backdrop-blur transition-all',
        highlighted
          ? 'border-cyan-400 bg-cyan-950/80 ring-2 ring-cyan-400/60'
          : 'border-slate-700 bg-slate-900/90'
      )}
    >
      <div className="flex items-center gap-2">
        <Waypoints className="h-4 w-4 text-amber-300" />
        <div className="truncate text-xs font-semibold text-slate-200">
          svc/{svc.name}
        </div>
        <span className="ml-auto rounded bg-slate-800 px-1.5 py-0.5 text-[9px] font-medium text-slate-400">
          {svc.type}
        </span>
      </div>
      <div className="mt-1 flex items-center justify-between font-mono text-[10px]">
        <span className="text-slate-500">{svc.clusterIP ?? 'headless'}:{svc.port}</span>
        <span
          className={cn(
            'rounded px-1',
            svc.endpoints.length > 0 ? 'bg-emerald-950 text-emerald-400' : 'bg-red-950 text-red-400'
          )}
        >
          {svc.endpoints.length} ep
        </span>
      </div>
      <HocHandles />
    </div>
  );
}

export function PodCard({ data }: NodeProps<PodRFNode>) {
  const { pod, highlighted } = data;
  const color = POD_STATUS_COLORS[pod.status] ?? '#64748b';
  const req = pod.containers[0]?.resources.requests?.cpuMillis ?? 100;
  const pct = Math.min(130, Math.round((pod.cpuUsageMillis / req) * 100));
  return (
    <div
      className={cn(
        'w-[300px] rounded-lg border px-3 py-2 shadow-md backdrop-blur transition-all',
        highlighted
          ? 'border-cyan-400 bg-cyan-950/80 ring-2 ring-cyan-400/60'
          : 'border-slate-700/80 bg-slate-900/85'
      )}
    >
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
        <span className="truncate font-mono text-[11px] text-slate-300">{pod.name}</span>
        {pod.status === 'CrashLoopBackOff' && (
          <TriangleAlert className="ml-auto h-3.5 w-3.5 shrink-0 text-red-400" />
        )}
      </div>
      <div className="mt-1.5 flex items-center gap-2">
        <Cpu className="h-3 w-3 shrink-0 text-slate-500" />
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-800">
          <div
            className="h-full rounded-full transition-all"
            style={{
              width: `${Math.min(100, pct)}%`,
              backgroundColor: pct > 85 ? '#ef4444' : pct > 65 ? '#eab308' : '#22c55e',
            }}
          />
        </div>
        <span className="shrink-0 font-mono text-[9px] text-slate-500">
          {pod.cpuUsageMillis}m/{req}m
        </span>
      </div>
      <div className="mt-1 flex justify-between font-mono text-[9px] text-slate-600">
        <span>{pod.podIP ?? 'sin IP'}</span>
        <span>
          {pod.namespace} · {pod.nodeName}
          {pod.restarts > 0 ? ` · ↻${pod.restarts}` : ''}
        </span>
      </div>
      <HocHandles />
    </div>
  );
}

export function KubeNodeCard({ data }: NodeProps<KubeNodeRFNode>) {
  const { node, podCount } = data;
  const isCp = node.role === 'control-plane';
  return (
    <div className="flex h-full flex-col rounded-xl border border-dashed border-slate-600/70 bg-slate-950/40 p-2">
      <div className="flex items-center gap-2 px-1 pb-1">
        <Server className="h-4 w-4 text-slate-400" />
        <span className="text-xs font-semibold text-slate-300">{node.name}</span>
        <span
          className={cn(
            'ml-auto rounded px-1.5 py-0.5 text-[9px] font-medium',
            isCp ? 'bg-purple-950 text-purple-300' : 'bg-slate-800 text-slate-400'
          )}
        >
          {isCp ? 'control-plane' : 'worker'}
        </span>
      </div>
      <div className="flex items-center gap-1.5 px-1 pb-1 font-mono text-[9px] text-slate-600">
        <Box className="h-3 w-3" />
        {node.podCIDR} · {podCount} pods · {node.internalIP}
      </div>
    </div>
  );
}

export function InternetCard() {
  return (
    <div className="w-[190px] rounded-lg border border-dashed border-cyan-800/70 bg-cyan-950/40 px-3 py-2.5 shadow-lg backdrop-blur">
      <div className="flex items-center gap-2">
        <Cloud className="h-4 w-4 text-cyan-300" />
        <div className="text-xs font-semibold text-cyan-100">Internet / upstream</div>
      </div>
      <div className="mt-1 font-mono text-[10px] text-cyan-300/70">egress → SNAT → internet</div>
      <HocHandles />
    </div>
  );
}

export const nodeTypes = {
  client: memo(ClientCard),
  edgeGw: memo(EdgeGwCard),
  svc: memo(ServiceCard),
  pod: memo(PodCard),
  kube: memo(KubeNodeCard),
  cloud: memo(InternetCard),
};
