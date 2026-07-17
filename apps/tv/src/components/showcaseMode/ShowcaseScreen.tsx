/**
 * The showcase shell: resolves the reel queue, owns the timers and the R17 prefetch,
 * and projects reelState's phase onto components. All sequencing decisions belong to
 * the reducer — this file only turns events into dispatches and state into render.
 */

import { Image } from "expo-image"
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake"
import { useLocalSearchParams, useRouter } from "expo-router"
import { useCallback, useEffect, useReducer, useRef, useState } from "react"
import { AppState, StyleSheet, View } from "react-native"

import { useVideoPlayerContext } from "../../contexts/VideoPlayerContext"
import { useWatchPreferences } from "../../contexts/WatchPreferencesProvider"
import { useWatchHome } from "../../hooks/useWatchHome"
import { getApolloClient } from "../../lib/apolloClient"
import {
  addDatadogTiming,
  isDatadogProvisioned,
  reportDatadogAction,
} from "../../lib/datadog"
import { GET_WATCH_EXPERIENCE } from "../../lib/queries"
import {
  CHAPTER_CARD_DURATION_MS,
  INITIAL_REEL_STATE,
  INTERSTITIAL_DURATION_MS,
  STILLS_RE_RESOLVE_INTERVAL_MS,
  currentChapter,
  currentExcerpt,
  nextExcerpt,
  reelReducer,
  stillsPosters,
  type ReelEvent,
  type ReelState,
} from "../../lib/showcaseMode/reelState"
import { buildHopSchedule } from "../../lib/showcaseMode/hopSchedule"
import {
  buildFallbackChapters,
  parseShowcaseExperience,
  resolveExcerptStream,
  resolveShowcaseSource,
  showcaseExperienceCoreIds,
  type FetchShowcaseVideo,
  type ShowcaseExperienceOutcome,
  type ShowcaseSourceOutput,
} from "../../lib/showcaseMode/sourceResolution"
import {
  SHOWCASE_EXIT_ACTION,
  SHOWCASE_FIRST_FRAME_TIMING,
  SHOWCASE_SOURCE_PARAM,
  SHOWCASE_START_ACTION,
  createShowcaseOnceLatch,
  hasShowcaseStarted,
  resolveShowcaseExitReason,
  resolveShowcaseStartPath,
  resolveShowcaseStartSource,
} from "../../lib/showcaseMode/showcaseTelemetry"
import {
  logShowcaseFallback,
  logShowcaseParseDrops,
} from "../../lib/showcaseMode/logShowcaseFallback"
import { createShowcaseVideoFetcher } from "../../lib/showcaseMode/showcaseVideoQuery"
import { countDistinctLanguages } from "../../lib/showcaseMode/statLines"
import type {
  ShowcaseChapter,
  ShowcaseExcerpt,
  ShowcaseStream,
} from "../../lib/showcaseMode/types"
import {
  buildVideoByCoreIdIndex,
  type WatchHomeModel,
} from "../../lib/watchHome/model"
import {
  fetchTopUpVideos,
  type FetchPolicy,
} from "../../lib/watchHome/topUpFetch"
import { withTimeout } from "../../lib/withTimeout"
import { ScreenStateView } from "../ScreenStateView"
import { isAppStateForeground } from "../watch/videoBackdropGate"
import { WATCH_THEME } from "../watch/watchDetailTheme"
import { ChapterCard } from "./ChapterCard"
import { ExcerptChrome } from "./ExcerptChrome"
import { ReelPlayer } from "./ReelPlayer"
import { ShowcaseInput } from "./ShowcaseInput"
import { StatInterstitial } from "./StatInterstitial"
import { StillsSlideshow } from "./StillsSlideshow"

/** KTD-10: the curator authors the reel at this slug. */
export const SHOWCASE_EXPERIENCE_SLUG = "tv-showcase"

const SHOWCASE_LOCALE = "en"

/** Tag-scoped so no other consumer's deactivate can release the reel's claim. */
const SHOWCASE_KEEP_AWAKE_TAG = "showcase-mode"

