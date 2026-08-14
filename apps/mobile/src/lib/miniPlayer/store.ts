// The mini player session store (KTD2). Module-scope and subscribable rather
// than React context: the window shows a position updating at the adapter's
// one-second poll, and a root context would re-render every consumer beneath it
// on each tick — including Home's list. It is also readable WITHOUT React,
// which the picture-in-picture latch and the AppState handler both need.

import type { SessionEndReason } from "./types"

export type { SessionEndReason }

/** What starting a session needs. Position and subject are stamped by the store. */
export type MiniPlayerSessionInput = {
  videoId?: string
  videoSlug?: string
  languageSlug?: string | null
  streamingUrl: string
  posterUrl?: string | null
  title?: string | null
  durationSeconds?: number
}

export type MiniPlayerSession = MiniPlayerSessionInput & {
  positionSeconds: number
  durationSeconds: number
  /** The signed-in subject that owns this session (R25). Null when signed out. */
  subjectId: string | null
}

export type MiniPlayerStoreDeps = {
  getSubjectId: () => string | null
  /** Auth is readable without React, which is what a module-scope store needs. */
  subscribeToSubject: (
    listener: (subjectId: string | null) => void,
  ) => () => void
  /** Fired as a session ends, so the host can flush progress and close QoE. */
  onEnd?: (session: MiniPlayerSession, reason: SessionEndReason) => void
}

export function createMiniPlayerStore(deps: MiniPlayerStoreDeps) {
  let session: MiniPlayerSession | null = null
  let ownerSubjectId: string | null = deps.getSubjectId()
  const listeners = new Set<() => void>()

  const notify = () => {
    for (const listener of [...listeners]) listener()
  }

  /**
   * End without notifying, so a replace publishes ONE change rather than a
   * null frame the window would briefly render as dismissed.
   */
  const endSilently = (reason: SessionEndReason) => {
    const ending = session
    session = null
    if (ending != null) deps.onEnd?.(ending, reason)
  }

  const unsubscribeAuth = deps.subscribeToSubject((subjectId) => {
    if (subjectId === ownerSubjectId) return
    ownerSubjectId = subjectId
    // R25: sign-out, account switch and account deletion all arrive here. The
    // session dies with the subject that owned it — carrying it across would
    // attribute the next account's progress to the previous viewer.
    if (session == null) return
    // Signing IN is the exception: an unowned session has no previous viewer
    // to mis-attribute, so it is ADOPTED. Ending it would stop playback at the
    // moment the viewer accepted the prompt that offers to save their place.
    if (session.subjectId == null && subjectId != null) {
      session = { ...session, subjectId }
      notify()
      return
    }
    endSilently("signout")
    notify()
  })

  return {
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    /**
     * Referentially stable while nothing changes. useSyncExternalStore compares
     * by identity, so returning a fresh object per call is an infinite render
     * loop, not a performance note.
     */
    getSnapshot: (): MiniPlayerSession | null => session,

    /** R12: starting a different video replaces what the window is playing. */
    start(input: MiniPlayerSessionInput) {
      if (session != null) endSilently("replaced")
      session = {
        ...input,
        positionSeconds: 0,
        durationSeconds: input.durationSeconds ?? 0,
        subjectId: deps.getSubjectId(),
      }
      ownerSubjectId = session.subjectId
      notify()
    },

    /** The adapter's 1s poll. No-ops with no session, so a post-end tick in
     *  flight cannot resurrect one. */
    updateProgress(positionSeconds: number, durationSeconds?: number) {
      if (session == null) return
      session = {
        ...session,
        positionSeconds,
        durationSeconds: durationSeconds ?? session.durationSeconds,
      }
      notify()
    },

    end(reason: SessionEndReason) {
      if (session == null) return
      endSilently(reason)
      notify()
    },

    /** Test and teardown only — drops the auth subscription. */
    destroy() {
      unsubscribeAuth()
      listeners.clear()
      session = null
    },
  }
}

export type MiniPlayerStore = ReturnType<typeof createMiniPlayerStore>
