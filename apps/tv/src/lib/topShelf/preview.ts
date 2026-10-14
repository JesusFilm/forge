import type { Concept } from "./model"

export type TopShelfPreviewStyle = "automatic" | Concept

export const TOP_SHELF_PREVIEW_OPTIONS: readonly {
  value: TopShelfPreviewStyle
  label: string
}[] = [
  { value: "automatic", label: "Automatic — daily rotation" },
  { value: "spotlight", label: "Cinematic Spotlight" },
  { value: "continue", label: "Continue Watching" },
  { value: "collection", label: "Discover the Collection" },
  { value: "short", label: "A Moment of Hope — short films" },
  { value: "journey", label: "Choose Your Journey — topics" },
]

export function topShelfPreviewEnabled(
  flag: string | undefined,
  platform: string,
  isTV: boolean,
): boolean {
  return platform === "ios" && isTV && (flag === "true" || flag === "1")
}

export function parseTopShelfPreviewStyle(
  value: unknown,
): TopShelfPreviewStyle {
  return TOP_SHELF_PREVIEW_OPTIONS.some((option) => option.value === value)
    ? (value as TopShelfPreviewStyle)
    : "automatic"
}

export function shelfConceptForPreview(
  eligible: readonly Concept[],
  automatic: Concept | undefined,
  preview: TopShelfPreviewStyle,
): Concept | undefined {
  return preview !== "automatic" && eligible.includes(preview)
    ? preview
    : automatic
}
