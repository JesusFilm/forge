/** Keep this listener non-passive so a handled gesture cannot zoom the page. */
export function bindTimelineWheelZoom(
  target: EventTarget & { readonly clientHeight: number },
  onZoom: (factor: number) => void,
) {
  const wheel = (raw: Event) => {
    const event = raw as WheelEvent
    if ((!event.ctrlKey && !event.metaKey) || !event.deltaY) return
    event.preventDefault()
    const unit =
      event.deltaMode === 1
        ? 16
        : event.deltaMode === 2
          ? target.clientHeight
          : 1
    const delta = Math.max(-100, Math.min(100, event.deltaY * unit))
    onZoom(Math.exp(-delta * 0.002))
  }
  target.addEventListener("wheel", wheel, { passive: false })
  return () => target.removeEventListener("wheel", wheel)
}

export function applyTimelineWheelZoom(
  current: number,
  factor: number,
  min = 0.3,
  max = 4,
) {
  return Math.max(min, Math.min(max, current * factor))
}
