export type VideoLabelMessageKey =
  | "behindTheScenes"
  | "chapter"
  | "collection"
  | "episode"
  | "featureFilm"
  | "segment"
  | "series"
  | "shortFilm"
  | "trailer"
  | "video"

const VIDEO_LABEL_KEYS: Record<string, VideoLabelMessageKey> = {
  BEHIND_THE_SCENES: "behindTheScenes",
  CHAPTER: "chapter",
  COLLECTION: "collection",
  EPISODE: "episode",
  FEATURE_FILM: "featureFilm",
  SEGMENT: "segment",
  SERIES: "series",
  SHORT_FILM: "shortFilm",
  TRAILER: "trailer",
}

function normalizeLabel(label: string | null | undefined): string | null {
  if (label == null) return null

  const normalized = label
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[-\s]+/g, "_")
    .toUpperCase()

  return normalized.length > 0 ? normalized : null
}

export function videoLabelMessageKey(
  label: string | null | undefined,
): VideoLabelMessageKey {
  const normalized = normalizeLabel(label)
  if (normalized == null) return "video"
  return VIDEO_LABEL_KEYS[normalized] ?? "video"
}
