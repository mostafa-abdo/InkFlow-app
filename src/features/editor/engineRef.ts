import type { DrawingEngine } from '../../engine/DrawingEngine'

/**
 * Shared mutable handle to the live engine. Written by EditorCanvas on mount,
 * read by export actions in the title bar / toolbar without prop drilling.
 */
export const engineRef: { current: DrawingEngine | null } = { current: null }

export const getEngineStrokes = (): import('../../types').InkStroke[] =>
  engineRef.current?.getStrokes() ?? []
