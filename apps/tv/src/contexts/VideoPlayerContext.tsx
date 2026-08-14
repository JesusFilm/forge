import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react"
import type { ReactNode } from "react"

import type { WatchEventIdentity } from "../lib/watchEvents/watchEvents"

/** What autoplays when the current video ends: the parent's next child.
 *  Threaded from the details screen (which owns the record) so the overlay
 *  host can offer it at playToEnd. */
export type UpNextTarget = {
  slug: string
  title: string | null
  posterUrl: string | null
}

// ── Types ───────────────────────────────────────────────────────────────────

type VideoPlayerState = {
  currentUrl: string | null
  currentTitle: string | null
  currentSubtitle: string | null
  /** What is playing, for anonymous watch-event capture (feat-322). Call
   *  sites without admin identity (trailers, experience cards) omit it and
   *  no event is recorded — mirrors web recording on watch pages only. */
  currentIdentity: WatchEventIdentity | null
  /** Continue Watching resume point for this playback, or null. */
  currentStartAtSeconds: number | null
  /** Up Next autoplay target for this playback, or null (nothing follows). */
  currentUpNext: UpNextTarget | null
  isVisible: boolean
}

type VideoPlayerContextValue = {
  playVideo: (
    streamingUrl: string,
    title?: string,
    subtitle?: string,
    identity?: WatchEventIdentity,
    startAtSeconds?: number,
    upNext?: UpNextTarget | null,
  ) => void
  dismissVideo: () => void
  state: VideoPlayerState
  /** Showcase Mode holds the app's only decode slot while it runs (KTD-1). Kept out
   *  of VideoPlayerState because dismissVideo resets that object wholesale and would
   *  drop a claim it knows nothing about. Consumers OR it into overlayVisible. */
  decoderClaimed: boolean
  setDecoderClaimed: (claimed: boolean) => void
}

// ── Context ─────────────────────────────────────────────────────────────────

const VideoPlayerContext = createContext<VideoPlayerContextValue | null>(null)

const INITIAL_STATE: VideoPlayerState = {
  currentUrl: null,
  currentTitle: null,
  currentSubtitle: null,
  currentIdentity: null,
  currentStartAtSeconds: null,
  currentUpNext: null,
  isVisible: false,
}

// ── Provider ────────────────────────────────────────────────────────────────

export function VideoPlayerProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<VideoPlayerState>(INITIAL_STATE)
  const [decoderClaimed, setDecoderClaimed] = useState(false)

  const playVideo = useCallback(
    (
      streamingUrl: string,
      title?: string,
      subtitle?: string,
      identity?: WatchEventIdentity,
      startAtSeconds?: number,
      upNext?: UpNextTarget | null,
    ) => {
      setState({
        currentUrl: streamingUrl,
        currentTitle: title ?? null,
        currentSubtitle: subtitle ?? null,
        currentIdentity: identity ?? null,
        currentStartAtSeconds:
          startAtSeconds != null && startAtSeconds > 0 ? startAtSeconds : null,
        currentUpNext: upNext ?? null,
        isVisible: true,
      })
    },
    [],
  )

  const dismissVideo = useCallback(() => {
    setState(INITIAL_STATE)
  }, [])

  const value = useMemo<VideoPlayerContextValue>(
    () => ({
      playVideo,
      dismissVideo,
      state,
      decoderClaimed,
      setDecoderClaimed,
    }),
    [playVideo, dismissVideo, state, decoderClaimed],
  )

  return (
    <VideoPlayerContext.Provider value={value}>
      {children}
    </VideoPlayerContext.Provider>
  )
}

// ── Hook ────────────────────────────────────────────────────────────────────

export function useVideoPlayerContext(): VideoPlayerContextValue {
  const ctx = useContext(VideoPlayerContext)
  if (ctx == null) {
    throw new Error(
      "useVideoPlayerContext must be used within a VideoPlayerProvider",
    )
  }
  return ctx
}