/** A slow admin must degrade to the fallback reel fast — R17's ~5s budget. */
const EXPERIENCE_FETCH_DEADLINE_MS = 6000
const TOPUP_FETCH_DEADLINE_MS = 6000

type ResolveKind = "resolve" | "refresh"

// ── Queue resolution ────────────────────────────────────────────────

/**
 * Curated first, Home pool second, stills last (R5/R16). Never throws: every failure
 * is an outcome the ladder already knows how to answer.
 */
async function resolveShowcaseQueue(args: {
  model: WatchHomeModel | null
  fetchPolicy: FetchPolicy
}): Promise<ShowcaseSourceOutput> {
  const client = getApolloClient()
  let outcome: ShowcaseExperienceOutcome = "absent"
  let chapters: ShowcaseChapter[] = []
  let statLines: string[] = []

  try {
    const result = await withTimeout(
      client.query({
        query: GET_WATCH_EXPERIENCE,
        variables: { locale: SHOWCASE_LOCALE, slug: SHOWCASE_EXPERIENCE_SLUG },
        fetchPolicy: args.fetchPolicy,
      }),
      EXPERIENCE_FETCH_DEADLINE_MS,
    )
    const blocks = result.data?.experienceBySlug?.blocks
    if (blocks != null) {
      outcome = "present"
      const coreIds = showcaseExperienceCoreIds(blocks)
      // Bounded like its sibling above: R16 only degrades on a REPORTED failure, so
      // an unbounded hydration hang left the reel in `resolving` forever — a spinner
      // with the fallback reel and the stills floor both sitting unreachable.
      const videos =
        coreIds.length > 0
          ? await withTimeout(
              fetchTopUpVideos(client, coreIds, args.fetchPolicy),
              TOPUP_FETCH_DEADLINE_MS,
            )
          : []
      const parsed = parseShowcaseExperience(
        blocks,
        buildVideoByCoreIdIndex(videos),
      )
      chapters = parsed.chapters
      statLines = parsed.statLines
      // The curator authored these and they never reached a TV; nothing else tells
      // them, because their whole authoring surface is a title and a coreId.
      logShowcaseParseDrops(parsed.drops)
    }
  } catch {
    // Hydration failures land here too: either way the curated path yielded nothing.
    outcome = "error"
  }

  return resolveShowcaseSource({
    experienceOutcome: outcome,
    experienceChapters: chapters,
    experienceStatLines: statLines,
    fallbackChapters:
      args.model != null ? buildFallbackChapters({ model: args.model }) : [],
  })
}

// ── Screen ──────────────────────────────────────────────────────────

