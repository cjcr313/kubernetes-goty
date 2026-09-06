'use client';

/**
 * Panel de conmutación de infraestructura: CNI, kube-proxy, DNS y edge.
 * Cambiar aquí altera INMEDIATAMENTE el datapath que dibuja el canvas.
 */
import { Gauge, Network, Search, Waypoints } from 'lucide-react';
import { usePlayground } from '@/lib/store';
import { iptablesRuleCount } from '@/engine/network-simulator';
import { fmtNum } from '@/lib/utils';

const selectCls =
  'w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 font-mono text-[11px] text-slate-200 outline-none focus:border-cyan-600';

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-2.5">
      <div className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-500">
        {icon}
        {title}
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

export function StackSwitcher() {
  const stack = usePlayground((s) => s.stack);
  const cluster = usePlayground((s) => s.cluster);
  const setProxy = usePlayground((s) => s.setProxy);
  const setCni = usePlayground((s) => s.setCni);
  const setDns = usePlayground((s) => s.setDns);
  const setEdge = usePlayground((s) => s.setEdge);

  const rules = fmtNum(iptablesRuleCount(cluster));

  return (
    <div className="space-y-2">
      <Section icon={<Network className="h-3.5 w-3.5" />} title="CNI datapath">
        <select
          className={selectCls}
          value={stack.cni.plugin}
          onChange={(e) => setCni({ plugin: e.target.value as typeof stack.cni.plugin })}
        >
          <option value="flannel">flannel</option>
          <option value="cilium">cilium (eBPF)</option>
          <option value="calico">calico</option>
          <option value="aws-vpc-cni">aws-vpc-cni</option>
        </select>
        {stack.cni.plugin === 'flannel' && (
          <select
            className={selectCls}
            value={stack.cni.flannel.backend}
            onChange={(e) =>
              setCni({ flannel: { ...stack.cni.flannel, backend: e.target.value as 'vxlan' | 'host-gw' } })
            }
          >
            <option value="vxlan">backend: vxlan (overlay UDP/8472)</option>
            <option value="host-gw">backend: host-gw (rutas L2)</option>
          </select>
        )}
        {stack.cni.plugin === 'cilium' && (
          <>
            <select
              className={selectCls}
              value={stack.cni.cilium.tunnel}
              onChange={(e) =>
                setCni({ cilium: { ...stack.cni.cilium, tunnel: e.target.value as 'disabled' | 'vxlan' } })
              }
            >
              <option value="disabled">native routing (sin túnel)</option>
              <option value="vxlan">tunnel: vxlan</option>
            </select>
            <label className="flex items-center gap-2 font-mono text-[10px] text-slate-400">
              <input
                type="checkbox"
                checked={stack.cni.cilium.kubeProxyReplacement}
                onChange={(e) => {
                  setCni({ cilium: { ...stack.cni.cilium, kubeProxyReplacement: e.target.checked } });
                }}
                className="accent-fuchsia-500"
              />
              kube-proxy replacement (eBPF)
            </label>
          </>
        )}
        {stack.cni.plugin === 'calico' && (
          <select
            className={selectCls}
            value={stack.cni.calico.encapsulation}
            onChange={(e) =>
              setCni({ calico: { ...stack.cni.calico, encapsulation: e.target.value as 'ipip' | 'bgp' } })
            }
          >
            <option value="ipip">encapsulación: IPIP</option>
            <option value="bgp">peering: BGP nativo</option>
          </select>
        )}
      </Section>

      <Section icon={<Gauge className="h-3.5 w-3.5" />} title="Service proxy">
        <select className={selectCls} value={stack.proxy} onChange={(e) => setProxy(e.target.value as typeof stack.proxy)}>
          <option value="iptables">iptables ({rules} reglas, O(n))</option>
          <option value="ipvs">IPVS (hash, O(1))</option>
          <option value="none-ebpf">eBPF lookup (sin kube-proxy)</option>
        </select>
      </Section>

      <Section icon={<Search className="h-3.5 w-3.5" />} title="DNS">
        <div className="flex items-center gap-2">
          <span className="w-14 font-mono text-[10px] text-slate-400">ndots: {stack.dns.ndots}</span>
          <input
            type="range"
            min={1}
            max={5}
            step={1}
            value={stack.dns.ndots}
            onChange={(e) => setDns({ ndots: Number(e.target.value) })}
            className="flex-1 accent-amber-500"
          />
        </div>
        <label className="flex items-center gap-2 font-mono text-[10px] text-slate-400">
          <input
            type="checkbox"
            checked={stack.dns.nodeLocalCache}
            onChange={(e) => setDns({ nodeLocalCache: e.target.checked })}
            className="accent-amber-500"
          />
          NodeLocal DNSCache
        </label>
      </Section>

      <Section icon={<Waypoints className="h-3.5 w-3.5" />} title="Ingress / Gateway">
        <select
          className={selectCls}
          value={stack.edge}
          onChange={(e) => setEdge(e.target.value as typeof stack.edge)}
        >
          <option value="none">sin ingress</option>
          <option value="ingress-nginx">Ingress NGINX</option>
          <option value="gateway-envoy">Gateway API · Envoy</option>
          <option value="gateway-istio-ambient">Gateway API · Istio ambient</option>
        </select>
      </Section>
    </div>
  );
}
