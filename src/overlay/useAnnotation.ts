import { useCallback, useReducer, type PointerEvent } from 'react';
import type { Coordinates, Point } from '../types.js';

export type Rectangle = { x: number; y: number; width: number; height: number };
export type Tool = 'rectangle' | 'pen';
type Gesture =
  | { tool: 'rectangle'; start: Point }
  | { tool: 'pen'; points: Point[] };

export type AnnotationState = {
  rectangle?: Rectangle;
  strokes: Point[][];
  redoStrokes: Point[][];
  gesture?: Gesture;
  comment: string;
  tool: Tool;
};

type Action =
  | { type: 'reset' }
  | { type: 'comment'; value: string }
  | { type: 'tool'; value: Tool }
  | { type: 'start-rectangle'; point: Point }
  | { type: 'start-pen'; point: Point }
  | { type: 'move'; point: Point }
  | { type: 'finish' }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'clear' };

const initialState: AnnotationState = {
  strokes: [],
  redoStrokes: [],
  comment: '',
  tool: 'rectangle',
};

function boundedPoint(point: Point, rectangle: Rectangle): Point {
  return {
    x: Math.max(rectangle.x, Math.min(point.x, rectangle.x + rectangle.width)),
    y: Math.max(rectangle.y, Math.min(point.y, rectangle.y + rectangle.height)),
  };
}

function reducer(state: AnnotationState, action: Action): AnnotationState {
  switch (action.type) {
    case 'reset':
      return initialState;
    case 'comment':
      return { ...state, comment: action.value };
    case 'tool':
      return { ...state, tool: action.value };
    case 'start-rectangle':
      return {
        ...state,
        rectangle: { x: action.point.x, y: action.point.y, width: 0, height: 0 },
        strokes: [],
        redoStrokes: [],
        gesture: { tool: 'rectangle', start: action.point },
      };
    case 'start-pen':
      return { ...state, gesture: { tool: 'pen', points: [action.point] } };
    case 'move':
      if (state.gesture?.tool === 'rectangle') {
        return {
          ...state,
          rectangle: {
            x: Math.min(state.gesture.start.x, action.point.x),
            y: Math.min(state.gesture.start.y, action.point.y),
            width: Math.abs(action.point.x - state.gesture.start.x),
            height: Math.abs(action.point.y - state.gesture.start.y),
          },
        };
      }
      if (state.gesture?.tool === 'pen' && state.rectangle) {
        return {
          ...state,
          gesture: {
            tool: 'pen',
            points: [...state.gesture.points, boundedPoint(action.point, state.rectangle)],
          },
        };
      }
      return state;
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

  const onPointerDown = useCallback((event: PointerEvent<SVGSVGElement>) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = { x: event.clientX, y: event.clientY };
    if (state.tool === 'rectangle') {
      dispatch({ type: 'start-rectangle', point });
    } else if (state.rectangle && point.x >= state.rectangle.x &&
      point.x <= state.rectangle.x + state.rectangle.width &&
      point.y >= state.rectangle.y && point.y <= state.rectangle.y + state.rectangle.height) {
      dispatch({ type: 'start-pen', point: boundedPoint(point, state.rectangle) });
    }
  }, [state.rectangle, state.tool]);

  const onPointerMove = useCallback((event: PointerEvent<SVGSVGElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (state.gesture) dispatch({ type: 'move', point: { x: event.clientX, y: event.clientY } });
  }, [state.gesture]);

  const onPointerUp = useCallback((event: PointerEvent<SVGSVGElement>) => {
    event.preventDefault();
    event.stopPropagation();
    dispatch({ type: 'finish' });
  }, []);

  const rectangle = state.rectangle;
  const coordinates: Coordinates | undefined = rectangle && rectangle.width >= 4 && rectangle.height >= 4
    ? [
        { x: rectangle.x, y: rectangle.y },
        { x: rectangle.x + rectangle.width, y: rectangle.y },
        { x: rectangle.x + rectangle.width, y: rectangle.y + rectangle.height },
        { x: rectangle.x, y: rectangle.y + rectangle.height },
      ]
    : undefined;

  return { state, dispatch, coordinates, onPointerDown, onPointerMove, onPointerUp };
}
