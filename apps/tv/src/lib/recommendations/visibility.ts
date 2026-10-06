export type Frame = { x: number; y: number; width: number; height: number }
export function visibleFraction(frame: Frame, viewport: Frame): number {
  if (frame.width <= 0 || frame.height <= 0) return 0
  const width = Math.max(
    0,
    Math.min(frame.x + frame.width, viewport.x + viewport.width) -
      Math.max(frame.x, viewport.x),
  )
  const height = Math.max(
    0,
    Math.min(frame.y + frame.height, viewport.y + viewport.height) -
      Math.max(frame.y, viewport.y),
  )
  return (width * height) / (frame.width * frame.height)
}

export function createImpressionTracker() {
  const starts = new Map<string, number>()
  const emitted = new Set<string>()
  return {
    observe(id: string, fraction: number, active: boolean, now: number) {
      if (!active || fraction < 0.5) {
        starts.delete(id)
        return false
      }
      if (emitted.has(id)) return false
      const start = starts.get(id)
      if (start === undefined) {
        starts.set(id, now)
        return false
      }
      if (now - start < 1000) return false
      emitted.add(id)
      return true
    },
    interrupt() {
      starts.clear()
    },
  }
}
