'use client';

/**
 * Arista de paquete: ruta base resaltada + múltiples partículas animadas
 * (SVG animateMotion) con glow, recorriendo la curva de bezier del edge.
 */
import { memo } from 'react';
import { BaseEdge, getBezierPath, type Edge, type EdgeProps } from '@xyflow/react';

export type PacketRFEdge = Edge<
  { color?: string; dashed?: boolean; durMs?: number },
  'packet'
>;

function PacketEdgeImpl(props: EdgeProps<PacketRFEdge>) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data } = props;
  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });
  const color = data?.color ?? '#22d3ee';
  const durMs = data?.durMs ?? 1100;

  return (
    <>
      {/* halo ancho y tenue bajo la ruta */}
      <path d={edgePath} fill="none" stroke={color} strokeWidth={9} opacity={0.12} strokeLinecap="round" />
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke: color,
          strokeWidth: 2.5,
          strokeDasharray: data?.dashed ? '7 5' : undefined,
        }}
      />
      {/* tres partículas desfasadas: sensación de flujo continuo */}
      {[0, 1, 2].map((i) => (
        <circle
          key={i}
          r={i === 0 ? 7 : 4.5}
          fill={color}
          opacity={i === 0 ? 1 : 0.55}
          style={{ filter: `drop-shadow(0 0 6px ${color})` }}
        >
          <animateMotion
            dur={`${durMs}ms`}
            begin={`-${Math.round((durMs / 3) * i)}ms`}
            repeatCount="indefinite"
            path={edgePath}
          />
        </circle>
      ))}
    </>
  );
}

export const edgeTypes = { packet: memo(PacketEdgeImpl) };
