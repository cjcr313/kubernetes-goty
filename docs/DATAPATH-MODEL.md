# Modelo del Datapath — cómo se simula cada salto

Referencia de las decisiones de modelado. Latencias sintéticas: capturan la *forma* correcta de cada tecnología, no benchmarkean tu kernel.

## 1. Service translation (kube-proxy)

| Modo | Modelo | Constantes |
|---|---|---|
| `iptables` | `latencia = reglas × µs/regla`, lineal | `reglas ≈ 180 + 4×svcs + seps` · `8µs/regla` ⇒ 2.000 servicios ≈ **~65ms** |
| `ipvs` | hash O(1) + `log(services)` mínimo | ~**0.02ms** |
| `none-ebpf` | BPF map lookup | ~**0.004ms** |

Hops emitidos para iptables (los reales de un `iptables-save`):

```
PREROUTING (nat) → KUBE-SERVICES → KUBE-SVC-XXXX → statistic random → KUBE-SEP-YYYY → DNAT
```

La penalización de iptables aplica a **todo** lookup de ClusterIP — incluida cada query DNS hacia `kube-dns` (por eso el escenario ndots+2000-servicios se compone).

## 2. CNI datapath (cross-node)

| CNI | Hops | Overhead |
|---|---|---|
| flannel vxlan | route → **ENCAP** UDP/8472 → underlay → **DECAP** → cni0 → veth | +50B, MTU 1450 |
| flannel host-gw | route plana → underlay → veth | 0 (exige L2) |
| cilium native | **BPF** en veth → rutas nativas → BPF ingress destino | 0 |
| cilium tunnel | cilium_vxlan encap → underlay → decap+BPF | +50B |
| calico ipip | tunl0 encap (proto 4) → underlay → decap | +20B |
| calico bgp | rutas BGP → underlay → veth | 0 |
| aws-vpc-cni | IP de pod = IP de VPC (ENI) → fabric AWS | 0 |

## 3. DNS (ndots)

Stub resolver del pod con search list estándar:

```
search <ns>.svc.cluster.local svc.cluster.local cluster.local
options ndots:N
```

- `ndots:5` + `api.twitter.com` (2 dots < 5): expande los **3 sufijos** (NXDOMAIN ×3) y recién entonces consulta el nombre pelado → **4 queries**, la última con forward a upstream (~15ms).
- FQDN con punto final o `dots ≥ ndots`: **1 query** absoluta.
- NodeLocal DNSCache: HITs en el nodo (~0.05ms) + caché de negativos.

Cada query paga el round-trip por el datapath activo (`serviceLookupLatencyMs` del proxy) — el castigo se compone con iptables.

## 4. Edge

- **ingress-nginx:** match Host/Path → upstream. Se documenta keepalive y el costo de reloads (SIGHUP → drenaje de workers).
- **Gateway API (Envoy/Istio ambient):** `HTTPRoute` con `backendRefs` ponderados — selección canary 90/10 **por request** (misma semilla del request). `faultInjection` dispara `FAULT-INJECT` con HTTP 500 según porcentaje.

## 5. NetworkPolicy

Semántica K8s simplificada pero fiel: si una policy con `policyTypes: [Ingress]` selecciona al pod destino ⇒ default-deny salvo `from` que acepte al origen. El **punto de enforcement** cambia con el stack:

- **Cilium:** veredicto en el **BPF policy map**, evaluado en el mismo hook del veth (el drop es invisible para iptables).
- **CNI clásico:** drop en las **cadenas iptables** dentro del netns / FORWARD del host.

## 6. Métricas

- p50/p95/p99 de la muestra del tick con jitter ±20% (misma semilla ⇒ reproducible).
- `dnsQps = queries_por_request × rps` — el indicador estrella del escenario ndots.
- CPU por pod: `8m + rps_por_pod × cpuPerRps` (suavizado 70%) — alimenta el HPA real del motor.
