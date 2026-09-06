'use client';

/**
 * Editor YAML (Monaco) con apply en caliente: editar réplicas / recursos /
 * env de un Deployment y ver el reconcile-loop en el canvas.
 */
import { useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import yaml from 'js-yaml';
import { FileCode, Play } from 'lucide-react';
import { usePlayground } from '@/lib/store';
import type { Workload } from '@/domain/types';

const Editor = dynamic(() => import('@monaco-editor/react'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-xs text-slate-600">
      cargando Monaco…
    </div>
  ),
});

export function workloadToYaml(wl: Workload): string {
  const c = wl.template.containers[0];
  const doc = {
    apiVersion: 'apps/v1',
    kind: wl.kind,
    metadata: { name: wl.name, namespace: wl.namespace, labels: wl.labels },
    spec: {
      replicas: wl.replicas,
      selector: { matchLabels: wl.labels },
      template: {
        metadata: { labels: wl.labels },
        spec: {
          containers: [
            {
              name: c.name,
              image: c.image,
              ports: c.port ? [{ containerPort: c.port }] : undefined,
              resources: {
                requests: {
                  cpu: `${c.resources.requests?.cpuMillis ?? 100}m`,
                  memory: `${c.resources.requests?.memoryMi ?? 128}Mi`,
                },
                limits: {
                  cpu: `${c.resources.limits?.cpuMillis ?? 200}m`,
                  memory: `${c.resources.limits?.memoryMi ?? 256}Mi`,
                },
              },
              env: Object.entries(c.env).map(([name, value]) => ({ name, value })),
            },
          ],
        },
      },
    },
  };
  return yaml.dump(doc, { lineWidth: 120 });
}

export function YamlEditor() {
  const cluster = usePlayground((s) => s.cluster);
  const workloads = cluster.workloads.filter((w) => w.namespace !== 'kube-system');
  const [selected, setSelected] = useState(0);
  const [status, setStatus] = useState<string | null>(null);

  const workload = workloads[Math.min(selected, workloads.length - 1)];
  const initialYaml = useMemo(() => (workload ? workloadToYaml(workload) : ''), [workload?.id, workload?.replicas]);
  const [value, setValue] = useState(initialYaml);

  // re-sincronizar cuando cambia el workload elegido
  const [syncedId, setSyncedId] = useState(workload?.id);
  if (workload && syncedId !== workload.id) {
    setSyncedId(workload.id);
    setValue(workloadToYaml(workload));
  }

  if (!workload) return null;

  const apply = () => {
    try {
      const doc = yaml.load(value) as {
        spec?: {
          replicas?: number;
          template?: {
            spec?: {
              containers?: {
                resources?: {
                  requests?: { cpu?: string; memory?: string };
                  limits?: { cpu?: string; memory?: string };
                };
                env?: { name: string; value: string }[];
              }[];
            };
          };
        };
      };
      const wl = cluster.workloads.find((w) => w.id === workload.id);
      if (!wl) return;
      if (typeof doc.spec?.replicas === 'number') wl.replicas = Math.max(0, doc.spec.replicas);
      const c = doc.spec?.template?.spec?.containers?.[0];
      if (c) {
        const target = wl.template.containers[0];
        const parseCpu = (v?: string) => (v?.endsWith('m') ? parseInt(v) : v ? parseInt(v) * 1000 : undefined);
        const parseMem = (v?: string) => (v?.endsWith('Mi') ? parseInt(v) : v ? parseInt(v) : undefined);
        if (c.resources?.requests) {
          target.resources.requests = {
            cpuMillis: parseCpu(c.resources.requests.cpu) ?? target.resources.requests?.cpuMillis ?? 100,
            memoryMi: parseMem(c.resources.requests.memory) ?? target.resources.requests?.memoryMi ?? 128,
          };
        }
        if (c.resources?.limits) {
          target.resources.limits = {
            cpuMillis: parseCpu(c.resources.limits.cpu) ?? target.resources.limits?.cpuMillis ?? 200,
            memoryMi: parseMem(c.resources.limits.memory) ?? target.resources.limits?.memoryMi ?? 256,
          };
        }
        if (c.env) {
          target.env = Object.fromEntries(c.env.map((e) => [e.name, e.value]));
        }
      }
      usePlayground.setState({ cluster: { ...cluster } });
      setStatus(`✓ applied — el reconciler actúa en el próximo tick`);
    } catch (e) {
      setStatus(`✗ YAML inválido: ${(e as Error).message}`);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-slate-800 px-3 py-1.5">
        <FileCode className="h-3.5 w-3.5 text-slate-500" />
        <select
          value={selected}
          onChange={(e) => setSelected(Number(e.target.value))}
          className="rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 font-mono text-[11px] text-slate-300 outline-none"
        >
          {workloads.map((w, i) => (
            <option key={w.id} value={i}>
              {w.namespace}/{w.name}
            </option>
          ))}
        </select>
        <button
          onClick={apply}
          className="ml-auto flex items-center gap-1 rounded bg-emerald-700 px-2.5 py-1 text-[11px] font-medium text-emerald-50 hover:bg-emerald-600"
        >
          <Play className="h-3 w-3" /> kubectl apply
        </button>
      </div>
      <div className="min-h-0 flex-1">
        <Editor
          height="100%"
          defaultLanguage="yaml"
          theme="vs-dark"
          value={value}
          onChange={(v) => setValue(v ?? '')}
          options={{
            fontSize: 12,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            wordWrap: 'on',
            padding: { top: 8 },
          }}
        />
      </div>
      {status && (
        <div className="border-t border-slate-800 px-3 py-1 font-mono text-[10px] text-slate-400">
          {status}
        </div>
      )}
    </div>
  );
}
