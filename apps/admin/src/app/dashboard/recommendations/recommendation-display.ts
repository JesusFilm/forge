export function formatRecommendationDateTime(value: Date | null | undefined) {
  return value
    ? value.toISOString().replace("T", " ").replace(".000Z", "Z")
    : "None"
}

export function displayRecommendationToken(value: string | null | undefined) {
  if (!value) return "None"
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase())
}

export function formatRecommendationCount(value: number | undefined) {
  return value == null ? "Unknown" : value.toLocaleString("en-US")
}

export function formatRecommendationPercent(value: number | null) {
  return value == null
    ? "Unknown"
    : `${(Math.max(0, Math.min(1, value)) * 100).toFixed(1)}%`
}

export function recommendationNumberFrom(
  value: Readonly<Record<string, number | null>>,
  key: string,
): number | null {
  const entry = value[key]
  return typeof entry === "number" && Number.isFinite(entry) ? entry : null
}
