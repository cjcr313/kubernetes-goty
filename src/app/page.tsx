'use client';

/**
 * kubernetes-goty — layout principal:
 *   ┌ header: escenario · play/pause · velocidad · RPS ┐
 *   ├ left: árbol de recursos ─────────────────────────┤
 *   ├ center: canvas de topología + inspector de hops ┤
 *   └ right: stack switcher + métricas en vivo ────────┘
 */
import { Play, Pause, Gauge, Trophy } from 'lucide-react';
import { useEffect, useState } from 'react';
import { EngineTicker } from '@/components/EngineTicker';
import { TopologyCanvas } from '@/components/topology/TopologyCanvas';
import { TraceInspector } from '@/components/topology/TraceInspector';
import { ResourceTree } from '@/components/resources/ResourceTree';
import { YamlEditor } from '@/components/resources/YamlEditor';
import { MetricsPanel } from '@/components/metrics/MetricsPanel';
import { StackSwitcher } from '@/components/controls/StackSwitcher';
import { usePlayground } from '@/lib/store';
import { getScenario, SCENARIOS } from '@/scenarios';
import { cn } from '@/lib/utils';

export default function Home() {
  const scenarioId = usePlayground((s) => s.scenarioId);
  const loadScenario = usePlayground((s) => s.loadScenario);
  const running = usePlayground((s) => s.running);
  const toggleRun = usePlayground((s) => s.toggleRun);
  const rps = usePlayground((s) => s.rps);
  const setRps = usePlayground((s) => s.setRps);
  const speed = usePlayground((s) => s.speed);
  const setSpeed = usePlayground((s) => s.setSpeed);
  const cluster = usePlayground((s) => s.cluster);
  const log = usePlayground((s) => s.log);
  const scenario = getScenario(scenarioId);

  // gate de montaje: el estado del clúster es random en cada carga, así que el
  // HTML prerenderizado nunca calza con el cliente → hidratar solo el skeleton
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // slider logarítmico 10 → 100.000 RPS
  const sliderValue = Math.log10(rps);
  const onSlider = (v: number) => setRps(Math.round(Math.pow(10, v)));

  if (!mounted) {
    return (
      <div className="flex h-screen items-center justify-center bg-ink-950">
        <div className="flex items-center gap-3 text-slate-500">
          <Trophy className="h-6 w-6 animate-pulse text-amber-400" />
          <span className="font-mono text-sm">cargando kubernetes.goty…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <EngineTicker />

      {/* ── header ── */}
      <header className="flex shrink-0 items-center gap-3 border-b border-slate-800 bg-ink-900 px-4 py-2">
        <div className="flex items-center gap-2">
          <Trophy className="h-5 w-5 text-amber-400" />
          <span className="font-mono text-sm font-bold tracking-tight text-slate-100">
            kubernetes<span className="text-amber-400">.goty</span>
          </span>
        </div>

        <select
          value={scenarioId}
          onChange={(e) => loadScenario(e.target.value)}
          className="max-w-[340px] rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200 outline-none focus:border-cyan-600"
        >
          {SCENARIOS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.difficulty === 'intro' ? '🟢' : s.difficulty === 'media' ? '🟡' : '🔴'} {s.name}
            </option>
          ))}
        </select>

        <button
          onClick={toggleRun}
          className={cn(
            'flex items-center gap-1.5 rounded px-3 py-1 text-xs font-medium',
            running
              ? 'bg-amber-700 text-amber-50 hover:bg-amber-600'
              : 'bg-emerald-700 text-emerald-50 hover:bg-emerald-600'
          )}
        >
          {running ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          {running ? 'pausar' : 'simular'}
        </button>

        <div className="flex items-center gap-2">
          <Gauge className="h-4 w-4 text-slate-500" />
          <input
            type="range"
            min={1}
            max={5}
            step={0.05}
            value={sliderValue}
            onChange={(e) => onSlider(Number(e.target.value))}
            className="w-44 accent-cyan-500"
          />
          <span className="w-20 font-mono text-[11px] text-cyan-300">
            {rps.toLocaleString('en-US')} rps
          </span>
        </div>

        <div className="flex items-center gap-1 font-mono text-[11px] text-slate-500">
          vel
          {[1, 2, 4].map((v) => (
            <button
              key={v}
              onClick={() => setSpeed(v)}
              className={cn(
                'rounded px-1.5 py-0.5',
                speed === v ? 'bg-slate-700 text-slate-200' : 'hover:bg-slate-800'
              )}
            >
              {v}×
            </button>
          ))}
        </div>

        <div className="ml-auto font-mono text-[10px] text-slate-600">
          tick {cluster.tick} · {cluster.nodes.length} nodos ·{' '}
          {cluster.pods.filter((p) => p.status === 'Running').length} pods running
        </div>
      </header>

      {/* ── objectives banner ── */}
      <div className="shrink-0 border-b border-slate-800 bg-ink-900/70 px-4 py-1.5">
        <p className="truncate text-[11px] text-slate-400">
          <span className="font-semibold text-slate-300">{scenario.name}:</span>{' '}
          {scenario.tagline}
        </p>
      </div>

      {/* ── main grid ── */}
      <div className="grid min-h-0 flex-1 grid-cols-12 gap-2 p-2">
        {/* left: recursos + yaml */}
        <div className="col-span-2 flex min-h-0 flex-col gap-2">
          <div className="min-h-0 flex-[3] overflow-hidden rounded-xl border border-slate-800 bg-ink-900/60">
            <ResourceTree />
          </div>
          <div className="min-h-0 flex-[2] overflow-hidden rounded-xl border border-slate-800 bg-ink-900/60">
            <YamlEditor />
          </div>
        </div>

        {/* center: canvas + inspector */}
        <div className="col-span-7 flex min-h-0 flex-col gap-2">
          <div className="min-h-0 flex-[5] overflow-hidden rounded-xl border border-slate-800 bg-ink-900/40">
            <TopologyCanvas />
          </div>
          <div className="min-h-0 flex-[3] overflow-hidden rounded-xl border border-slate-800 bg-ink-900/60">
            <TraceInspector />
          </div>
        </div>

        {/* right: stack + métricas + log */}
        <div className="col-span-3 flex min-h-0 flex-col gap-2">
          <StackSwitcher />
          <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-slate-800 bg-ink-900/60">
            <MetricsPanel />
          </div>
          <div className="h-28 shrink-0 overflow-y-auto rounded-xl border border-slate-800 bg-ink-900/60 p-2 font-mono text-[10px] leading-relaxed [scrollbar-width:thin]">
            {log
              .slice()
              .reverse()
              .map((entry, i) => (
                <div key={i} className="flex gap-2">
                  <span className="shrink-0 text-slate-700">t{entry.tick}</span>
                  <span
                    className={cn(
                      entry.kind === 'scale' && 'text-purple-300',
                      entry.kind === 'net' && 'text-sky-300',
                      entry.kind === 'warn' && 'text-red-300',
                      entry.kind === 'info' && 'text-slate-400'
                    )}
                  >
                    {entry.text}
                  </span>
                </div>
              ))}
          </div>
        </div>
      </div>
    </div>
  );
}
