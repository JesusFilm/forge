export function topShelfPlaybackReady(input: {
  requestedSlug: string
  videoSlug: string | null
  preferredLanguage: string | null
  activeLanguage: string | null
}) {
  return (
    input.requestedSlug === input.videoSlug &&
    input.activeLanguage === (input.preferredLanguage ?? "english")
  )
}

export function topShelfAutoplayDecision(input: {
  requestedSlug: string
  videoSlug: string | null
  preferredLanguage: string | null
  activeLanguage: string | null
  playableLanguages: readonly (string | null)[]
}): "wait" | "unavailable" | "ready" {
  if (input.requestedSlug !== input.videoSlug) return "wait"
  if (!input.playableLanguages.includes(input.preferredLanguage ?? "english"))
    return "unavailable"
  return topShelfPlaybackReady(input) ? "ready" : "wait"
}
