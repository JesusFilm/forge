import type { UiMessageKey, UiT } from "../i18n/useT"

export type VideoLabelT = UiT<"VideoLabel">

type VideoLabelKey = UiMessageKey<"VideoLabel">

/** Admin's video `label` enum, mapped to its catalog key. Feature-agnostic on
 *  purpose: the home model and both detail routes render it, so it cannot live
 *  in either one. Logic never reads the text; it compares the raw enum (KTD15). */
const LABEL_KEYS: Readonly<Record<string, VideoLabelKey>> = {
  BEHIND_THE_SCENES: "behindTheScenes",
  COLLECTION: "collection",
  EPISODE: "episode",
  FEATURE_FILM: "featureFilm",
  SEGMENT: "segment",
  SERIES: "series",
  SHORT_FILM: "shortFilm",
  TRAILER: "trailer",
}

function labelKey(label: string): VideoLabelKey | null {
  return Object.prototype.hasOwnProperty.call(LABEL_KEYS, label)
    ? LABEL_KEYS[label]
    : null
}

/**
 * For surfaces receiving admin's raw enum (detail routes showed "FEATURE_FILM").
 * Unknown values pass through — this also receives already-humanized labels,
 * which `labelText`'s "Video" default would erase.
 */
export function displayLabel(label: string, t: VideoLabelT): string {
  const key = labelKey(label)
  return key ? t(key) : label
}

/** Home-model variant: an absent or unknown label becomes the generic "Video". */
export function labelText(
  label: string | null | undefined,
  t: VideoLabelT,
): string {
  return t((label ? labelKey(label) : null) ?? "video")
}
