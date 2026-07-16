import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react"
import type { ReactNode } from "react"

// ── Types ───────────────────────────────────────────────────────────────────

type VideoPlayerState = {
  currentUrl: string | null
  currentTitle: string | null
  currentSubtitle: string | null
  isVisible: boolean
}

type VideoPlayerContextValue = {
  playVideo: (streamingUrl: string, title?: string, subtitle?: string) => void
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
  isVisible: false,
}

// ── Provider ────────────────────────────────────────────────────────────────

export function VideoPlayerProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<VideoPlayerState>(INITIAL_STATE)
  const [decoderClaimed, setDecoderClaimed] = useState(false)

  const playVideo = useCallback(
    (streamingUrl: string, title?: string, subtitle?: string) => {
      setState({
        currentUrl: streamingUrl,
        currentTitle: title ?? null,
        currentSubtitle: subtitle ?? null,
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
