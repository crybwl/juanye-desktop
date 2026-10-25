import { useCallback, useReducer, type SetStateAction } from "react";
import type { Exam, Layout } from "./types";

interface Frame { exam: Exam; layout: Layout }
interface State { past: Frame[]; present: Frame; future: Frame[] }
type Action = { type: "exam"; value: SetStateAction<Exam> } | { type: "layout"; value: SetStateAction<Layout> } | { type: "reset"; frame: Frame } | { type: "undo" } | { type: "redo" };
const LIMIT = 100;

function reducer(state: State, action: Action): State {
  if (action.type === "reset") return { past: [], present: action.frame, future: [] };
  if (action.type === "undo") {
    const previous = state.past.at(-1);
    return previous ? { past: state.past.slice(0, -1), present: previous, future: [state.present, ...state.future].slice(0, LIMIT) } : state;
  }
  if (action.type === "redo") {
    const next = state.future[0];
    return next ? { past: [...state.past, state.present].slice(-LIMIT), present: next, future: state.future.slice(1) } : state;
  }
  let present: Frame;
  if (action.type === "exam") {
    const exam = typeof action.value === "function" ? action.value(state.present.exam) : action.value;
    if (exam === state.present.exam) return state;
    present = { ...state.present, exam };
  } else {
    const layout = typeof action.value === "function" ? action.value(state.present.layout) : action.value;
    if (layout === state.present.layout) return state;
    present = { ...state.present, layout };
  }
  return { past: [...state.past, state.present].slice(-LIMIT), present, future: [] };
}

export function useWorkspaceUndo(exam: Exam, layout: Layout) {
  const [state, dispatch] = useReducer(reducer, { past: [], present: { exam, layout }, future: [] });
  return {
    ...state.present,
    setExam: useCallback((value: SetStateAction<Exam>) => dispatch({ type: "exam", value }), []),
    setLayout: useCallback((value: SetStateAction<Layout>) => dispatch({ type: "layout", value }), []),
    reset: useCallback((frame: Frame) => dispatch({ type: "reset", frame }), []),
    undo: useCallback(() => dispatch({ type: "undo" }), []),
    redo: useCallback(() => dispatch({ type: "redo" }), []),
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
  };
}
