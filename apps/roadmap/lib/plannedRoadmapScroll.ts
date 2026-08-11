type TimelineScrollPosition = {
  markerPct: number
  viewportWidth: number
  scrollWidth: number
  stickyWidth: number
}

export function getTimelineScrollLeft({
  markerPct,
  viewportWidth,
  scrollWidth,
  stickyWidth,
}: TimelineScrollPosition) {
  const clampedMarkerPct = Math.max(0, Math.min(100, markerPct))
  const timelineWidth = Math.max(0, scrollWidth - stickyWidth)
  const markerX = stickyWidth + (clampedMarkerPct / 100) * timelineWidth
  const visibleTimelineWidth = Math.max(0, viewportWidth - stickyWidth)
  const centeredMarkerX = stickyWidth + visibleTimelineWidth / 2
  const maxScrollLeft = Math.max(0, scrollWidth - viewportWidth)

  return Math.max(0, Math.min(maxScrollLeft, markerX - centeredMarkerX))
}
