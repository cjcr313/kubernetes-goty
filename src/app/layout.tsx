import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'kubernetes-goty · Interactive Playground & Datapath Visualizer',
  description:
    'Simula el ciclo de vida de objetos K8s y el viaje de paquetes L3/L4/L7 en tiempo real: CNI, kube-proxy, eBPF, DNS y Gateway API conmutables en vivo.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className="dark">
      <body className="min-h-screen bg-ink-950 font-sans text-slate-200 antialiased">
        {children}
      </body>
    </html>
  );
}
