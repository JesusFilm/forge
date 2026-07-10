// SYNC: structural rewrite (NOT a copy) of apps/mobile's WatchSessionProvider. TV v1 has no persistence
// (subtitleEnabled local, no preferencesReady gate, setters don't persist, defaults use carried series slug U4,
// no snackbar). Single source of truth for active dub + subtitle; INERT when video == null.

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
   * Active variant's downloads + subtitles, lazily fetched via
   * {@link ensureActiveVariantMedia}. `null` until loaded — distinct from
   * "loaded, empty" (`{ downloads: [], subtitles: [] }`).
   */
  activeVariantMedia: VariantMedia | null
  /** True while the active variant's media request is in flight. */
  activeVariantMediaLoading: boolean
  /**
   * True when the active variant's media fetch failed (vs. loaded-but-empty),
   * so panels can show a retry affordance instead of a misleading empty list.
   */
  activeVariantMediaError: boolean
  /**
   * Active dub's media as one `{ media, loading, error }` struct (the source of
   * the flat fields above). Panels feed it straight into
   * `deriveSubtitlePanelState`; flat fields stay for the player hook.
   */
  activeVariantMediaState: DubMediaState
  /**
   * Fetch the active variant's media if not already loaded / in flight (on
   * panel/menu open or captions-on). Deduped per dub id; a failed fetch retries
   * on the next call.
   */
  ensureActiveVariantMedia: () => void
}

const WatchSessionContext = createContext<WatchSessionContextValue | null>(null)

// Hard cap on GET_VIDEO_DUB so a hung admin can't wedge the loading state +
// dedupe slot forever. Must stay shorter than the caller's budget (CLAUDE.md);
// on expiry the race REJECTS so ensureDubMedia's onError fires (slot released).
const DUB_MEDIA_FETCH_TIMEOUT_MS = 8000

export function WatchSessionProvider({ children }: { children: ReactNode }) {
  // Active series screen's language selection (U4; null outside a series lineage)
  // → feeds resolveDefaultVariantIndex's preferred-slug arg so an episode opened
  // from a series starts in the language picked there.
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

  // Lazily-fetched per-dub media keyed by dub id so an opened language stays
  // warm across switches/re-entry. requestedRef dedupes in-flight + completed
  // fetches; a failed one is dropped so the next ensure() retries.
  const [mediaById, setMediaById] = useState<Record<string, VariantMedia>>({})
  const [loadingIds, setLoadingIds] = useState<Record<string, true>>({})
  const [errorIds, setErrorIds] = useState<Record<string, true>>({})
  const requestedRef = useRef<Set<string>>(new Set())

  const activeVariantId = activeVariant?.documentId ?? null
  // Active dub's media as one struct (also destructured into the flat fields).
  // Memoized because selectDubMediaState returns a fresh literal each call —
  // without a stable ref it re-renders every consumer on every provider render.
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
        // Apollo's query() honors no per-call deadline, so race it against a
        // timeout that REJECTS — a hung admin surfaces as an error (slot
        // released), not an indefinite spinner. No unref on RN; race-settle GCs it.
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

  // New video identity → reset choice tracking + subtitle state, drop the prior
  // video's per-dub media + ledger (before resolution effects, for a clean slate).
  // Dub ids are per-video: stale entries waste memory + can wedge a dub into a no-op.
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

  // Default the dub language once per video as variants arrive (after documentId),
  // unless the user chose. INERT/no readiness gate on TV. Chain: carried slug (U4,
  // soft — no match falls through) → device → primary → English → first.
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

  // Pre-select the subtitle language once per active variant, unless the user
  // chose. Runs when the dub's media lands (lazy; keyed on dub id). INERT when no
  // video/dub. Chain: persisted (null on TV) → device → primary → English → first.
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
