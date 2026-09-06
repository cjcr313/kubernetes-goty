# 🏆 kubernetes-goty — K8s Interactive Playground & Datapath Visualizer

Plataforma web interactiva para que ingenieros y SREs **simulen, aprendan y experimenten** con la arquitectura interna de Kubernetes: el ciclo de vida de los objetos, la orquestación de cargas y —sobre todo— **el viaje de un paquete a través del datapath L3/L4/L7, salto por salto**.

Interfaz dual estilo **Lens / k9s** (panel de recursos) + **canvas de topología con packet-walk animado** (React Flow), con un motor de simulación determinista que puedes conmutar en caliente:

| Capa | Opciones conmutables en vivo |
|---|---|
| **CNI** | flannel (`vxlan` / `host-gw`) · cilium (native routing / tunnel + eBPF) · calico (`ipip` / `bgp`) · aws-vpc-cni |
| **Service proxy** | `iptables` (KUBE-SERVICES → KUBE-SVC → KUBE-SEP, lineal) · `IPVS` (hash O(1)) · `eBPF` (kube-proxy replacement) |
| **DNS** | CoreDNS + `ndots` configurable (1–5) + NodeLocal DNSCache |
| **Edge** | Ingress NGINX · Gateway API (Envoy / Istio ambient) con canary ponderado y fault injection |

```
Cliente → CDN/LB → Ingress|Gateway → Service IP (DNAT) → CNI datapath (VXLAN|eBPF) → veth → Pod eth0
                ↑ cada salto se dibuja, se explica y se mide (latencia sintética) ↑
```

## 🚀 Quickstart

```bash
npm install
npm run dev        # http://localhost:3000
npm run typecheck  # tsc --noEmit
```

## 🧭 Escenarios incluidos

1. **The ndots:5 DNS Penalty** — la app resuelve `api.twitter.com` sin FQDN: 4 queries DNS por request, CoreDNS saturado. Fix: `ndots:2`, FQDN con punto final o NodeLocal cache.
2. **Iptables Explosion vs. eBPF Performance** — clúster con 2.000 servicios: el traversal lineal de iptables (~8.000 reglas) degrada el p99 frente al lookup O(1) en BPF maps.
3. **Flannel VXLAN Overhead vs. Cilium Native Routing** — encapsulación (+50B, MTU 1450) vs. rutas nativas, hop a hop.
4. **Traffic Shifting con Gateway API & Envoy** — canary 90/10 por `HTTPRoute` + fault injection (HTTP 500) sobre v2.
5. **NetworkPolicy Isolation Failure** — dónde cae el DROP: BPF policy map en el veth vs. cadena iptables del netns.

## 🏗️ Arquitectura (Clean Architecture)

```
src/
├── domain/                  # entidades puras, cero dependencias
│   ├── types.ts             #   ClusterState, Pod, Service, StackConfig, PacketTrace…
│   └── cluster-factory.ts   #   builders declarativos (addNode/addWorkload/addService)
├── engine/                  # casos de uso — la simulación es determinista (seed por request)
│   ├── network-simulator.ts #   ★ motor del datapath: hops según CNI+proxy+DNS+edge
│   ├── dns-resolver.ts      #   stub-resolver + CoreDNS + search-list/ndots
│   ├── lifecycle.ts         #   Pending → ContainerCreating → Running → CrashLoop
│   ├── hpa-controller.ts    #   desired = ceil(replicas × usage/target), con cooldown
│   └── traffic-generator.ts #   muestreo de requests + agregación de métricas
├── scenarios/               # presets declarativos (clúster + stack + perfiles de tráfico)
├── lib/
│   ├── store.ts             # zustand: estado global + tick loop (1 tick ≈ 1s)
│   ├── rng.ts               # PRNG determinista (mulberry32)
│   └── utils.ts
├── components/
│   ├── topology/            # TopologyCanvas (React Flow), cards, PacketEdge, TraceInspector
│   ├── resources/           # ResourceTree (estilo Lens) + YamlEditor (Monaco, apply en caliente)
│   ├── metrics/             # p50/p95/p99, RPS + errores, réplicas HPA, DNS QPS (Recharts)
│   └── controls/            # StackSwitcher: conmutación de CNI/proxy/DNS/edge
└── app/                     # Next.js App Router (una sola pantalla, todo client-side)
```

Ver [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) y [`docs/DATAPATH-MODEL.md`](docs/DATAPATH-MODEL.md).

## 🧪 Stack

- **Next.js 14** (App Router, TypeScript) + **Tailwind CSS** (shadcn-ready: radix + cva incluidos)
- **@xyflow/react** (React Flow v12) — topología + partículas animadas (`animateMotion`)
- **Recharts** — métricas en vivo · **Monaco Editor** — YAML con apply en caliente
- **zustand** — estado del clúster + tick loop · **js-yaml** — manifiestos

## ⚠️ Modelo de latencia

Las latencias son **sintéticas y pedagógicas**: no hay eBPF real corriendo. El modelo captura los *shape* correctos (iptables escala O(nº servicios), IPVS/eBPF ~O(1), VXLAN añade overhead de MTU, ndots multiplica queries DNS) para que las comparativas cualitativas sean fieles. Los números absolutos no benchmarkean tu kernel. Detalle completo en `docs/DATAPATH-MODEL.md`.

## 🗺️ Roadmap

- [ ] Modo gRPC con HTTP/2 connection coalescing en Envoy
- [ ] Export/import de escenarios (JSON) + compartir labs por URL
- [ ] CiliumNetworkPolicy con L7 rules (HTTP match en el policy map)
- [ ] Vista de "conntrack table" y session affinity en vivo
- [ ] Backends reales opcionales (kind/k3d) vía WebSocket

---

*Hecho con 🧠 para gente que debuggea `iptables -L -nv | grep KUBE-SEP` un viernes a las 6pm.*
