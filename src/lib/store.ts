/**
 * Estado global del playground (zustand): clúster vivo + stack conmutable +
 * loop de simulación. Un tick ≈ 1 segundo de clúster.
 */
'use client';

import { create } from 'zustand';
import type {
  ClusterState,
  CniConfig,
  DnsConfig,
  EdgeStack,
  LogEntry,
  MetricsSnapshot,
  PacketTrace,
  ProxyMode,
  RequestProfile,
  StackConfig,
} from '@/domain/types';
import { advanceLifecycles } from '@/engine/lifecycle';
import { reconcileHpas } from '@/engine/hpa-controller';
import { runTickTraffic } from '@/engine/traffic-generator';
import { getScenario } from '@/scenarios';

interface PlaygroundState {
  scenarioId: string;
  cluster: ClusterState;
  stack: StackConfig;
  requestProfiles: RequestProfile[];
  cpuPerRps: number;
  rps: number;
  running: boolean;
  speed: number;
  metricsHistory: MetricsSnapshot[];
  recentTraces: PacketTrace[];
  selectedTraceId: string | null;
  log: LogEntry[];

  loadScenario: (id: string) => void;
  tick: () => void;
  setProxy: (proxy: ProxyMode) => void;
  setCni: (patch: Partial<CniConfig> & { plugin?: CniConfig['plugin'] }) => void;
  setDns: (patch: Partial<DnsConfig>) => void;
  setEdge: (edge: EdgeStack) => void;
  setRps: (rps: number) => void;
  setSpeed: (speed: number) => void;
  toggleRun: () => void;
  selectTrace: (id: string | null) => void;
}

function bootstrap(id: string) {
  const scenario = getScenario(id);
  return {
    scenarioId: scenario.id,
    cluster: scenario.buildCluster(),
    stack: JSON.parse(JSON.stringify(scenario.defaultStack)) as StackConfig,
    requestProfiles: scenario.requestProfiles,
    cpuPerRps: scenario.cpuPerRps,
    rps: scenario.defaultRps,
    running: true,
    speed: 1,
    metricsHistory: [] as MetricsSnapshot[],
    recentTraces: [] as PacketTrace[],
    selectedTraceId: null,
    log: [{ tick: 0, text: `Escenario "${scenario.name}" cargado — simulación corriendo`, kind: 'info' }] as LogEntry[],
  };
}

export const usePlayground = create<PlaygroundState>()((set, get) => ({
  ...bootstrap('ndots-dns-penalty'),

  loadScenario: (id) => set(bootstrap(id)),

  tick: () => {
    const state = get();
    if (!state.running) return;
    const cluster = state.cluster;

    const lifecycleEvents = advanceLifecycles(cluster);
    const hpaEvents = reconcileHpas(cluster);
    const { traces, metrics } = runTickTraffic(
      cluster,
      state.stack,
      state.rps,
      state.requestProfiles,
      state.cpuPerRps
    );
    cluster.tick += 1;

    const newLogs: LogEntry[] = [
      ...lifecycleEvents.map((text) => ({ tick: cluster.tick, text, kind: 'net' as const })),
      ...hpaEvents.map((text) => ({ tick: cluster.tick, text, kind: 'scale' as const })),
    ];

    // selección: mantener si sigue vivo el id; si no, auto-elegir el trace
    // MÁS VISUAL (ruta completa svc→pod) para que el packet-walk siempre se vea
    const bestTrace =
      traces.find((t) => t.chosenPod && t.targetServiceId) ??
      traces.find((t) => t.dnsQueries?.length) ??
      traces[0] ??
      null;
    const selectedTraceId =
      state.selectedTraceId && traces.some((t) => t.id === state.selectedTraceId)
        ? state.selectedTraceId
        : bestTrace?.id ?? null;

    set({
      cluster: { ...cluster },
      recentTraces: traces,
      selectedTraceId,
      metricsHistory: [...state.metricsHistory, metrics].slice(-180),
      log: newLogs.length ? [...state.log, ...newLogs].slice(-120) : state.log,
    });
  },

  setProxy: (proxy) => {
    const stack = { ...get().stack, proxy };
    // coherencia: kube-proxy replacement requiere cilium
    if (proxy === 'none-ebpf') {
      stack.cni = { ...stack.cni, plugin: 'cilium', cilium: { ...stack.cni.cilium, kubeProxyReplacement: true } };
    } else if (stack.cni.plugin === 'cilium' && stack.cni.cilium.kubeProxyReplacement) {
      stack.cni = { ...stack.cni, cilium: { ...stack.cni.cilium, kubeProxyReplacement: false } };
    }
    set({ stack });
  },

  setCni: (patch) => {
    const cni = { ...get().stack.cni, ...patch } as CniConfig;
    const stack = { ...get().stack, cni };
    // si activamos kube-proxy replacement con cilium, el proxy se apaga
    if (cni.plugin === 'cilium' && cni.cilium.kubeProxyReplacement) {
      stack.proxy = 'none-ebpf';
    }
    set({ stack });
  },

  setDns: (patch) => set({ stack: { ...get().stack, dns: { ...get().stack.dns, ...patch } } }),

  setEdge: (edge) => set({ stack: { ...get().stack, edge } }),

  setRps: (rps) => set({ rps }),

  setSpeed: (speed) => set({ speed }),

  toggleRun: () => set({ running: !get().running }),

  selectTrace: (id) => set({ selectedTraceId: id }),
}));
