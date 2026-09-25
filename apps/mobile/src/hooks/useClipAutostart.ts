import { useEffect, useRef } from "react"

import {
  activeSlot,
  isClipFailed,
  veilVisible,
  type FeedEvent,
  type FeedState,
} from "../lib/explore/feedState"
import type { FeedClip } from "../lib/explore/types"
import { muxThumbnailFromPlaybackId } from "../lib/muxThumbnail"
import { resolveImageUrl } from "../lib/resolveImageUrl"
import { AUTOSTART_VEIL_TIMEOUT_MS } from "./useAutostartPlayback"

/**
 * Explore's per-clip autostart gate (KTD14). `useAutostartPlayback` covers one
 * load and plays with no seek, and the feed loads a new clip on every swipe. So
 * this gate re-arms for each clip, with the same three release paths: playback
 * starts, the source errors, or `AUTOSTART_VEIL_TIMEOUT_MS` elapses.
 *
 * The reducer owns the phases and this hook owns only the timer. The veil, the
 * spinner, the poster, the still, and the failed state all come from ONE
 * predicate, so no layer can stay over the clip after the veil lifts
 * (docs/solutions/logic-errors/occluding-layers-must-share-one-gate-predicate.md).
 */

export type ClipVeilImage = {
  /** `still` is the one-player time-offset frame (KTD21). */
  kind: "poster" | "still"
  uri: string
}

export type ClipAutostartInput = {
  state: FeedState
  dispatch: (event: FeedEvent) => void
  /** `clipYieldsToRoot(...)` from `src/lib/explore/takeover.ts` (KTD10). */
  yieldsToRoot: boolean
  /** The active clip's time-offset still. Read in one-player mode only. */
  stillUri: string | null
  /** True once `stillUri` has loaded. It must describe that same URI. */
  stillLoaded: boolean
}

export type ClipAutostart = {
  veilVisible: boolean
  /** The spinner is part of the veil and never shows without it. */
  spinnerVisible: boolean
  /** The image under the veil. Null whenever the veil is down. */
  image: ClipVeilImage | null
  /** R40: the clip cannot play. The veil and the image are down. */
  failed: boolean
  /** One-player mode only. When false, the caller prefetches no still. */
  stillWanted: boolean
}

/**
 * The authored image, else the pre-generated poster derivative. A blank or
 * malformed authored value is a real shape, so it falls through.
 */
export function clipPosterUri(clip: FeedClip): string | null {
  return (
    resolveImageUrl(clip.imageUrl) ??
    muxThumbnailFromPlaybackId(clip.muxPlaybackId)
  )
}

export function useClipAutostart(input: ClipAutostartInput): ClipAutostart {
  const { state, dispatch, yieldsToRoot, stillUri, stillLoaded } = input
  const slot = activeSlot(state)
  const veiled = veilVisible(state) && slot != null
  const token = veiled ? slot.token : null
  const stillWanted = state.playerMode === "one"
  // The timer bounds a load. No load starts before the pager rests, and a clip
  // that yields to the root player would otherwise fail at 12 s once loaded.
  const armed = token != null && !yieldsToRoot && state.pagerAtRest

  // A caller that wraps dispatch inline must not restart the timer each render.
  const dispatchRef = useRef(dispatch)
  useEffect(() => {
    dispatchRef.current = dispatch
  }, [dispatch])

  useEffect(() => {
    if (!armed || token == null) return
    const timer = setTimeout(
      () => dispatchRef.current({ type: "timeout", token }),
      AUTOSTART_VEIL_TIMEOUT_MS,
    )
    return () => clearTimeout(timer)
  }, [armed, token])

  let image: ClipVeilImage | null = null
  if (veiled) {
    if (stillWanted && stillLoaded && stillUri) {
      image = { kind: "still", uri: stillUri }
    } else {
      const poster = clipPosterUri(slot.clip)
      image = poster == null ? null : { kind: "poster", uri: poster }
    }
  }

  return {
    veilVisible: veiled,
    spinnerVisible: veiled,
    image,
    failed: isClipFailed(state),
    stillWanted,
  }
}
