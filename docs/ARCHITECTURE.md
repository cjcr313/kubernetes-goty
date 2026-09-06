# Arquitectura — kubernetes-goty

## Principio: Clean Architecture, motor determinista

```
┌────────────────────────────────────────────────────────┐
│ UI (React/Next.js)                                     │
│   page · TopologyCanvas · TraceInspector · Panels      │
│   lee estado, dispara acciones — cero lógica de sim    │
└──────────────┬─────────────────────────────────────────┘
               │ zustand (store)
┌──────────────▼─────────────────────────────────────────┐
│ Store (lib/store.ts)                                   │
│   estado: ClusterState + StackConfig + métricas        │
│   tick(): lifecycle → HPA → traffic-gen → métricas     │
└──────────────┬─────────────────────────────────────────┘
               │ funciones puras
┌──────────────▼─────────────────────────────────────────┐
│ Engine (src/engine)                                    │
│   tracePacket(req, cluster, stack) → PacketTrace       │
│   resolveDns / advanceLifecycles / reconcileHpas       │
└──────────────┬─────────────────────────────────────────┘
               │
┌──────────────▼─────────────────────────────────────────┐
│ Domain (src/domain)                                    │
│   types.ts + cluster-factory.ts                        │
│   Todo lo demás depende de esto; esto no depende de na │
└────────────────────────────────────────────────────────┘
```

### El tick (≈1s de clúster)

1. **`advanceLifecycles`** — reconcilia réplicas declaradas vs vivas, avanza fases (`Pending → ContainerCreating → Running` / `CrashLoopBackOff`), asigna podIPs del CIDR del nodo y refresca endpoints de todos los Services.
2. **`reconcileHpas`** — fórmula oficial HPA (`ceil(replicas × avg/target)`) con cooldown de 15 ticks; escala workloads.
3. **`runTickTraffic`** — muestrea N requests representativos de los perfiles del escenario, cada uno pasa por `tracePacket`, y agrega p50/p95/p99, error rate, DNS QPS y quemado de CPU por pod (la señal que dispara el HPA).

### Determinismo

Cada request lleva id (`req-<tick>-<n>`); el PRNG (mulberry32) se siembra con `hash32(id)`. Misma combinación (cluster + stack + request) ⇒ mismo trace exacto. Los percentiles varían entre ticks porque cambia la muestra, pero cada packet-walk es reproducible.

### Por qué zustand y no reducer/RTK

El cluster muta en profundidad cada tick (pods, endpoints, métricas). Con zustand basta un spread top-level (`{...cluster}`) para disparar el re-render de los selectores; sin acciones-tipo-evento boilerplate.

## Extensiones naturales

- **Nuevo CNI:** implementa tu rama en `pushCniPath()` (engine/network-simulator.ts) + opción en `StackSwitcher`. Nada más.
- **Nuevo escenario:** archivo en `src/scenarios/` que exporte un `Scenario` (buildCluster + defaultStack + requestProfiles) y regístralo en el index.
- **Persistencia:** el `ClusterState` y `StackConfig` son JSON puros — serializables a SQLite/Prisma o export directa.
