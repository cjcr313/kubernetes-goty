'use client';

/**
 * Métricas en vivo (Recharts): latencia p50/p95/p99, RPS + error rate,
 * réplicas HPA y DNS QPS.
 */
import { useMemo } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';
import { usePlayground } from '@/lib/store';

const tooltipStyle = {
  backgroundColor: '#0f0f12',
  border: '1px solid #27272a',
  borderRadius: 8,
  fontSize: 11,
  fontFamily: 'ui-monospace, monospace',
};

export function MetricsPanel() {
  const history = usePlayground((s) => s.metricsHistory);
  const rps = usePlayground((s) => s.rps);

  const data = useMemo(
    () =>
      history.map((m, i) => ({
        t: i,
        p50: m.latency.p50,
        p95: m.latency.p95,
        p99: m.latency.p99,
        rps: m.rps,
        err: m.errorRate,
        dns: m.dnsQps,
        replicas: Object.values(m.replicasByDeployment).reduce((a, b) => a + b, 0),
      })),
    [history]
  );

  if (data.length < 2) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-slate-600">
        recolectando métricas…
      </div>
    );
  }

  return (
    <div className="grid h-full grid-cols-1 gap-2 overflow-y-auto p-2 xl:grid-cols-2 [scrollbar-width:thin]">
      {/* Latencia */}
      <section className="rounded-lg border border-slate-800 bg-slate-900/50 p-2">
        <h3 className="px-1 pb-1 text-[10px] font-bold uppercase tracking-widest text-slate-500">
          Latencia (packet-walk completo)
        </h3>
        <div className="h-[130px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
              <XAxis dataKey="t" hide />
              <YAxis width={42} tick={{ fill: '#475569', fontSize: 9 }} stroke="#1e293b" />
              <Tooltip contentStyle={tooltipStyle} />
              <Line type="monotone" dataKey="p50" stroke="#38bdf8" strokeWidth={1.5} dot={false} name="p50" />
              <Line type="monotone" dataKey="p95" stroke="#f59e0b" strokeWidth={1.5} dot={false} name="p95" />
              <Line type="monotone" dataKey="p99" stroke="#ef4444" strokeWidth={1.5} dot={false} name="p99" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* Throughput + errores */}
      <section className="rounded-lg border border-slate-800 bg-slate-900/50 p-2">
        <h3 className="px-1 pb-1 text-[10px] font-bold uppercase tracking-widest text-slate-500">
          Throughput · error rate @ {rps.toLocaleString('en-US')} RPS
        </h3>
        <div className="h-[130px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="rpsFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#22d3ee" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#22d3ee" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
              <XAxis dataKey="t" hide />
              <YAxis width={42} tick={{ fill: '#475569', fontSize: 9 }} stroke="#1e293b" />
              <Tooltip contentStyle={tooltipStyle} />
              <Area type="monotone" dataKey="rps" stroke="#22d3ee" strokeWidth={1.5} fill="url(#rpsFill)" name="rps" />
              <Line type="monotone" dataKey="err" stroke="#f472b6" strokeWidth={1.5} dot={false} name="% err" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* HPA réplicas */}
      <section className="rounded-lg border border-slate-800 bg-slate-900/50 p-2">
        <h3 className="px-1 pb-1 text-[10px] font-bold uppercase tracking-widest text-slate-500">
          Réplicas running (HPA)
        </h3>
        <div className="h-[130px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
              <XAxis dataKey="t" hide />
              <YAxis width={28} allowDecimals={false} tick={{ fill: '#475569', fontSize: 9 }} stroke="#1e293b" />
              <Tooltip contentStyle={tooltipStyle} />
              <Line type="stepAfter" dataKey="replicas" stroke="#a78bfa" strokeWidth={1.5} dot={false} name="pods" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* DNS QPS */}
      <section className="rounded-lg border border-slate-800 bg-slate-900/50 p-2">
        <h3 className="px-1 pb-1 text-[10px] font-bold uppercase tracking-widest text-slate-500">
          DNS queries / seg (castigo ndots)
        </h3>
        <div className="h-[130px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="dnsFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#fbbf24" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#fbbf24" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
              <XAxis dataKey="t" hide />
              <YAxis width={46} tick={{ fill: '#475569', fontSize: 9 }} stroke="#1e293b" />
              <Tooltip contentStyle={tooltipStyle} />
              <Area type="monotone" dataKey="dns" stroke="#fbbf24" strokeWidth={1.5} fill="url(#dnsFill)" name="qps" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </section>
    </div>
  );
}
