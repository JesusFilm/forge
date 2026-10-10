import { useEffect, useRef } from "react"

import {
  activeSlot,
  isClipFailed,
  veilVisible,
  type FeedEvent,
  type FeedState,
} from "../lib/explore/feedState"
import type { FeedClip } from "../lib/explore/types"
import { muxHeroPosterFromPlaybackId } from "../lib/muxThumbnail"
import { resolveImageUrl } from "../lib/resolveImageUrl"
import { AUTOSTART_VEIL_TIMEOUT_MS } from "./useAutostartPlayback"

/**
 * KTD14: `useAutostartPlayback` covers one load, so this gate re-arms per clip
 * with the same three releases: play, a source error, or the timeout. Every
 * covering layer reads ONE predicate (docs/solutions/logic-errors/occluding-layers-must-share-one-gate-predicate.md).
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
  /** The veil and its spinner. */
  veilVisible: boolean
  /** The image under the veil. Null whenever the veil is down. */
  image: ClipVeilImage | null
  /** R40: the clip cannot play. The veil and the image are down. */
  failed: boolean
}

/**
 * The authored image, else the pre-generated poster derivative. A blank or
 * malformed authored value is a real shape, so it falls through.
 */
export function clipPosterUri(clip: FeedClip): string | null {
  return (
    resolveImageUrl(clip.imageUrl) ??
    muxHeroPosterFromPlaybackId(clip.muxPlaybackId)
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
    image,
    failed: isClipFailed(state),
  }
}
