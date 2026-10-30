/** Logical Home return target. Native focus received during a pop/layout pass
 * must not replace the card the viewer actually left. Rows are resolved anew
 * after the async shelves settle, never remembered as numeric positions. */
export type HomeCardIdentity = { sectionId: string; cardId: string }
export type FocusSection = {
  id: string
  // null: the recommendation rail owns its asynchronously loaded cards.
  cards: readonly { id: string }[] | null
}

export function createHomeFocusRestore() {
  let remembered: HomeCardIdentity | null = null
  let pending = false
  let blurred = false
  let active = true
  let ready = false
  return {
    capture(target: HomeCardIdentity | null) {
      if (!active) return false
      if (pending) {
        if (!ready) return false
        if (
          target?.sectionId !== remembered?.sectionId ||
          target?.cardId !== remembered?.cardId
        )
          return false
        pending = false
      }
      remembered = target
      return true
    },
    activate(target: HomeCardIdentity | null) {
      if (!active) return false
      pending = false
      remembered = target
      return true
    },
    blur() {
      active = false
      pending = false
      blurred = true
    },
    enter() {
      active = true
      ready = false
      pending = blurred && remembered != null
      return pending
    },
    resolve(sections: readonly FocusSection[]) {
      if (!pending || !remembered) return null
      const index = sections.findIndex(({ id }) => id === remembered!.sectionId)
      if (index < 0) return null
      const section = sections[index]
      if (section.cards != null) {
        const card = section.cards.find(({ id }) => id === remembered!.cardId)
        if (!card) return null
      }
      return { ...remembered, rowIndex: index + 1 }
    },
    settle() {
      ready = true
    },
    isRestoring: (target: HomeCardIdentity) =>
      active &&
      pending &&
      remembered?.sectionId === target.sectionId &&
      remembered?.cardId === target.cardId,
    isPending: () => pending,
    isActive: () => active,
    cancel() {
      pending = false
    },
  }
}

/** Android delivers a paired release after navigation has already returned
 * Home. Only the press is new user intent; tvOS action values differ. */
export function isHomeRestoreCancellationInput(
  platform: string,
  event: { eventType?: string; eventKeyAction?: number } | null | undefined,
): boolean {
  if (!event || (platform === "android" && event.eventKeyAction === 1))
    return false
  return ["up", "down", "left", "right", "select", "menu", "back"].includes(
    event.eventType ?? "",
  )
}
