import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"

import type { WatchVideoRecord } from "../lib/normalizeVideo"
import { resolveDefaultSlug } from "../lib/resolveDefaultLanguage"

/**
 * Shared selection state for the watch screen and its formSheet routes.
 *
 * The sheets (Language/Subtitle/Download) are separate navigation routes, so
 * they cannot receive callback props from the player screen. Instead the player
 * publishes the normalized video here and all routes read/write the active
 * variant + subtitle selection through this context.
 */
type WatchSessionContextValue = {
  video: WatchVideoRecord | null
  setVideo: (video: WatchVideoRecord | null) => void
  activeVariantIndex: number
  setActiveVariantIndex: (index: number) => void
  subtitleEnabled: boolean
  setSubtitleEnabled: (enabled: boolean) => void
  activeSubtitleSlug: string | null
  setActiveSubtitleSlug: (slug: string | null) => void
  /** Convenience: the variant currently selected, or null. */
  activeVariant: WatchVideoRecord["variants"][number] | null
  /**
   * Cross-route snackbar signal. The download sheet route sets this on
   * completion and dismisses itself; the player screen renders the snackbar.
   */
  snackbarMessage: string | null
  setSnackbarMessage: (message: string | null) => void
}

const WatchSessionContext = createContext<WatchSessionContextValue | null>(null)

export function WatchSessionProvider({ children }: { children: ReactNode }) {
  const [video, setVideo] = useState<WatchVideoRecord | null>(null)
  const [activeVariantIndex, setActiveVariantIndex] = useState(0)
  const [subtitleEnabled, setSubtitleEnabled] = useState(false)
  const [activeSubtitleSlug, setActiveSubtitleSlug] = useState<string | null>(
    null,
  )
  const [snackbarMessage, setSnackbarMessage] = useState<string | null>(null)

  const activeVariant = video?.variants[activeVariantIndex] ?? null

  // Default the dubbing language: device locale → video primary → English → first.
  useEffect(() => {
    if (!video || video.variants.length === 0) return
    const options = video.variants.map((v) => ({
      slug: v.slug,
      bcp47: v.languageBcp47,
    }))
    const best = resolveDefaultSlug(options, video.primaryLanguageBcp47)
    if (best) {
      const idx = video.variants.findIndex((v) => v.slug === best)
      if (idx >= 0) setActiveVariantIndex(idx)
    }
  }, [video?.documentId])

  // Pre-select the best subtitle for the active variant (subtitles stay disabled
  // until the user turns them on).
  useEffect(() => {
    if (!activeVariant || activeVariant.subtitles.length === 0) return
    const options = activeVariant.subtitles.map((s) => ({
      slug: s.languageSlug,
      bcp47: s.languageBcp47,
    }))
    const best = resolveDefaultSlug(
      options,
      video?.primaryLanguageBcp47 ?? null,
    )
    if (best) setActiveSubtitleSlug(best)
  }, [activeVariant?.documentId])

  const setVideoStable = useCallback((next: WatchVideoRecord | null) => {
    setVideo(next)
  }, [])

  const value = useMemo<WatchSessionContextValue>(
    () => ({
      video,
      setVideo: setVideoStable,
      activeVariantIndex,
      setActiveVariantIndex,
      subtitleEnabled,
      setSubtitleEnabled,
      activeSubtitleSlug,
      setActiveSubtitleSlug,
      activeVariant,
      snackbarMessage,
      setSnackbarMessage,
    }),
    [
      video,
      setVideoStable,
      activeVariantIndex,
      subtitleEnabled,
      activeSubtitleSlug,
      activeVariant,
      snackbarMessage,
    ],
  )

  return (
    <WatchSessionContext.Provider value={value}>
      {children}
    </WatchSessionContext.Provider>
  )
}

export function useWatchSession() {
  const ctx = useContext(WatchSessionContext)
  if (!ctx) {
    throw new Error("useWatchSession must be used within WatchSessionProvider")
  }
  return ctx
}
