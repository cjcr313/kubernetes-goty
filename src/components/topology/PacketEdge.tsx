'use client';

/**
 * Arista de paquete: path base + partícula animada (SVG animateMotion)
 * recorriendo la curva de bezier del edge.
 */
import { memo } from 'react';
import { BaseEdge, getBezierPath, type Edge, type EdgeProps } from '@xyflow/react';

export type PacketRFEdge = Edge<{ color?: string; dashed?: boolean; dur?: string }, 'packet'>;

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
  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke: color,
          strokeWidth: 2,
          strokeDasharray: data?.dashed ? '6 4' : undefined,
        }}
      />
      <circle r={5} fill={color}>
        <animateMotion dur={data?.dur ?? '1.4s'} repeatCount="indefinite" path={edgePath} />
      </circle>
    </>
  );
}

export const edgeTypes = { packet: memo(PacketEdgeImpl) };
