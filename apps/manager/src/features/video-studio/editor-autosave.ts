import type { EditorSession } from "./editor-session"

/** Coalesce gestures without queuing competing revision writes or retry loops. */
export function startEditorAutosave(session: EditorSession, delayMs = 750) {
  let timer: ReturnType<typeof setTimeout> | undefined
  let previous = session.getSnapshot()
  const cancel = () => {
    clearTimeout(timer)
    timer = undefined
  }
  const schedule = () => {
    const next = session.getSnapshot()
    // Playback and selection notifications must not defer a pending save.
    if (
      next.document === previous.document &&
      next.status === previous.status &&
      next.authenticationRequired === previous.authenticationRequired
    )
      return
    previous = next
    cancel()
    if (
      next.editable &&
      next.hasUnsavedChanges &&
      next.status === "unsaved" &&
      !next.authenticationRequired
    )
      timer = setTimeout(() => {
        timer = undefined
        void session.save()
      }, delayMs)
  }
  // Recovered edits can be unsaved before the editor mounts.
  previous = { ...previous, status: "saved" }
  schedule()
  const unsubscribe = session.subscribe(schedule)
  return () => {
    cancel()
    unsubscribe()
  }
}
