type EditionIdentity = { editionId?: string | null } | null | undefined

export const DIFFERENT_EDITION_MESSAGE =
  "This language uses a different version of this film. The scene may change even at the same playback time."

/** Duration, language and playback URL cannot establish equivalent story time. */
export function dubEditionRelation(
  active: EditionIdentity,
  next: EditionIdentity,
): "same" | "different" | "unknown" {
  const activeId = active?.editionId?.trim()
  const nextId = next?.editionId?.trim()
  if (!activeId || !nextId) return "unknown"
  return activeId === nextId ? "same" : "different"
}

export function audioSwitchConfirmation(
  active: EditionIdentity,
  next: EditionIdentity,
): string | undefined {
  return dubEditionRelation(active, next) === "different"
    ? DIFFERENT_EDITION_MESSAGE
    : undefined
}
