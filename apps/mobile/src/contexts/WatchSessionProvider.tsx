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
import { subtitleNameToCache } from "../lib/subtitleSelection"
import { useWatchPreferences } from "./WatchPreferencesProvider"

/**
 * Shared selection state across the watch screen and its formSheet routes
 * (Language/Subtitle/Download). Sheets are separate routes so can't take props;
 * the player publishes the video here and all routes read/write selection.
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
  /**
   * The persisted display name of the preferred subtitle language, available
   * immediately on mount (before the lazy per-dub media lands). Lets the
   * Subtitles control show the name on a cold load instead of a placeholder.
   */
  preferredSubtitleName: string | null
  /** Convenience: the variant currently selected, or null. */
  activeVariant: WatchVideoRecord["variants"][number] | null
  /**
   * Active variant's downloads + subtitles, fetched lazily per dub via
   * {@link ensureActiveVariantMedia}. `null` until loaded — distinct from
   * "loaded, empty" (`{ downloads: [], subtitles: [] }`).
   */
  activeVariantMedia: VariantMedia | null
  /** True while the active variant's media request is in flight. */
  activeVariantMediaLoading: boolean
  /**
   * True when the media fetch failed (vs. loaded-but-empty), so sheets can show
   * a retry affordance instead of a misleading empty list.
   */
  activeVariantMediaError: boolean
  /**
   * Fetch the active variant's downloads + subtitles unless already loaded/in
   * flight; call when the Download/Subtitle sheet opens or captions turn on.
   * Deduped per dub id; a failed fetch is retried on the next call.
   */
  ensureActiveVariantMedia: () => void
  /**
   * Cross-route snackbar signal: the download sheet sets it on completion and
   * dismisses itself; the player screen renders the snackbar.
   */
  snackbarMessage: string | null
  setSnackbarMessage: (message: string | null) => void
}

const WatchSessionContext = createContext<WatchSessionContextValue | null>(null)

