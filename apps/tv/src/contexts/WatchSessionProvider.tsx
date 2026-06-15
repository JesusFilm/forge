// SYNC: structural rewrite of apps/mobile/src/contexts/WatchSessionProvider.tsx
// — NOT a copy. Mobile is woven through useWatchPreferences (subtitleEnabled is
// sourced from it, both default-resolution effects gate on its preferencesReady,
// and the setters persist through it). TV v1 has no cross-restart persistence
// (WatchPreferencesProvider is deferred), so this port:
//   - holds `subtitleEnabled` as LOCAL useState,
//   - replaces the `preferencesReady` gate with `true` (no readiness gate),
//   - strips all persist calls from the setters,
//   - fills resolveDefaultSlug's preferred arg with the carried series-language
//     selection (U4) instead of mobile's persisted preference — null outside a
//     series lineage, so the default chain is unchanged there,
//   - drops mobile's snackbarMessage (Download is a QR handoff, no consumer).
//
// It is the single source of truth for the active dub + subtitle selection,
// shared by the details screen's pickers and the overlay's in-player menu
// across the screen ↔ fullscreen round trip (KTD2). It is INERT when
// `video == null`: the default-resolution effects and Apollo usage early-return,
// so screens that never call `setVideo` (experience-card playback) register zero
// effects/queries.

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

import {
  normalizeDubMedia,
  type VariantMedia,
  type WatchVideoRecord,
} from "../lib/normalizeVideo"
import { ensureDubMedia } from "../lib/dubMediaFetch"
import { GET_VIDEO_DUB } from "../lib/videoQueries"
import { getApolloClient } from "../lib/apolloClient"
import { useCarriedLanguageSlug } from "./SeriesLanguageContext"
import {
  resolveDefaultSubtitleSlug,
  resolveDefaultVariantIndex,
  selectActiveVariant,
  selectDubMediaState,
  type DubMediaState,
} from "./watchSessionState"

// Re-export the pure state helpers so consumers (and tests) have one surface.
export {
  clampVariantIndex,
  selectActiveVariant,
  resolveDefaultVariantIndex,
  resolveDefaultSubtitleSlug,
  selectDubMediaState,
  type DubMediaState,
} from "./watchSessionState"

// ── Context ────────────────────────────────────────────────────────────────

type WatchSessionContextValue = {
  video: WatchVideoRecord | null
  setVideo: (video: WatchVideoRecord | null) => void
  activeVariantIndex: number
  setActiveVariantIndex: (index: number) => void
  subtitleEnabled: boolean
  setSubtitleEnabled: (enabled: boolean) => void
  activeSubtitleSlug: string | null
  setActiveSubtitleSlug: (slug: string | null) => void
  /** Convenience: the variant currently selected (clamped), or null. */
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
   * Lets panels show a retry affordance instead of a misleading empty list.
   */
  activeVariantMediaError: boolean
  /**
   * The active dub's media as a single `{ media, loading, error }` struct —
   * the same value the flat fields above are destructured from. Panels feed
   * this straight into `deriveSubtitlePanelState` instead of rebuilding the
   * struct; the flat fields stay for the player hook that reads them.
   */
  activeVariantMediaState: DubMediaState
  /**
   * Fetch the active variant's downloads + subtitles if not already loaded /
   * in flight. Call when the Subtitle panel / in-player menu opens or captions
   * turn on. Deduped per dub id; a failed fetch is retried on the next call.
   */
  ensureActiveVariantMedia: () => void
}

const WatchSessionContext = createContext<WatchSessionContextValue | null>(null)

// Hard cap on the GET_VIDEO_DUB request so a hung admin can't wedge the loading
// state (and the dedupe-ledger slot) forever. Matches the 8 s VTT-fetch budget
// in SubtitleOverlay; per CLAUDE.md the outbound timeout must be shorter than
// the upstream caller's budget (Apollo's HttpLink fetch timeout). On expiry the
// race REJECTS so ensureDubMedia's onError path fires — releasing the slot and
// surfacing the error state instead of hanging.
const DUB_MEDIA_FETCH_TIMEOUT_MS = 8000

