'use client';

/**
 * Driver del loop de simulación: avanza un tick del clúster cada 1s/speed.
 */
import { useEffect } from 'react';
import { usePlayground } from '@/lib/store';

export function EngineTicker() {
  const running = usePlayground((s) => s.running);
  const speed = usePlayground((s) => s.speed);

  useEffect(() => {
    if (!running) return;
    const iv = setInterval(() => {
      usePlayground.getState().tick();
    }, Math.max(100, 1000 / speed));
    return () => clearInterval(iv);
  }, [running, speed]);

  return null;
}