export function WatchSessionProvider({ children }: { children: ReactNode }) {
  const {
    audioLanguageSlug: preferredAudioSlug,
    subtitleLanguageSlug: preferredSubtitleSlug,
    subtitleLanguageName: preferredSubtitleName,
    subtitlesEnabled,
    isReady: preferencesReady,
    setPreferredAudioLanguage,
    setPreferredSubtitleLanguage,
    setPreferredSubtitleName,
    setSubtitlesEnabled,
  } = useWatchPreferences()

  const [video, setVideo] = useState<WatchVideoRecord | null>(null)
  const [activeVariantIndex, setActiveVariantIndexState] = useState(0)
  const [activeSubtitleSlug, setActiveSubtitleSlugState] = useState<
    string | null
  >(null)
  const [snackbarMessage, setSnackbarMessage] = useState<string | null>(null)

  // Subtitles on/off is an app-wide preference, not per-session state — read it
  // straight from the persisted store so it carries across videos and restarts.
  const subtitleEnabled = subtitlesEnabled

  // Latest-render video snapshot so the audio setter reads the chosen variant's
  // language slug without taking `video` as a dep (which would re-create the
  // setter and context memo every render). Read only inside the event handler.
  const videoRef = useRef<WatchVideoRecord | null>(null)
  videoRef.current = video

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

  // Exposed setters mark explicit user intent (the resolution effects call the
  // raw setters, so never trip these guards) AND persist the choice app-wide by
  // language slug; a new video re-resolves that slug via resolveDefaultSlug.
  const setActiveVariantIndex = useCallback(
    (index: number) => {
      userChoseVariantRef.current = true
      setActiveVariantIndexState(index)
      const slug = videoRef.current?.variants[index]?.languageSlug ?? null
      if (slug) setPreferredAudioLanguage(slug)
    },
    [setPreferredAudioLanguage],
  )
  const setSubtitleEnabled = useCallback(
    (enabled: boolean) => {
      userChoseSubtitleRef.current = true
      setSubtitlesEnabled(enabled)
    },
    [setSubtitlesEnabled],
  )
  const setActiveSubtitleSlug = useCallback(
    (slug: string | null) => {
      userChoseSubtitleRef.current = true
      setActiveSubtitleSlugState(slug)
      // The subtitle slug IS the unique language slug — persist it directly so
      // the choice maps onto other videos' subtitles. Only on a real selection;
      // turning subtitles off keeps the last language so re-enabling restores it.
      if (slug) setPreferredSubtitleLanguage(slug)
    },
    [setPreferredSubtitleLanguage],
  )

  // Clamp the active index: on navigating to a new video, the previous index
  // can briefly exceed the new variant list before the resolution effect
  // re-runs. Clamping avoids a one-frame undefined variant.
  const activeVariant =
    video && video.variants.length > 0
      ? (video.variants[
          Math.min(activeVariantIndex, video.variants.length - 1)
        ] ?? null)
      : null

  // Lazily-fetched per-dub media keyed by dub id so an already-opened language
  // stays warm across switches/re-entry. `requestedRef` dedupes in-flight +
  // completed fetches; a failed one is dropped so the next ensure() retries.
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
    // subtitleEnabled is now an app-wide pref (persists across videos); only the
    // per-video subtitle slug resets — it re-resolves once this dub's media lands.
    setActiveSubtitleSlugState(null)
    // Drop the previous video's per-dub media. Dub ids are per-video, so
    // nothing is reused across videos — keeping it only grows memory and lets a
    // post-cache-clear requestedRef entry wedge a dub into a permanent no-op.
    setMediaById({})
    setLoadingIds({})
    setErrorIds({})
    requestedRef.current.clear()
  }, [video?.documentId])

  // Default the dubbing language once per video as variants arrive (may land
  // after documentId via partial data), unless the user chose. Gated on
  // preferencesReady so the persisted choice applies first (no cold-start snap).
  useEffect(() => {
    if (!preferencesReady) return
    if (!video || video.variants.length === 0) return
    if (userChoseVariantRef.current) return
    if (resolvedVariantForRef.current === video.documentId) return
    resolvedVariantForRef.current = video.documentId
    const options = video.variants.map((v) => ({
      slug: v.slug,
      bcp47: v.languageBcp47,
      languageSlug: v.languageSlug,
    }))
    const best = resolveDefaultSlug(
      options,
      video.primaryLanguageBcp47,
      preferredAudioSlug,
    )
    const idx = best ? video.variants.findIndex((v) => v.slug === best) : -1
    setActiveVariantIndexState(idx >= 0 ? idx : 0)
  }, [
    video?.documentId,
    video?.variants.length,
    video?.primaryLanguageBcp47,
    preferencesReady,
    preferredAudioSlug,
  ])

  // Pre-select the subtitle language once per variant unless the user chose,
  // honoring the persisted pref first (visibility is the separate subtitleEnabled
  // pref). Subtitles arrive lazily, so this runs when the dub's media lands.
  useEffect(() => {
    if (!preferencesReady) return
    const subtitles = activeVariantMedia?.subtitles
    if (!activeVariant || !subtitles || subtitles.length === 0) return
    if (userChoseSubtitleRef.current) return
    if (resolvedSubtitleForRef.current === activeVariant.documentId) return
    resolvedSubtitleForRef.current = activeVariant.documentId
    const options = subtitles.map((s) => ({
      slug: s.languageSlug,
      bcp47: s.languageBcp47,
      languageSlug: s.languageSlug,
    }))
    const best = resolveDefaultSlug(
      options,
      video?.primaryLanguageBcp47 ?? null,
      preferredSubtitleSlug,
    )
    if (best) setActiveSubtitleSlugState(best)
  }, [
    activeVariant?.documentId,
    activeVariantMedia,
    preferencesReady,
    preferredSubtitleSlug,
  ])

  // Cache the preferred subtitle's display NAME once a dub's media (which
  // carries names) has landed, so the next cold load can paint the Subtitles
  // pill immediately instead of flashing the static "Subtitles" label while the
  // lazy media is in flight. Reads the persisted PREFERRED slug (not the
  // per-video auto-resolved activeSubtitleSlug) so a video that lacks the
  // preferred language can never overwrite the cached name. Gated on
  // preferencesReady so it can't fire before hydration and clobber the stored
  // blob. subtitleNameToCache returns null (no-op) once the name is current, so
  // the effect self-terminates.
  useEffect(() => {
    if (!preferencesReady || !preferredSubtitleSlug || !activeVariantMedia)
      return
    const next = subtitleNameToCache(
      preferredSubtitleSlug,
      activeVariantMedia.subtitles,
      preferredSubtitleName,
    )
    if (next != null) setPreferredSubtitleName(next)
  }, [
    preferencesReady,
    preferredSubtitleSlug,
    preferredSubtitleName,
    activeVariantMedia,
    setPreferredSubtitleName,
  ])

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
      preferredSubtitleName,
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
      preferredSubtitleName,
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