export function WatchSessionProvider({ children }: { children: ReactNode }) {
  // The active series screen's language selection (U4) — null when no series
  // screen is in the stack's lineage (or the provider isn't mounted, e.g. in
  // isolation). Feeds resolveDefaultVariantIndex's preferred-slug arg below so
  // an episode opened from a series starts in the language picked there.
  const carriedLanguageSlug = useCarriedLanguageSlug()

  const [video, setVideo] = useState<WatchVideoRecord | null>(null)
  const [activeVariantIndex, setActiveVariantIndexState] = useState(0)
  // Subtitles on/off: LOCAL state (no persisted store on TV v1). Off by default.
  const [subtitleEnabled, setSubtitleEnabledState] = useState(false)
  const [activeSubtitleSlug, setActiveSubtitleSlugState] = useState<
    string | null
  >(null)

  // Whether the user has explicitly chosen a variant / subtitle for the current
  // video. Guards the default-resolution effects from overriding a user's
  // choice when partial → full data enrichment republishes the same video.
  const userChoseVariantRef = useRef(false)
  const userChoseSubtitleRef = useRef(false)
  // The video / variant identity defaults were last resolved for, so the
  // resolution effects fire once per identity even though they also re-run when
  // variants arrive (partial data lands variants after the documentId).
  const resolvedVariantForRef = useRef<string | null>(null)
  const resolvedSubtitleForRef = useRef<string | null>(null)

  // Exposed setters mark explicit user intent so the resolution effects below
  // (which call the raw state setters) never trip these guards. No persistence
  // on TV v1 — selection lives in memory for the screen ↔ overlay round trip.
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

  const activeVariant = selectActiveVariant(video, activeVariantIndex)

  // Lazily-fetched per-dub media (downloads + subtitles), keyed by dub id so a
  // language the user already opened stays warm across switches and re-entry.
  // `requestedRef` dedupes in-flight + completed fetches; a failed one is
  // dropped from it so the next ensure() retries.
  const [mediaById, setMediaById] = useState<Record<string, VariantMedia>>({})
  const [loadingIds, setLoadingIds] = useState<Record<string, true>>({})
  const [errorIds, setErrorIds] = useState<Record<string, true>>({})
  const requestedRef = useRef<Set<string>>(new Set())

  const activeVariantId = activeVariant?.documentId ?? null
  // The active dub's media as a single struct. Exposed directly on the context
  // (`activeVariantMediaState`) for panels that feed it to deriveSubtitlePanelState,
  // and destructured into the flat fields the player hook still reads.
  // Memoized: selectDubMediaState returns a fresh object literal every call, and
  // this value feeds the context-value useMemo below — without a stable reference
  // here the context value changes on every provider render, re-rendering every
  // useWatchSession consumer even when the active dub's media is unchanged.
  const activeVariantMediaState = useMemo(
    () => selectDubMediaState(activeVariantId, mediaById, loadingIds, errorIds),
    [activeVariantId, mediaById, loadingIds, errorIds],
  )
  const {
    media: activeVariantMedia,
    loading: activeVariantMediaLoading,
    error: activeVariantMediaError,
  } = activeVariantMediaState

  const ensureActiveVariantMedia = useCallback(() => {
    // Inert when there is no active dub — no Apollo query fires.
    if (!activeVariant?.documentId) return
    ensureDubMedia(
      activeVariant.documentId,
      requestedRef.current,
      async (id) => {
        // Lazy client getter — never module-scope (apps/tv/CLAUDE.md).
        const queryPromise = getApolloClient().query({
          query: GET_VIDEO_DUB,
          variables: { id },
          // The dub is normalized by id; once fetched, re-opening the panel (or
          // switching back to this language) reads the warm cache, no refetch.
          fetchPolicy: "cache-first",
        })
        // Apollo's query() doesn't honor a per-call deadline, so race it against
        // a timeout that REJECTS — a hung admin then surfaces as an error (slot
        // released) instead of an indefinite spinner. The timer is unref-free
        // (RN has no unref) but the race settling lets it be GC'd.
        let timeoutId: ReturnType<typeof setTimeout> | undefined
        const timeoutPromise = new Promise<never>((_, reject) => {
          timeoutId = setTimeout(
            () => reject(new Error("dub_media_fetch_timeout")),
            DUB_MEDIA_FETCH_TIMEOUT_MS,
          )
        })
        try {
          const res = await Promise.race([queryPromise, timeoutPromise])
          return normalizeDubMedia(res.data?.videoDub ?? null)
        } finally {
          if (timeoutId !== undefined) clearTimeout(timeoutId)
        }
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
  }, [activeVariant?.documentId])

  // New video identity → reset choice tracking + per-video subtitle state and
  // drop the previous video's per-dub media + ledger. Declared before the
  // resolution effects so their guards see a clean slate. Dub ids are
  // per-video, so nothing is reused across videos — keeping the maps only grows
  // memory and lets a stale requestedRef entry wedge a dub into a no-op.
  useEffect(() => {
    userChoseVariantRef.current = false
    userChoseSubtitleRef.current = false
    resolvedVariantForRef.current = null
    resolvedSubtitleForRef.current = null
    setActiveSubtitleSlugState(null)
    setMediaById({})
    setLoadingIds({})
    setErrorIds({})
    requestedRef.current.clear()
  }, [video?.documentId])

  // Default the dubbing language once per video, as soon as variants are
  // available (they may arrive after the documentId via partial data), unless
  // the user already chose. INERT when no video. No readiness gate on TV (mobile
  // gated on preferencesReady; TV has no persisted store). Carried series
  // selection (U4 — null outside a series lineage) → device locale → video
  // primary → English → first; a carried slug with no matching dub falls
  // through the chain (soft preference, see resolveDefaultSlug).
  useEffect(() => {
    if (!video || video.variants.length === 0) return
    if (userChoseVariantRef.current) return
    if (resolvedVariantForRef.current === video.documentId) return
    resolvedVariantForRef.current = video.documentId
    setActiveVariantIndexState(
      resolveDefaultVariantIndex(video, carriedLanguageSlug),
    )
  }, [
    video?.documentId,
    video?.variants.length,
    video?.primaryLanguageBcp47,
    // Slug changes after this video resolved are no-ops (the ref guard above);
    // listed so the resolving run always reads a fresh value.
    carriedLanguageSlug,
  ])

  // Pre-select the subtitle language for the active variant once, unless the
  // user already chose. Subtitles arrive lazily, so this runs when the active
  // dub's media lands (keyed on the dub id), not at load. INERT when no video /
  // no active dub. Persisted preference (null on TV) → device → primary →
  // English → first.
  useEffect(() => {
    if (!video || !activeVariant) return
    const subtitles = activeVariantMedia?.subtitles
    if (!subtitles || subtitles.length === 0) return
    if (userChoseSubtitleRef.current) return
    if (resolvedSubtitleForRef.current === activeVariant.documentId) return
    resolvedSubtitleForRef.current = activeVariant.documentId
    const best = resolveDefaultSubtitleSlug(
      subtitles,
      video.primaryLanguageBcp47,
      null,
    )
    if (best) setActiveSubtitleSlugState(best)
  }, [
    activeVariant?.documentId,
    activeVariantMedia,
    video?.primaryLanguageBcp47,
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
      activeVariant,
      activeVariantMedia,
      activeVariantMediaLoading,
      activeVariantMediaError,
      activeVariantMediaState,
      ensureActiveVariantMedia,
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
      activeVariantMediaState,
      ensureActiveVariantMedia,
    ],
  )

  return (
    <WatchSessionContext.Provider value={value}>
      {children}
    </WatchSessionContext.Provider>
  )
}

export function useWatchSession(): WatchSessionContextValue {
  const ctx = useContext(WatchSessionContext)
  if (!ctx) {
    throw new Error("useWatchSession must be used within WatchSessionProvider")
  }
  return ctx
}
