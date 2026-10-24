type VideoDubLike = {
  hls?: string | null
  dash?: string | null
  share?: string | null
}

function recordValue(value: unknown, key: string): unknown {
  return typeof value === "object" && value != null
    ? (value as Record<string, unknown>)[key]
    : null
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

export function resolvedBlockStreamingUrl(value: unknown): string | null {
  const dub = recordValue(value, "videoDub") as VideoDubLike | null
  return (
    nonEmptyString(dub?.hls) ??
    nonEmptyString(dub?.dash) ??
    nonEmptyString(dub?.share) ??
    nonEmptyString(recordValue(value, "streamingUrl"))
  )
}
