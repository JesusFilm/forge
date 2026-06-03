import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
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
  const [activeVariantIndex, setActiveVariantIndexState] = useState(0)
  const [subtitleEnabled, setSubtitleEnabledState] = useState(false)
  const [activeSubtitleSlug, setActiveSubtitleSlugState] = useState<
    string | null
  >(null)
  const [snackbarMessage, setSnackbarMessage] = useState<string | null>(null)

  // Whether the user has explicitly chosen a variant / subtitle for the current
  // video. Guards the default-resolution effects from overriding a user's
  // choice when partial → full data enrichment republishes the same video.
  const userChoseVariantRef = useRef(false)
  const userChoseSubtitleRef = useRef(false)
  // The video / variant identity defaults were last resolved for, so the
  // resolution effects fire once per identity even though they now also re-run
  // when variants arrive (partial data lands variants after the documentId).
  const resolvedVariantForRef = useRef<string | null>(null)
  const resolvedSubtitleForRef = useRef<string | null>(null)

  // Exposed setters mark explicit user intent; the resolution effects below use
  // the raw state setters so they never trip these guards.
  const setActiveVariantIndex = useCallback((index: number) => {
    userChoseVariantRef.current = true
    setActiveVariantIndexState(index)
  }, [])
  const setSubtitleEnabled = useCallback((enabled: boolean) => {
    userChoseSubtitleRef.current = true
    setSubtitleEnabledState(enabled)
  }, [])
  const setActiveSubtitleSlug = useCallback((slug: string | null) => {
    userChoseSubtitleRef.current = true
    setActiveSubtitleSlugState(slug)
  }, [])

  // Clamp against the active index: when navigating to a different video, the
  // index from the previous one can briefly exceed the new variant list before
  // the default-resolution effect re-runs. Clamping avoids a one-frame
  // undefined variant.
  const activeVariant =
    video && video.variants.length > 0
      ? (video.variants[
          Math.min(activeVariantIndex, video.variants.length - 1)
        ] ?? null)
      : null

  // New video identity → reset choice tracking + subtitle state. Declared
  // before the resolution effects so their guards see a clean slate.
  useEffect(() => {
    userChoseVariantRef.current = false
    userChoseSubtitleRef.current = false
    resolvedVariantForRef.current = null
    resolvedSubtitleForRef.current = null
    setSubtitleEnabledState(false)
    setActiveSubtitleSlugState(null)
  }, [video?.documentId])

  // Default the dubbing language once per video, as soon as variants are
  // available (they may arrive after the documentId via partial data), unless
  // the user already chose. Device locale → video primary → English → first.
  useEffect(() => {
    if (!video || video.variants.length === 0) return
    if (userChoseVariantRef.current) return
    if (resolvedVariantForRef.current === video.documentId) return
    resolvedVariantForRef.current = video.documentId
    const options = video.variants.map((v) => ({
      slug: v.slug,
      bcp47: v.languageBcp47,
    }))
    const best = resolveDefaultSlug(options, video.primaryLanguageBcp47)
    const idx = best ? video.variants.findIndex((v) => v.slug === best) : -1
    setActiveVariantIndexState(idx >= 0 ? idx : 0)
  }, [video?.documentId, video?.variants.length, video?.primaryLanguageBcp47])

  // Pre-select the best subtitle for the active variant once (subtitles stay
  // disabled until the user turns them on), unless the user already chose.
  useEffect(() => {
    if (!activeVariant || activeVariant.subtitles.length === 0) return
    if (userChoseSubtitleRef.current) return
    if (resolvedSubtitleForRef.current === activeVariant.documentId) return
    resolvedSubtitleForRef.current = activeVariant.documentId
    const options = activeVariant.subtitles.map((s) => ({
      slug: s.languageSlug,
      bcp47: s.languageBcp47,
    }))
    const best = resolveDefaultSlug(
      options,
      video?.primaryLanguageBcp47 ?? null,
    )
    if (best) setActiveSubtitleSlugState(best)
  }, [activeVariant?.documentId])

  const value = useMemo<WatchSessionContextValue>(
    () => ({
      video,
      setVideo,
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
      activeVariantIndex,
      setActiveVariantIndex,
      subtitleEnabled,
      setSubtitleEnabled,
      activeSubtitleSlug,
      setActiveSubtitleSlug,
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
