/**
 * The mini-player session store (KTD2): a module-scope subscribable store, not
 * React context. The window shows a position updating at the adapter's
 * one-second poll, and a root context would re-render every consumer beneath it
 * on each tick. It is also readable WITHOUT React, which the picture-in-picture
 * latch and the AppState handler need.
 *
 * A factory plus a lazy module singleton, matching `authSession.ts`: every
 * behaviour decision unit-tests against a fresh instance with no React and no
 * native module, while the app reads one store.
 */

import type { AuthSessionSnapshot } from "../authSession"
import type { VideoQoeReason } from "../videoQoe"

/** playing | ended is a session PHASE, distinct from dismissal (R21, R27). */
export type MiniPlayerPhase = "playing" | "ended"

/** Why the session ended in place: playback finished, or the stream failed
 *  unrecoverably (R22). Both keep the window on screen. */
export type MiniPlayerEndedCause = "playToEnd" | "failure"

/**
 * Dismissal is a three-state, not a boolean: a dismiss requested while the
 * picture-in-picture hold is set must DEFER, because R24 forbids any mount or
 * unmount while that hold is set (AE12).
 */
export type MiniPlayerDismissal = "none" | "deferred" | "exiting"

export type MiniPlayerSession = {
  /** Admin video id; null for downloaded playback, which has only a slug. */
  videoId: string | null
  videoSlug: string
  languageSlug: string | null
  title: string
  posterUrl: string | null
  /** The signed-in subject at creation, null when signed out. A change ends the
   *  session (R25). */
  accountId: string | null
  /** The route pattern the session was created from — R19 exclusion is keyed on
   *  where a session ORIGINATED, never on where the viewer now is. */
  originPattern: string | null
  positionSeconds: number
  durationSeconds: number
  phase: MiniPlayerPhase
  endedCause: MiniPlayerEndedCause | null
}

export type MiniPlayerSessionInput = {
  videoId: string | null
  videoSlug: string
  languageSlug?: string | null
  title: string
  posterUrl?: string | null
  originPattern?: string | null
  positionSeconds?: number
  durationSeconds?: number
}

export type MiniPlayerStoreSnapshot = {
  session: MiniPlayerSession | null
  dismissal: MiniPlayerDismissal
  /** KTD12/KTD16: while set, no view mounts, unmounts, or changes owner. */
  pipHold: boolean
}

/**
 * The explicit end signal (KTD13). The store owns no progress or telemetry
 * dependency; it reports the ending and the ended session, and U5 turns that
 * into a flush trigger and a quality-session finalize.
 */
export type MiniPlayerEndEvent = {
  session: MiniPlayerSession
  reason: VideoQoeReason
  /** Set when the reason is "ended", so a failure is distinguishable from a
   *  play-to-end without widening the quality vocabulary here. */
  endedCause: MiniPlayerEndedCause | null
}

/**
 * The auth surface KTD15 needs, typed off `authSession.ts`'s own snapshot so
 * `getAuthSession()` plugs in with no adapter.
 */
export type MiniPlayerAuthSource = {
  getSnapshot: () => AuthSessionSnapshot
  subscribe: (listener: () => void) => () => void
}

export type MiniPlayerStore = ReturnType<typeof createMiniPlayerStore>

const EMPTY_SNAPSHOT: MiniPlayerStoreSnapshot = {
  session: null,
  dismissal: "none",
  pipHold: false,
}

/**
 * Identity of the content a session carries. A dub or subtitle change is the
 * same content, so it must not read as a replacement (R12 is about a different
 * video taking the window over).
 */
export function sessionIdentityKey(
  session: Pick<MiniPlayerSession, "videoId" | "videoSlug">,
): string {
  return session.videoId ? `id:${session.videoId}` : `slug:${session.videoSlug}`
}

