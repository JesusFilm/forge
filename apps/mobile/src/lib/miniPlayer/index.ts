// The app-wide mini player singletons (U6).
//
// Wired to the auth session module directly, NOT through React context: the
// store is module scope so the picture-in-picture latch, the AppState handler
// and the watch route can all reach it without a provider having mounted.
// Lazy getters, never module-scope construction (the apolloClient convention).

import { getAuthSession } from "../authSession"
import { createSessionEndRegistry } from "./endRegistry"
import { createMiniPlayerStore, type MiniPlayerStore } from "./store"
import { createSheetCounter, type SheetCounter } from "./suppression"
import type { SessionEndListener } from "./endRegistry"

/**
 * The signed-in subject, read without React. Deliberately not
 * `getSignedInAccountId` from the progress sync client: that module reaches
 * Apollo and AsyncStorage at import, which this leaf must not.
 */
function currentSubjectId(): string | null {
  const snapshot = getAuthSession().getSnapshot()
  return snapshot.status === "signedIn" ? snapshot.user.id : null
}

const sessionEnd = createSessionEndRegistry()

/** The host registers the live player's named end; the release is safe to
 *  call after a successor has registered. */
export function registerSessionEnd(listener: SessionEndListener): () => void {
  return sessionEnd.register(listener)
}

let store: MiniPlayerStore | null = null

export function getMiniPlayerStore(): MiniPlayerStore {
  if (!store) {
    store = createMiniPlayerStore({
      getSubjectId: currentSubjectId,
      subscribeToSubject: (listener) =>
        getAuthSession().subscribe(() => listener(currentSubjectId())),
      onEnd: (_session, reason) => sessionEnd.end(reason),
    })
  }
  return store
}

let sheets: SheetCounter | null = null

/** The two sheets that own no route report here (R11); the presentation
 *  selector reads the count. */
export function getMiniPlayerSheets(): SheetCounter {
  if (!sheets) sheets = createSheetCounter()
  return sheets
}
