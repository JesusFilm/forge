export type ProjectedGlobePoint = {
  x: number
  y: number
  depth: number
  frontFacing: boolean
}

export function projectGlobePoint({
  latitude,
  longitude,
  rotation,
  radius,
}: {
  latitude: number
  longitude: number
  rotation: number
  radius: number
}): ProjectedGlobePoint {
  const latitudeRadians = (latitude * Math.PI) / 180
  // The fragment shader samples the longitude at screen center as `rotation`.
  // Project places through the inverse rotation so labels stay attached to the
  // same textured point while the globe turns.
  const longitudeRadians = (longitude * Math.PI) / 180 - rotation
  const latitudeCosine = Math.cos(latitudeRadians)
  const depth = latitudeCosine * Math.cos(longitudeRadians)

  return {
    x: radius * latitudeCosine * Math.sin(longitudeRadians),
    y: -radius * Math.sin(latitudeRadians),
    depth,
    frontFacing: depth > 0.08,
  }
}

export function visibleProjectedLabelIndexes(
  points: Array<ProjectedGlobePoint & { width: number; height: number }>,
): Set<number> {
  const visible = new Set<number>()
  const occupied: Array<{
    left: number
    right: number
    top: number
    bottom: number
  }> = []

  points.forEach((point, index) => {
    if (!point.frontFacing) return
    const box = {
      left: point.x - point.width / 2,
      right: point.x + point.width / 2,
      top: point.y - point.height / 2,
      bottom: point.y + point.height / 2,
    }
    const overlaps = occupied.some(
      (other) =>
        box.left < other.right &&
        box.right > other.left &&
        box.top < other.bottom &&
        box.bottom > other.top,
    )
    if (!overlaps) {
      visible.add(index)
      occupied.push(box)
    }
  })

  return visible
}