export function createMiniPlayerStore() {
  let snapshot: MiniPlayerStoreSnapshot = EMPTY_SNAPSHOT
  const listeners = new Set<() => void>()
  const endListeners = new Set<(event: MiniPlayerEndEvent) => void>()
  let auth: MiniPlayerAuthSource | null = null

  function currentAccountId(): string | null {
    const authSnapshot = auth?.getSnapshot()
    return authSnapshot?.status === "signedIn" ? authSnapshot.user.id : null
  }

  function commit(next: MiniPlayerStoreSnapshot) {
    snapshot = next
    for (const listener of listeners) listener()
  }

  /** Commit first, then report: a listener that reads the store during the
   *  report sees the state the ending produced, never the state it replaced. */
  function emitEnd(session: MiniPlayerSession, reason: VideoQoeReason) {
    const event: MiniPlayerEndEvent = {
      session,
      reason,
      endedCause: reason === "ended" ? session.endedCause : null,
    }
    for (const listener of endListeners) listener(event)
  }

  /** An ended session already closed its quality session at `markEnded`, so no
   *  later ending may close it a second time (R27). */
  function reportEnd(session: MiniPlayerSession, reason: VideoQoeReason) {
    if (session.phase === "ended") return
    emitEnd(session, reason)
  }

  function withSession(session: MiniPlayerSession): MiniPlayerStoreSnapshot {
    return { ...snapshot, session }
  }

  /**
   * Start the exit: playback stops and the window slides away (R6). The quality
   * session closes as dismissed only if it has not already closed as ended —
   * R27 forbids closing it twice.
   */
  function beginExit() {
    const session = snapshot.session
    if (!session) return
    commit({ ...snapshot, dismissal: "exiting" })
    reportEnd(session, "dismissed")
  }

  return {
    getSnapshot(): MiniPlayerStoreSnapshot {
      return snapshot
    },

    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    /** Subscribe to explicit session endings (progress flush + telemetry). */
    onEnd(listener: (event: MiniPlayerEndEvent) => void): () => void {
      endListeners.add(listener)
      return () => {
        endListeners.delete(listener)
      }
    },

    /**
     * The one session-start entry point: starting different content implicitly
     * ends the previous session as replaced, so no call site has to remember to
     * stop the old one first. Re-starting the SAME content (the viewer expands
     * back to the full screen) merges metadata and keeps the position.
     */
    start(input: MiniPlayerSessionInput): void {
      const previous = snapshot.session
      const merging =
        previous != null &&
        sessionIdentityKey(previous) === sessionIdentityKey(input)
      const session: MiniPlayerSession = {
        videoId: input.videoId,
        videoSlug: input.videoSlug,
        languageSlug: input.languageSlug ?? null,
        title: input.title,
        posterUrl: input.posterUrl ?? null,
        accountId: merging ? previous.accountId : currentAccountId(),
        originPattern:
          input.originPattern ?? (merging ? previous.originPattern : null),
        positionSeconds:
          input.positionSeconds ?? (merging ? previous.positionSeconds : 0),
        durationSeconds:
          input.durationSeconds ?? (merging ? previous.durationSeconds : 0),
        phase: merging ? previous.phase : "playing",
        endedCause: merging ? previous.endedCause : null,
      }
      commit({
        session,
        dismissal: merging ? snapshot.dismissal : "none",
        pipHold: snapshot.pipHold,
      })
      if (previous && !merging) reportEnd(previous, "replaced")
    },

    /**
     * Position feed from the adapter's one-second poll (U5). Rejected when the
     * signed-in subject no longer matches the one the session was created under,
     * so a tick in flight across a sign-out cannot write for the old account
     * (R25).
     */
    publishPosition(update: {
      positionSeconds: number
      durationSeconds?: number
    }): void {
      const session = snapshot.session
      if (!session) return
      if (session.accountId !== currentAccountId()) return
      commit(
        withSession({
          ...session,
          positionSeconds: update.positionSeconds,
          durationSeconds: update.durationSeconds ?? session.durationSeconds,
        }),
      )
    },

    /**
     * Playback finished, or the stream failed: the window persists showing the
     * thumbnail and the quality session closes here, not on dismissal (R21,
     * R22, R27).
     */
    markEnded(cause: MiniPlayerEndedCause): void {
      const session = snapshot.session
      if (!session || session.phase === "ended") return
      const ended: MiniPlayerSession = {
        ...session,
        phase: "ended",
        endedCause: cause,
      }
      commit(withSession(ended))
      emitEnd(ended, "ended")
    },

    /** Replay from the ended state (R27) — the window is already mounted. */
    markPlaying(): void {
      const session = snapshot.session
      if (!session || session.phase === "playing") return
      commit(
        withSession({
          ...session,
          phase: "playing",
          endedCause: null,
          positionSeconds: 0,
        }),
      )
    },

    /**
     * The viewer dismissed the window. Idempotent, and deferred while the
     * picture-in-picture hold is set (R6, R24).
     */
    requestDismiss(): void {
      if (!snapshot.session || snapshot.dismissal !== "none") return
      if (snapshot.pipHold) {
        commit({ ...snapshot, dismissal: "deferred" })
        return
      }
      beginExit()
    },

    /**
     * The exit animation finished. The store clears ONLY from `exiting`, so a
     * stray report can never remove a live window (R6).
     */
    reportExitComplete(): void {
      if (snapshot.dismissal !== "exiting") return
      commit(EMPTY_SNAPSHOT)
    },

    /**
     * Explicit end that clears immediately — the paths with no exit animation
     * (R25's subject change, and the adapter's safety nets).
     */
    end(reason: VideoQoeReason): void {
      const session = snapshot.session
      if (!session) return
      commit({ session: null, dismissal: "none", pipHold: snapshot.pipHold })
      reportEnd(session, reason)
    },

    /** The picture-in-picture latch (KTD12), fed from the video view's own
     *  callbacks. Releasing it runs a dismiss that was deferred (AE12). */
    setPipHold(held: boolean): void {
      if (snapshot.pipHold === held) return
      commit({ ...snapshot, pipHold: held })
      if (!held && snapshot.dismissal === "deferred") beginExit()
    },

    /**
     * KTD15: the store subscribes to the auth session directly and ends on a
     * subject change (R25). A sign-out is neither a viewer dismissal nor a
     * replacement nor a play-to-end, so it reports as abandoned.
     *
     * Signing IN is not a loss of a subject: R25 names sign-out, account switch
     * and deletion, and stopping a video because the viewer signed in from
     * Profile would be a regression. That session is retagged instead.
     */
    attachAuthSession(source: MiniPlayerAuthSource): () => void {
      auth = source
      let knownAccountId = currentAccountId()
      const unsubscribe = source.subscribe(() => {
        const accountId = currentAccountId()
        if (accountId === knownAccountId) return
        const previousAccountId = knownAccountId
        knownAccountId = accountId
        const session = snapshot.session
        if (!session) return
        if (previousAccountId == null) {
          commit(withSession({ ...session, accountId }))
          return
        }
        commit({ session: null, dismissal: "none", pipHold: snapshot.pipHold })
        reportEnd(session, "abandoned")
      })
      return () => {
        unsubscribe()
        auth = null
      }
    },
  }
}

let store: MiniPlayerStore | null = null

/** The app-wide mini-player session store. */
export function getMiniPlayerStore(): MiniPlayerStore {
  if (!store) store = createMiniPlayerStore()
  return store
}
