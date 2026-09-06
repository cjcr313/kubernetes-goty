'use client';

/**
 * Inspector de trazas: chips de requests recientes + timeline hop-by-hop
 * del paquete seleccionado (capa, componente kernel, ops, latencia).
 */
import { usePlayground } from '@/lib/store';
import { OUTCOME_COLORS, fmtMs } from '@/lib/utils';
import type { HopLayer } from '@/domain/types';
import { cn } from '@/lib/utils';

const LAYER_COLORS: Record<HopLayer, string> = {
  client: 'text-slate-400 bg-slate-800/60',
  edge: 'text-indigo-300 bg-indigo-950/60',
  dns: 'text-amber-300 bg-amber-950/40',
  L4: 'text-sky-300 bg-sky-950/40',
  L3: 'text-cyan-300 bg-cyan-950/40',
  kernel: 'text-fuchsia-300 bg-fuchsia-950/40',
  pod: 'text-emerald-300 bg-emerald-950/40',
  return: 'text-slate-500 bg-slate-900',
};

const OP_COLORS: Record<string, string> = {
  DNAT: 'bg-sky-950 text-sky-300 border-sky-800',
  SNAT: 'bg-sky-950 text-sky-300 border-sky-800',
  ENCAP: 'bg-orange-950 text-orange-300 border-orange-800',
  DECAP: 'bg-orange-950 text-orange-300 border-orange-800',
  'BPF-LOOKUP': 'bg-fuchsia-950 text-fuchsia-300 border-fuchsia-800',
  'POLICY-CHECK': 'bg-yellow-950 text-yellow-300 border-yellow-800',
  DROP: 'bg-red-950 text-red-300 border-red-800',
  'FAULT-INJECT': 'bg-red-950 text-red-300 border-red-800',
  'WEIGHTED-SPLIT': 'bg-purple-950 text-purple-300 border-purple-800',
  'LB-SELECT': 'bg-purple-950 text-purple-300 border-purple-800',
  'DNS-UPSTREAM': 'bg-amber-950 text-amber-300 border-amber-800',
};

export function TraceInspector() {
  const traces = usePlayground((s) => s.recentTraces);
  const selectedTraceId = usePlayground((s) => s.selectedTraceId);
  const selectTrace = usePlayground((s) => s.selectTrace);
  const trace = traces.find((t) => t.id === selectedTraceId) ?? traces[0];

  if (!trace) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-xs text-slate-600">
        Sin trazas aún — presiona ▶ para iniciar la simulación
      </div>
    );
  }

  const outcomeColor = OUTCOME_COLORS[trace.outcome] ?? '#64748b';

  return (
    <div className="flex h-full flex-col">
      {/* chips de traces recientes */}
      <div className="flex gap-1.5 overflow-x-auto border-b border-slate-800 px-3 py-2 [scrollbar-width:thin]">
        {traces.map((t) => (
          <button
            key={t.id}
            onClick={() => selectTrace(t.id)}
            className={cn(
              'flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-[10px] transition-colors',
              t.id === trace.id
                ? 'border-slate-500 bg-slate-800'
                : 'border-slate-800 bg-slate-900/60 hover:border-slate-600'
            )}
          >
            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: OUTCOME_COLORS[t.outcome] }} />
            <span className="text-slate-400">{t.request.destination.name}</span>
            <span className="text-slate-600">{fmtMs(t.totalLatencyMs)}</span>
          </button>
        ))}
      </div>

      {/* resumen */}
      <div className="flex items-center gap-3 border-b border-slate-800 px-4 py-2">
        <span
          className="rounded px-2 py-0.5 text-[10px] font-bold"
          style={{ backgroundColor: `${outcomeColor}22`, color: outcomeColor }}
        >
          {trace.outcome}
        </span>
        <span className="font-mono text-[11px] text-slate-400">
          {fmtMs(trace.totalLatencyMs)} · {trace.hops.length} hops
        </span>
        <span className="ml-auto font-mono text-[10px] text-slate-600">
          {trace.request.source.kind === 'pod'
            ? `${trace.request.source.namespace}/${trace.request.source.ref?.split('/').pop()}`
            : 'cliente externo'}{' '}
          → {trace.request.destination.name}
        </span>
      </div>

      {/* timeline de hops */}
      <div className="flex-1 overflow-y-auto px-4 py-3 [scrollbar-width:thin]">
        <ol className="relative space-y-3 border-l border-slate-800 pl-5">
          {trace.hops.map((hop) => (
            <li key={hop.index} className="relative">
              <span
                className="absolute -left-[27px] top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full border-2 border-slate-950"
                style={{ backgroundColor: hopColor(hop.layer) }}
              />
              <div className="flex flex-wrap items-center gap-1.5">
                <span className={cn('rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide', LAYER_COLORS[hop.layer])}>
                  {hop.layer}
                </span>
                <span className="font-mono text-[11px] font-semibold text-slate-200">{hop.component}</span>
                <span className="ml-auto font-mono text-[10px] text-slate-500">
                  {hop.node} {hop.latencyMs > 0 ? `· +${fmtMs(hop.latencyMs)}` : ''}
                </span>
              </div>
              <p className="mt-0.5 text-[11px] leading-snug text-slate-400">{hop.detail}</p>
              {hop.ops.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {hop.ops.map((op) => (
                    <span
                      key={op}
                      className={cn(
                        'rounded border px-1 py-px font-mono text-[9px]',
                        OP_COLORS[op] ?? 'border-slate-700 bg-slate-800 text-slate-400'
                      )}
                    >
                      {op}
                    </span>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ol>

        {/* queries DNS */}
        {trace.dnsQueries && trace.dnsQueries.length > 0 && (
          <div className="mt-4 rounded-lg border border-amber-900/50 bg-amber-950/20 p-3">
            <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-amber-300">
              Resolución DNS ({trace.dnsQueries.length} queries)
            </div>
            {trace.dnsQueries.map((q, i) => (
              <div key={i} className="flex items-baseline gap-2 font-mono text-[10px]">
                <span
                  className={
                    q.outcome === 'HIT'
                      ? 'text-emerald-400'
                      : q.outcome === 'NXDOMAIN'
                        ? 'text-red-400'
                        : 'text-amber-400'
                  }
                >
                  {q.outcome}
                </span>
                <span className="truncate text-slate-300">{q.qname}</span>
                <span className="ml-auto shrink-0 text-slate-600">
                  {q.answeredBy} · {fmtMs(q.latencyMs)}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* anotaciones */}
        {trace.annotations.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {trace.annotations.map((a, i) => (
              <span
                key={i}
                className="rounded border border-slate-700/70 bg-slate-900 px-2 py-0.5 font-mono text-[10px] text-slate-400"
              >
                {a}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function hopColor(layer: HopLayer): string {
  switch (layer) {
    case 'client': return '#64748b';
    case 'edge': return '#818cf8';
    case 'dns': return '#fbbf24';
    case 'L4': return '#38bdf8';
    case 'L3': return '#22d3ee';
    case 'kernel': return '#e879f9';
    case 'pod': return '#34d399';
    case 'return': return '#475569';
  }
}
