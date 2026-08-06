/**
 * Admin's video `label` enum, humanized. Feature-agnostic on purpose: the home
 * model and both detail routes render it, so it cannot live in either one.
 */
export const LABEL_TEXT: Record<string, string> = {
  BEHIND_THE_SCENES: "Behind the scenes",
  COLLECTION: "Collection",
  EPISODE: "Episode",
  FEATURE_FILM: "Feature film",
  SEGMENT: "Segment",
  SERIES: "Series",
  SHORT_FILM: "Short film",
  TRAILER: "Trailer",
}

/**
 * For surfaces receiving admin's raw enum (detail routes showed "FEATURE_FILM").
 * Unknown values pass through — this also receives already-humanized labels,
 * which `labelText`'s "Video" default would erase.
 */
export function displayLabel(label: string): string {
  return LABEL_TEXT[label] ?? label
}

/** Home-model variant: an absent or unknown label becomes the generic "Video". */
export function labelText(label: string | null | undefined): string {
  return label ? (LABEL_TEXT[label] ?? "Video") : "Video"
}
