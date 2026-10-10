/**
 * KTD10: while Explore has focus, it yields continuously, not once on focus.
 * The watch page's session can start in the same commit as the tab's focus,
 * as in `heroYield.ts`. `useExploreTakeover` wires the subscription to these rules.
 */

import {
  sameSessionContent,
  type MiniPlayerSession,
  type MiniPlayerStoreSnapshot,
} from "../miniPlayer/store"

/** The video Explore paused under a picture-in-picture hold. */
export type PendingTakeover = Pick<MiniPlayerSession, "videoId" | "videoSlug">

export type TakeoverStep = {
  /** The pending takeover to keep for the next step. */
  pending: PendingTakeover | null
  /** Call `requestDismiss()`: a dismiss, never a "replaced" end. */
  dismiss: boolean
  /** Pause the root player through the playback transport. */
  pauseRoot: boolean
}

const NO_STEP: TakeoverStep = {
  pending: null,
  dismiss: false,
  pauseRoot: false,
}

/**
 * Run on every store notification and on every focus change. Under a hold,
 * the store's deferred dismiss would fire even after a blur, so Explore keeps
 * its own pending takeover and a blur cancels it.
 */
export function stepTakeover(input: {
  snapshot: MiniPlayerStoreSnapshot
  focused: boolean
  pending: PendingTakeover | null
}): TakeoverStep {
  const { snapshot, focused, pending } = input
  const session = snapshot.session
  if (!focused || session == null || snapshot.dismissal !== "none") {
    return NO_STEP
  }

  if (snapshot.pipHold) {
    if (pending != null && sameSessionContent(pending, session)) {
      return { pending, dismiss: false, pauseRoot: false }
    }
    return {
      pending: { videoId: session.videoId, videoSlug: session.videoSlug },
      dismiss: false,
      pauseRoot: true,
    }
  }

  if (pending != null) {
    return {
      pending: null,
      dismiss: sameSessionContent(pending, session),
      pauseRoot: false,
    }
  }
  return { pending: null, dismiss: true, pauseRoot: false }
}

/**
 * Whether a clip must wait to start. Under a hold, the watch page's request
 * stays in the store, so the clip waits only for the root player to pause.
 */
export function clipYieldsToRoot(input: {
  rootPlaying: boolean
  rootHasRequest: boolean
  pipHold: boolean
}): boolean {
  if (input.rootPlaying) return true
  return input.rootHasRequest && !input.pipHold
}
