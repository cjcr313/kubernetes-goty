'use client';

/**
 * Árbol de recursos estilo Lens/k9s: namespaces → workloads + pods,
 * services con endpoints.
 */
import { ChevronRight, Box, Waypoints } from 'lucide-react';
import { useMemo, useState } from 'react';
import { usePlayground } from '@/lib/store';
import { getScenario } from '@/scenarios';
import { POD_STATUS_COLORS, cn } from '@/lib/utils';

export function ResourceTree() {
  const cluster = usePlayground((s) => s.cluster);
  const scenarioId = usePlayground((s) => s.scenarioId);
  const focus = getScenario(scenarioId).focusNamespace;

  const namespaces = useMemo(() => {
    const set = new Set<string>();
    cluster.pods.forEach((p) => set.add(p.namespace));
    const arr = [...set].sort((a, b) => {
      if (a === focus) return -1;
      if (b === focus) return 1;
      return a.localeCompare(b);
    });
    return arr;
  }, [cluster.pods, focus]);

  return (
    <div className="flex h-full flex-col overflow-y-auto p-2 [scrollbar-width:thin]">
      <div className="px-2 pb-2 pt-1 font-mono text-[10px] uppercase tracking-widest text-slate-600">
        {cluster.name} · {cluster.version}
      </div>
      {namespaces.map((ns) => (
        <NamespaceSection key={ns} namespace={ns} defaultOpen={ns === focus} />
      ))}
    </div>
  );
}

function NamespaceSection({ namespace, defaultOpen }: { namespace: string; defaultOpen: boolean }) {
  const cluster = usePlayground((s) => s.cluster);
  const [open, setOpen] = useState(defaultOpen);
  const workloads = cluster.workloads.filter((w) => w.namespace === namespace);
  const services = cluster.services.filter((s) => s.namespace === namespace);

  return (
    <div className="mb-0.5">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-1 rounded px-2 py-1.5 text-left hover:bg-slate-800/60"
      >
        <ChevronRight
          className={cn('h-3.5 w-3.5 text-slate-500 transition-transform', open && 'rotate-90')}
        />
        <span className="font-mono text-xs font-semibold text-slate-200">{namespace}</span>
        <span className="ml-auto font-mono text-[10px] text-slate-600">
          {cluster.pods.filter((p) => p.namespace === namespace).length} pods
        </span>
      </button>
      {open && (
        <div className="ml-4 border-l border-slate-800 pl-2">
          {workloads.map((wl) => (
            <div key={wl.id} className="py-0.5">
              <div className="flex items-center gap-1.5 px-1 py-0.5">
                <Box className="h-3 w-3 text-slate-500" />
                <span className="font-mono text-[11px] text-slate-300">{wl.name}</span>
                <span className="rounded bg-slate-800 px-1 font-mono text-[9px] text-slate-500">
                  {wl.kind}
                </span>
                <span className="ml-auto font-mono text-[10px] text-slate-500">
                  {cluster.pods.filter((p) => p.owner?.name === wl.name && p.namespace === namespace && p.status !== 'Terminating').length}/
                  {wl.replicas}
                </span>
              </div>
              {cluster.pods
                .filter((p) => p.owner?.name === wl.name && p.namespace === namespace)
                .map((pod) => (
                  <div key={pod.id} className="flex items-center gap-1.5 py-px pl-4">
                    <span
                      className="h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{ backgroundColor: POD_STATUS_COLORS[pod.status] ?? '#64748b' }}
                      title={pod.status}
                    />
                    <span className="truncate font-mono text-[10px] text-slate-400">{pod.name}</span>
                    <span className="ml-auto shrink-0 font-mono text-[9px] text-slate-600">
                      {pod.podIP ?? pod.status}
                    </span>
                  </div>
                ))}
            </div>
          ))}
          {services.map((svc) => (
            <div key={svc.id} className="flex items-center gap-1.5 px-1 py-0.5">
              <Waypoints className="h-3 w-3 text-amber-500/70" />
              <span className="font-mono text-[11px] text-slate-300">svc/{svc.name}</span>
              <span className="rounded bg-slate-800 px-1 font-mono text-[9px] text-slate-500">{svc.type}</span>
              <span className="ml-auto font-mono text-[10px] text-slate-500">
                {svc.clusterIP ?? 'headless'} · {svc.endpoints.length} ep
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
