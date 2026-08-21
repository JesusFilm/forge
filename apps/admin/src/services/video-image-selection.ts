type VideoImageCandidate = {
  mobileCinematicHigh?: string | null
  mobileCinematicLow?: string | null
  videoStill?: string | null
  thumbnail?: string | null
  url?: string | null
}

export function bestVideoImageUrl(
  image: VideoImageCandidate | null | undefined,
): string | null {
  if (!image) return null
  return (
    image.mobileCinematicHigh ??
    image.mobileCinematicLow ??
    image.videoStill ??
    image.thumbnail ??
    image.url ??
    null
  )
}

export function compareVideoImagesByDisplayPreference<
  T extends VideoImageCandidate & { id?: string | null },
>(left: T, right: T): number {
  const priorityDelta = videoImagePriority(right) - videoImagePriority(left)
  if (priorityDelta !== 0) return priorityDelta
  return (left.id ?? "").localeCompare(right.id ?? "")
}

export function sortVideoImagesByDisplayPreference<
  T extends VideoImageCandidate & { id?: string | null },
>(images: readonly T[]): T[] {
  return [...images].sort(compareVideoImagesByDisplayPreference)
}

function videoImagePriority(image: VideoImageCandidate): number {
  if (image.mobileCinematicHigh) return 50
  if (image.mobileCinematicLow) return 40
  if (image.videoStill) return 30
  if (image.thumbnail) return 20
  if (image.url) return 10
  return 0
}