export function ShowcaseScreen() {
  const router = useRouter()
  // Query only — DatadogRouteTracker keys views off usePathname(), so the RUM view
  // stays `showcase` and the source rides the start action's context instead.
  const routeParams = useLocalSearchParams()
  const { setDecoderClaimed } = useVideoPlayerContext()
  const { model, loading: poolLoading } = useWatchHome()
  const { audioLanguageSlug } = useWatchPreferences()
  const [state, dispatch] = useReducer(reelReducer, INITIAL_REEL_STATE)
  const [stream, setStream] = useState<ShowcaseStream | null>(null)
  /** R9's live claim, for the video the reel is on. Null when it can't support one. */
  const [liveLanguageCount, setLiveLanguageCount] = useState<number | null>(
    null,
  )

  // Native emitters (U4's player listeners) fire outside React's commit, so every
  // gating read they make must come from a ref, never a render closure.
  const stateRef = useRef<ReelState>(state)
  const modelRef = useRef(model)
  const mountedRef = useRef(true)
  // Read live at excerpt-resolution time so a mid-reel language change applies from the
  // NEXT excerpt without restarting the current one (it stays out of the effect's deps).
  const audioLanguageSlugRef = useRef(audioLanguageSlug)
  const requestIdRef = useRef(0)

  // R15: one report each per mounted session. Latches rather than booleans, so a
  // genuine unmount re-arms them with the component instance and a re-run effect or
  // a double-delivered press cannot report twice.
  const firstFrameLatchRef = useRef(createShowcaseOnceLatch())
  const startLatchRef = useRef(createShowcaseOnceLatch())
  const exitLatchRef = useRef(createShowcaseOnceLatch())
  /** Set where the press is known — cleanup must not infer the reason from state. */
  const exitedViaPressRef = useRef(false)

  const reportExit = useCallback(() => {
    if (!exitLatchRef.current.claim()) return
    reportDatadogAction(SHOWCASE_EXIT_ACTION, {
      // AppState read live: a mirrored foreground flag is stale by construction
      // inside a remount cycle, and this decides at the instant it is asked.
      "showcase.reason": resolveShowcaseExitReason({
        exitedViaPress: exitedViaPressRef.current,
        appForeground: isAppStateForeground(AppState.currentState),
      }),
    })
  }, [])

  useEffect(() => {
    stateRef.current = state
  }, [state])

  useEffect(() => {
    modelRef.current = model
  }, [model])

  useEffect(() => {
    audioLanguageSlugRef.current = audioLanguageSlug
  }, [audioLanguageSlug])

  useEffect(() => {
    // Setup restores what cleanup mutates: StrictMode remounts this same hook
    // instance, and a ref left false would wedge every dispatch below.
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  // KTD-6: expo-video's keepScreenOnWhilePlaying only covers moments of ACTIVE
  // playback — chapter cards, interstitials, stills and swap gaps would let the
  // screensaver in during a 4h soak (R14/AE6). Screen-scoped, not player-scoped.
  useEffect(() => {
    let released = false
    activateKeepAwakeAsync(SHOWCASE_KEEP_AWAKE_TAG)
      .then(() => {
        // Unmount can beat this promise home; without the re-release the claim
        // outlives the session and the TV never sleeps again.
        if (released) {
          void deactivateKeepAwake(SHOWCASE_KEEP_AWAKE_TAG).catch(() => {})
        }
      })
      .catch(() => {
        // Best-effort: losing keep-awake costs a screensaver, not the reel.
      })
    return () => {
      released = true
      void deactivateKeepAwake(SHOWCASE_KEEP_AWAKE_TAG).catch(() => {})
    }
  }, [])

  // KTD-1: while this is held, /watch's backdrop and the Experience hero UNMOUNT
  // their VideoViews — a paused view still owns a tvOS decode slot. Setup restores
  // what cleanup mutates, so a StrictMode remount re-claims (R18 releases on exit).
  useEffect(() => {
    setDecoderClaimed(true)
    return () => setDecoderClaimed(false)
  }, [setDecoderClaimed])

  const runResolve = useCallback(
    async (kind: ResolveKind, fetchPolicy: FetchPolicy) => {
      const thisRequest = ++requestIdRef.current
      let output: ShowcaseSourceOutput
      try {
        output = await resolveShowcaseQueue({
          model: modelRef.current,
          fetchPolicy,
        })
      } catch {
        output = { kind: "stills", logs: [] }
      }
      // Emit before the stale-guard: a superseded resolve still degraded, and its
      // reason is exactly what an operator needs when the office TV looks wrong.
      for (const reason of output.logs) logShowcaseFallback({ reason })
      if (requestIdRef.current !== thisRequest || !mountedRef.current) return

      if (kind === "refresh") {
        dispatch(
          output.kind === "queue"
            ? { type: "queueRefreshed", queue: output.queue }
            : { type: "queueRefreshFailed" },
        )
        return
      }
      dispatch(
        output.kind === "queue"
          ? { type: "resolved", queue: output.queue }
          : { type: "resolveFailed" },
      )
    },
    [],
  )

  // Cold start. Waits for the Home pool to settle so an absent Experience still has
  // fallback content to compose from — otherwise AE1 would open on stills.
  const coldStartedRef = useRef(false)
  useEffect(() => {
    if (coldStartedRef.current) return
    if (model == null && poolLoading) return
    coldStartedRef.current = true
    void runResolve("resolve", "cache-first")
  }, [model, poolLoading, runResolve])

  // A late timer can only deliver an event the reducer's phase guard already
  // ignores, so these need no mounted check of their own.
  useEffect(() => {
    if (state.phase !== "chapterCard") return
    const timer = setTimeout(
      () => dispatch({ type: "cardTimerElapsed" }),
      CHAPTER_CARD_DURATION_MS,
    )
    return () => clearTimeout(timer)
  }, [state.phase, state.chapterIndex])

  useEffect(() => {
    if (state.phase !== "interstitial") return
    const timer = setTimeout(
      () => dispatch({ type: "interstitialTimerElapsed" }),
      INTERSTITIAL_DURATION_MS,
    )
    return () => clearTimeout(timer)
  }, [state.phase])

  // R16: stills re-attempt resolution on a slow beat rather than fast-skipping.
  useEffect(() => {
    if (state.phase !== "stills") return
    const timer = setInterval(() => {
      void runResolve("resolve", "network-only")
    }, STILLS_RE_RESOLVE_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [state.phase, runResolve])

  // R17's loop-boundary refresh. Fires once per idle→pending arming, which is the
  // only transition this dep can observe.
  useEffect(() => {
    if (state.refresh.status !== "pending") return
    void runResolve("refresh", "network-only")
  }, [state.refresh.status, runResolve])

  // R17: resolve the target excerpt's stream. Keyed on the token, which changes
  // exactly when the target does — including a one-item reel looping onto itself.
  const excerpt = currentExcerpt(state)
  const chapter = currentChapter(state)
  // KTD-5: the centerpiece is the marked chapter's first excerpt (U3). It plays as a
  // hop plan instead of an ordinary stream.
  const isCenterpieceExcerpt =
    excerpt != null &&
    chapter?.languageChapter?.centerpieceExcerptId === excerpt.id
  const inHopMode = state.hop != null
  useEffect(() => {
    if (excerpt == null) return
    // In hop mode the hop-projection effect owns the stream; this effect only resolves
    // ordinary excerpts and builds the centerpiece's one-time plan.
    if (inHopMode) return
    let cancelled = false
    const token = state.excerptToken
    const baseFetch = createShowcaseVideoFetcher(
      getApolloClient(),
      "cache-first",
    )
    // Decorate the seam rather than fetch twice: resolveExcerptStream keeps only the
    // chosen dub, and R9's live line needs the whole list's language count.
    let languageCount = 0
    const fetchVideo: FetchShowcaseVideo = async (slug) => {
      const video = await baseFetch(slug)
      languageCount = countDistinctLanguages(video?.dubs)
      return video
    }
    void (async () => {
      if (isCenterpieceExcerpt) {
        // Build the hop plan from the centerpiece's dubs. Math.random is injected HERE —
        // the screen is the composition root where nondeterminism lives; buildHopSchedule
        // stays pure. A null plan (too few languages / too short) falls through to play
        // the centerpiece as an ordinary excerpt (AE4/AE5 degradation).
        let video
        try {
          video = await fetchVideo(excerpt.slug)
        } catch {
          video = null
        }
        if (cancelled || !mountedRef.current) return
        const plan = buildHopSchedule({ dubs: video?.dubs, rng: Math.random })
        if (plan != null) {
          dispatch({ type: "hopPlanResolved", token, plan })
          return
        }
        // Fall through: the video is now cached, so resolveExcerptStream reuses it.
      }
      const resolved = await resolveExcerptStream({
        excerpt,
        // Ref, not a dep: a preference change mid-reel applies from the next excerpt.
        viewerLanguageSlug: audioLanguageSlugRef.current,
        fetchVideo,
      })
      if (cancelled || !mountedRef.current) return
      if (resolved == null) {
        setStream(null)
        setLiveLanguageCount(null)
        dispatch({ type: "excerptFailed" })
        return
      }
      setStream(resolved)
      setLiveLanguageCount(languageCount)
    })()
    return () => {
      cancelled = true
    }
  }, [excerpt, state.excerptToken, isCenterpieceExcerpt, inHopMode])

  // KTD-5: project the current hop onto the player as its next stream. Same footage,
  // a different dub — this is the ONE place the reel claims a language (claimsLanguage
  // true; ExcerptChrome shows nothing when a hop has no display name).
  useEffect(() => {
    const hop = state.hop
    if (hop == null) return
    const current = hop.hops[hop.index]
    if (current == null) return
    setStream({
      hls: current.hls,
      languageSlug: current.languageSlug,
      languageName: current.languageName,
      muxPlaybackId: current.muxPlaybackId,
      window: current.window,
      claimsLanguage: true,
    })
    setLiveLanguageCount(hop.hops.length)
  }, [state.hop])

  // R17: warm the next excerpt's stream choice AND its poster while the current one
  // plays. Data only — a second buffering player is the expo-video leak trigger
  // (KTD-3). The poster is what the swap dissolves onto, so a cold one would pop.
  const upcoming = nextExcerpt(state)
  useEffect(() => {
    if (upcoming == null || state.phase !== "excerpt") return
    const fetchVideo = createShowcaseVideoFetcher(
      getApolloClient(),
      "cache-first",
    )
    void fetchVideo(upcoming.slug).catch(() => {
      // A cold cache on arrival is the only cost of a failed warm.
    })
    if (upcoming.posterUrl != null) {
      void Image.prefetch(upcoming.posterUrl).catch(() => {
        // Uncached art still renders; it just arrives during the dissolve.
      })
    }
  }, [upcoming, state.phase])

  // R15: the first phase presenting content is also the first that can name the path
  // — `queue` is null until then, and a null queue IS the stills floor (R16).
  useEffect(() => {
    if (!hasShowcaseStarted(state.phase)) return
    if (!startLatchRef.current.claim()) return
    reportDatadogAction(SHOWCASE_START_ACTION, {
      "showcase.path": resolveShowcaseStartPath(state.queue),
      "showcase.source": resolveShowcaseStartSource(
        routeParams[SHOWCASE_SOURCE_PARAM],
      ),
    })
  }, [state.phase, state.queue, routeParams])

  // Covers the sessions no press ended: a deep link, a route change, or a teardown
  // while backgrounded (R18). Setup re-arms what cleanup claims, so a remount in
  // place cannot leave the real exit unreported.
  useEffect(() => {
    exitLatchRef.current = createShowcaseOnceLatch()
    return () => reportExit()
  }, [reportExit])

  // The reducer decides the exit; the screen only performs it. Deep links can land
  // here with no back stack, and R12 promises a way out from every state.
  useEffect(() => {
    if (state.phase !== "exited") return
    // Report BEFORE navigating: router.back() starts the next RUM view, and an
    // action emitted after it would land on the origin screen, not the showcase.
    reportExit()
    if (router.canGoBack()) router.back()
    else router.replace("/")
  }, [state.phase, router, reportExit])

  /**
   * The player emits from native, outside React's commit, so a callback can arrive
   * for an excerpt the reel already left (stale) or twice in one tick (Android
   * double-fire). Both would advance the reel past an unplayed item.
   */
  const consumedTokenRef = useRef(-1)
  const handleTerminal = useCallback((token: number, event: ReelEvent) => {
    if (!mountedRef.current) return
    if (stateRef.current.excerptToken !== token) return
    if (consumedTokenRef.current === token) return
    // Eager: React has not committed the dispatch below, so the ref is the only
    // thing a same-tick second emission can see.
    consumedTokenRef.current = token
    dispatch(event)
  }, [])

  const handleEnded = useCallback(
    (token: number) => handleTerminal(token, { type: "excerptEnded" }),
    [handleTerminal],
  )
  const handleFailed = useCallback(
    (token: number) => handleTerminal(token, { type: "excerptFailed" }),
    [handleTerminal],
  )
  const handlePlaying = useCallback((token: number) => {
    if (!mountedRef.current) return
    if (stateRef.current.excerptToken !== token) return
    // R17's ~5s budget, timed from the /showcase view the route tracker started.
    // Gate before latching (series pattern): an unprovisioned build never burns it.
    if (isDatadogProvisioned() && firstFrameLatchRef.current.claim()) {
      addDatadogTiming(SHOWCASE_FIRST_FRAME_TIMING)
    }
  }, [])

  // R12: a press must exit from every phase, including the resolving window, so this
  // is an unconditional sibling rather than one of OverlaySlot's branches.
  const handleExit = useCallback(() => {
    // Recorded here because this is the only place a press is known; the reducer
    // absorbs the duplicate dispatch, and re-recording the same reason is harmless.
    exitedViaPressRef.current = true
    dispatch({ type: "exit" })
  }, [])

  return (
    <View style={styles.screen}>
      <ReelPlayer
        stream={stream}
        posterUrl={excerpt?.posterUrl ?? null}
        excerptToken={state.excerptToken}
        // KTD-5: a hop past the opener is a same-footage continuation — mask its swap
        // with the dip over the live frame, not the poster. The opener (index 0) and
        // the exit past the centerpiece are ordinary poster-masked seams.
        hopSwap={state.hop != null && state.hop.index > 0}
        // Cards and interstitials keep the player loaded but silent, so the card
        // doubles as the next excerpt's buffer window instead of bleeding its audio.
        active={state.phase === "excerpt"}
        onPlaying={handlePlaying}
        onEnded={handleEnded}
        onFailed={handleFailed}
      />
      <ShowcaseInput onExit={handleExit} />
      <OverlaySlot
        state={state}
        chapter={chapter}
        excerpt={excerpt}
        stream={stream}
        liveLanguageCount={liveLanguageCount}
      />
    </View>
  )
}

// ── Overlays (U5) ───────────────────────────────────────────────────

type OverlaySlotProps = {
  state: ReelState
  chapter: ShowcaseChapter | null
  excerpt: ShowcaseExcerpt | null
  stream: ShowcaseStream | null
  liveLanguageCount: number | null
}

/** Every reel phase's presentation. A pure projection of state — no decisions here. */
function OverlaySlot({
  state,
  chapter,
  excerpt,
  stream,
  liveLanguageCount,
}: OverlaySlotProps) {
  switch (state.phase) {
    case "resolving":
      return <ScreenStateView kind="loading" />

    case "stills":
      return <StillsSlideshow posters={stillsPosters(state)} />

    case "chapterCard": {
      if (chapter == null) return null
      // The reducer skips excerpt-less chapters at runtime, so the dots count what
      // actually plays — the raw queue would promise chapters nobody reaches.
      const chapters = state.queue?.chapters ?? []
      const plays = (candidate: ShowcaseChapter) =>
        candidate.excerpts.length > 0
      return (
        <ChapterCard
          title={chapter.title}
          subtitle={chapter.subtitle}
          position={
            chapters.slice(0, state.chapterIndex).filter(plays).length + 1
          }
          total={chapters.filter(plays).length}
        />
      )
    }

    case "interstitial":
      return (
        <StatInterstitial
          authoredLines={state.queue?.statLines ?? []}
          liveTitle={excerpt?.title ?? null}
          liveLanguageCount={liveLanguageCount}
        />
      )

    case "excerpt":
      if (excerpt == null) return null
      return (
        <ExcerptChrome
          title={excerpt.title}
          feltNeed={chapter?.title ?? ""}
          languageName={stream?.languageName ?? null}
          // AE4 lives on the resolved stream; re-deriving it here would drift.
          claimsLanguage={stream?.claimsLanguage ?? false}
          excerptToken={state.excerptToken}
        />
      )

    case "exited":
      return null
  }
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: WATCH_THEME.below,
  },
})
