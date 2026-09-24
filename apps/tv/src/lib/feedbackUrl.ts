type FeedbackContext = {
  platform: "apple-tv" | "android-tv"
  appVersion?: string
  build?: string
  screen?: string
  player?: string
}

export function feedbackUrl(
  base: string | undefined,
  context: FeedbackContext,
): string | null {
  if (!base || !/^https:\/\/[a-z0-9.-]+(?:\/[a-z0-9/_-]*)?$/i.test(base))
    return null
  const fields = [
    ["platform", context.platform],
    ["appVersion", context.appVersion],
    ["build", context.build],
    ["screen", context.screen],
    ["player", context.player],
  ]
  const query = fields
    .filter(
      (item): item is [string, string] =>
        typeof item[1] === "string" && /^[a-zA-Z0-9 ._/-]{1,64}$/.test(item[1]),
    )
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join("&")
  return `${base}${query ? `?${query}` : ""}`
}
