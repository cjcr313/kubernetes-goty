/**
 * Catálogo de escenarios preconfigurados.
 */
import type { ClusterState, RequestProfile, StackConfig } from '@/domain/types';
import ndots from './ndots-dns-penalty';
import iptablesVsEbpf from './iptables-vs-ebpf';
import flannelVsCilium from './flannel-vs-cilium';
import canary from './traffic-shifting-canary';
import netpol from './networkpolicy-isolation';

export interface Scenario {
  id: string;
  name: string;
  tagline: string;
  difficulty: 'intro' | 'media' | 'avanzada';
  objectives: string[];
  focusNamespace: string;
  defaultRps: number;
  /** CPU (millicores) quemada por RPS recibido por pod — alimenta el HPA */
  cpuPerRps: number;
  defaultStack: StackConfig;
  buildCluster: () => ClusterState;
  requestProfiles: RequestProfile[];
}

export const SCENARIOS: Scenario[] = [ndots, iptablesVsEbpf, flannelVsCilium, canary, netpol];

export function getScenario(id: string): Scenario {
  return SCENARIOS.find((s) => s.id === id) ?? SCENARIOS[0];
}
