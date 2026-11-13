import { useReducer, type PointerEvent } from 'react';
import type { Coordinates, Point } from '../types.js';

type Rectangle = { x: number; y: number; width: number; height: number };
type Tool = 'rectangle' | 'pen';
type Gesture = { tool: 'rectangle'; start: Point } | { tool: 'pen'; points: Point[] };

export type AnnotationState = {
  rectangle?: Rectangle;
  strokes: Point[][];
  redoStrokes: Point[][];
  gesture?: Gesture;
  tool: Tool;
};

export type AnnotationAction =
  | { type: 'reset' }
  | { type: 'seed'; coordinates: Coordinates }
  | { type: 'tool'; value: Tool }
  | { type: 'start'; point: Point }
  | { type: 'move'; point: Point }
  | { type: 'finish' }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'clear' };

const initialState: AnnotationState = {
  strokes: [],
  redoStrokes: [],
  tool: 'rectangle',
};

function toRectangle([topLeft, , bottomRight]: Coordinates): Rectangle {
  return {
    x: topLeft.x,
    y: topLeft.y,
    width: bottomRight.x - topLeft.x,
    height: bottomRight.y - topLeft.y,
  };
}

function toCoordinates(rectangle: Rectangle): Coordinates {
  const { x, y, width, height } = rectangle;
  return [
    { x, y },
    { x: x + width, y },
    { x: x + width, y: y + height },
    { x, y: y + height },
  ];
}

function boundedPoint(point: Point, rectangle: Rectangle): Point {
  return {
    x: Math.max(rectangle.x, Math.min(point.x, rectangle.x + rectangle.width)),
    y: Math.max(rectangle.y, Math.min(point.y, rectangle.y + rectangle.height)),
  };
}

function inside(point: Point, rectangle: Rectangle): boolean {
  return (
    point.x >= rectangle.x &&
    point.x <= rectangle.x + rectangle.width &&
    point.y >= rectangle.y &&
    point.y <= rectangle.y + rectangle.height
  );
}

function rectangleBetween(start: Point, end: Point): Rectangle {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
}

function reducer(state: AnnotationState, action: AnnotationAction): AnnotationState {
  switch (action.type) {
    case 'reset':
      return initialState;
    case 'seed':
      return { ...initialState, rectangle: toRectangle(action.coordinates) };
    case 'tool':
      return { ...state, tool: action.value };
    case 'start':
      if (state.tool === 'pen') {
        return state.rectangle && inside(action.point, state.rectangle)
          ? {
              ...state,
              gesture: { tool: 'pen', points: [boundedPoint(action.point, state.rectangle)] },
            }
          : state;
      }
      return {
        ...state,
        rectangle: { x: action.point.x, y: action.point.y, width: 0, height: 0 },
        strokes: [],
        redoStrokes: [],
        gesture: { tool: 'rectangle', start: action.point },
      };
    case 'move': {
      const { gesture, rectangle } = state;
      if (!gesture) {
        return state;
      }
      if (gesture.tool === 'rectangle') {
        return { ...state, rectangle: rectangleBetween(gesture.start, action.point) };
      }
      const point = rectangle ? boundedPoint(action.point, rectangle) : action.point;
      return { ...state, gesture: { tool: 'pen', points: [...gesture.points, point] } };
    }
    case 'finish':
      if (state.gesture?.tool === 'pen' && state.gesture.points.length > 1) {
        return {
          ...state,
          strokes: [...state.strokes, state.gesture.points],
          redoStrokes: [],
          gesture: undefined,
        };
      }
      if (state.gesture?.tool === 'rectangle' && (state.rectangle?.width ?? 0) < 4) {
        return { ...state, rectangle: undefined, gesture: undefined };
      }
      return { ...state, gesture: undefined };
    case 'undo': {
      const stroke = state.strokes.at(-1);
      return stroke
        ? { ...state, strokes: state.strokes.slice(0, -1), redoStrokes: [...state.redoStrokes, stroke] }
        : state;
    }
    case 'redo': {
      const stroke = state.redoStrokes.at(-1);
      return stroke
        ? { ...state, strokes: [...state.strokes, stroke], redoStrokes: state.redoStrokes.slice(0, -1) }
        : state;
    }
    case 'clear':
      return { ...state, strokes: [], redoStrokes: [] };
  }
}

export function useAnnotation() {
  const [state, dispatch] = useReducer(reducer, initialState);

  const pointerAction = (event: PointerEvent<SVGSVGElement>, action: AnnotationAction) => {
    event.preventDefault();
    event.stopPropagation();
    dispatch(action);
  };

  const pointFrom = (event: PointerEvent<SVGSVGElement>): Point => ({
    x: event.clientX,
    y: event.clientY,
  });

  const onPointerDown = (event: PointerEvent<SVGSVGElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointerAction(event, { type: 'start', point: pointFrom(event) });
  };

  const onPointerMove = (event: PointerEvent<SVGSVGElement>) =>
    pointerAction(event, { type: 'move', point: pointFrom(event) });

  const onPointerUp = (event: PointerEvent<SVGSVGElement>) => pointerAction(event, { type: 'finish' });

  const { rectangle } = state;
  const coordinates =
    rectangle && rectangle.width >= 4 && rectangle.height >= 4 ? toCoordinates(rectangle) : undefined;

  return { state, dispatch, coordinates, onPointerDown, onPointerMove, onPointerUp };
}

export type Annotation = ReturnType<typeof useAnnotation>;
