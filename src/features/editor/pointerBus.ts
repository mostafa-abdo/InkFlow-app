/**
 * High-frequency pointer telemetry bus (pressure / tilt / pointerType).
 * Subscribers update the DOM directly — deliberately outside React state.
 */

export interface PointerInfo {
  pressure: number
  pointerType: string
  tiltX: number
  tiltY: number
}

type Listener = (info: PointerInfo) => void

const listeners = new Set<Listener>()

export const publishPointerInfo = (info: PointerInfo): void => {
  for (const l of listeners) l(info)
}

export const subscribePointerInfo = (listener: Listener): (() => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
