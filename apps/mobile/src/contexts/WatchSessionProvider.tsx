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
import { useApolloClient } from "@apollo/client/react"

import {
  normalizeDubMedia,
  type VariantMedia,
  type WatchVideoRecord,
} from "../lib/normalizeVideo"
import { ensureDubMedia } from "../lib/dubMediaFetch"
import { GET_VIDEO_DUB } from "../lib/queries"
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
   * The active variant's downloads + subtitles, fetched lazily (one dub at a
   * time) via {@link ensureActiveVariantMedia}. `null` until that dub's media
   * has loaded — distinct from "loaded, empty" (`{ downloads: [], subtitles: [] }`).
   */
  activeVariantMedia: VariantMedia | null
  /** True while the active variant's media request is in flight. */
  activeVariantMediaLoading: boolean
  /**
   * True when the active variant's media fetch failed (vs. loaded-but-empty).
   * Lets sheets show a retry affordance instead of a misleading empty list.
   */
  activeVariantMediaError: boolean
  /**
   * Fetch the active variant's downloads + subtitles if not already loaded /
   * in flight. Call when the Download/Subtitle sheet opens or captions turn on.
   * Deduped per dub id; a failed fetch is retried on the next call.
   */
  ensureActiveVariantMedia: () => void
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

  // Lazily-fetched per-dub media (downloads + subtitles), keyed by dub id so a
  // language the user already opened stays warm across switches and re-entry.
  // `requestedRef` dedupes in-flight + completed fetches; a failed one is
  // dropped from it so the next ensure() retries.
  const client = useApolloClient()
  const [mediaById, setMediaById] = useState<Record<string, VariantMedia>>({})
  const [loadingIds, setLoadingIds] = useState<Record<string, true>>({})
  const [errorIds, setErrorIds] = useState<Record<string, true>>({})
  const requestedRef = useRef<Set<string>>(new Set())

  const activeVariantId = activeVariant?.documentId ?? null
  const activeVariantMedia = activeVariantId
    ? (mediaById[activeVariantId] ?? null)
    : null
  const activeVariantMediaLoading = activeVariantId
    ? (loadingIds[activeVariantId] ?? false)
    : false
  const activeVariantMediaError = activeVariantId
    ? (errorIds[activeVariantId] ?? false)
    : false

  const ensureActiveVariantMedia = useCallback(() => {
    ensureDubMedia(
      activeVariant?.documentId,
      requestedRef.current,
      async (id) => {
        const res = await client.query({
          query: GET_VIDEO_DUB,
          variables: { id },
          // The dub is normalized by id; once fetched, re-opening the sheet (or
          // switching back to this language) reads the warm cache, no refetch.
          fetchPolicy: "cache-first",
        })
        return normalizeDubMedia(res.data?.videoDub ?? null)
      },
      {
        onStart: (id) => {
          setLoadingIds((prev) => ({ ...prev, [id]: true }))
          setErrorIds((prev) => {
            if (!prev[id]) return prev
            const next = { ...prev }
            delete next[id]
            return next
          })
        },
        onSuccess: (id, media) =>
          setMediaById((prev) => ({ ...prev, [id]: media })),
        onError: (id) => setErrorIds((prev) => ({ ...prev, [id]: true })),
        onSettled: (id) =>
          setLoadingIds((prev) => {
            const next = { ...prev }
            delete next[id]
            return next
          }),
      },
    )
  }, [activeVariant?.documentId, client])

  // New video identity → reset choice tracking + subtitle state. Declared
  // before the resolution effects so their guards see a clean slate.
  useEffect(() => {
    userChoseVariantRef.current = false
    userChoseSubtitleRef.current = false
    resolvedVariantForRef.current = null
    resolvedSubtitleForRef.current = null
    setSubtitleEnabledState(false)
    setActiveSubtitleSlugState(null)
    // Drop the previous video's per-dub media. Dub ids are per-video, so
    // nothing is reused across videos — keeping it only grows memory and lets a
    // post-cache-clear requestedRef entry wedge a dub into a permanent no-op.
    setMediaById({})
    setLoadingIds({})
    setErrorIds({})
    requestedRef.current.clear()
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
  // Subtitles now arrive lazily, so this runs when the active dub's media lands
  // (keyed on the dub id), not at video-load time.
  useEffect(() => {
    const subtitles = activeVariantMedia?.subtitles
    if (!activeVariant || !subtitles || subtitles.length === 0) return
    if (userChoseSubtitleRef.current) return
    if (resolvedSubtitleForRef.current === activeVariant.documentId) return
    resolvedSubtitleForRef.current = activeVariant.documentId
    const options = subtitles.map((s) => ({
      slug: s.languageSlug,
      bcp47: s.languageBcp47,
    }))
    const best = resolveDefaultSlug(
      options,
      video?.primaryLanguageBcp47 ?? null,
    )
    if (best) setActiveSubtitleSlugState(best)
  }, [activeVariant?.documentId, activeVariantMedia])

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
      activeVariantMedia,
      activeVariantMediaLoading,
      activeVariantMediaError,
      ensureActiveVariantMedia,
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
      activeVariantMedia,
      activeVariantMediaLoading,
      activeVariantMediaError,
      ensureActiveVariantMedia,
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
