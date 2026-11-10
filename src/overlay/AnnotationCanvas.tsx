import type { PointerEventHandler } from 'react';
import type { Point } from '../types.js';
import type { AnnotationState } from './useAnnotation.js';

function pathFor(points: Point[]): string {
  return points.map(({ x, y }, index) => `${index ? 'L' : 'M'} ${x} ${y}`).join(' ');
}

export function AnnotationCanvas({
  state,
  width,
  height,
  selectionNumber,
  onPointerDown,
  onPointerMove,
  onPointerUp,
}: {
  state: AnnotationState;
  width: number;
  height: number;
  selectionNumber: number;
  onPointerDown: PointerEventHandler<SVGSVGElement>;
  onPointerMove: PointerEventHandler<SVGSVGElement>;
  onPointerUp: PointerEventHandler<SVGSVGElement>;
}) {
  const rectangle = state.rectangle;
  const liveStroke = state.gesture?.tool === 'pen' ? state.gesture.points : [];
  const strokes = liveStroke.length > 1 ? [...state.strokes, liveStroke] : state.strokes;

  return (
    <svg
      aria-label="Annotation canvas"
      className="fixed inset-0 h-full w-full"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      style={{ pointerEvents: 'auto', touchAction: 'none', cursor: state.tool === 'rectangle' ? 'crosshair' : 'cell' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      {rectangle && rectangle.width > 0 && rectangle.height > 0 && (
        <>
          <rect
            x={rectangle.x + 1}
            y={rectangle.y + 1}
            width={Math.max(0, rectangle.width - 2)}
            height={Math.max(0, rectangle.height - 2)}
            fill="transparent"
            stroke="#f97316"
            strokeDasharray="7 4"
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
          />
          <g data-pnt-selection-badge transform={`translate(${rectangle.x + 14} ${rectangle.y + 14})`}>
            <circle r="12" fill="#f97316" />
            <text y="4" textAnchor="middle" fill="white" fontSize="11" fontWeight="700">
              {selectionNumber}
            </text>
          </g>
          {strokes.map((points, index) => (
            <path
              key={index}
              d={pathFor(points)}
              fill="none"
              stroke="#2563eb"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="3"
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </>
      )}
    </svg>
  );
}
