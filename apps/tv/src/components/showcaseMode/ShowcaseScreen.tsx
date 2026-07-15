/**
 * The showcase shell: resolves the reel queue, owns the timers and the R17 prefetch,
 * and projects reelState's phase onto components. All sequencing decisions belong to
 * the reducer — this file only turns events into dispatches and state into render.
 */

import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake"
import { useRouter } from "expo-router"
import { useCallback, useEffect, useReducer, useRef, useState } from "react"
import { StyleSheet, Text, View } from "react-native"

import { useVideoPlayerContext } from "../../contexts/VideoPlayerContext"
import { useWatchHome } from "../../hooks/useWatchHome"
import { getApolloClient } from "../../lib/apolloClient"
import { GET_WATCH_EXPERIENCE } from "../../lib/queries"
import { initialRotationState } from "../../lib/showcaseMode/languageRotation"
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
import {
  buildFallbackChapters,
  parseShowcaseExperience,
  resolveExcerptStream,
  resolveShowcaseSource,
  showcaseExperienceCoreIds,
  type ShowcaseExperienceOutcome,
  type ShowcaseSourceOutput,
} from "../../lib/showcaseMode/sourceResolution"
import { createShowcaseVideoFetcher } from "../../lib/showcaseMode/showcaseVideoQuery"
import type {
  ShowcaseChapter,
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
import { WATCH_THEME } from "../watch/watchDetailTheme"
import { ReelPlayer } from "./ReelPlayer"

/** KTD-10: the curator authors the reel at this slug. */
export const SHOWCASE_EXPERIENCE_SLUG = "tv-showcase"

const SHOWCASE_LOCALE = "en"

/** Tag-scoped so no other consumer's deactivate can release the reel's claim. */
const SHOWCASE_KEEP_AWAKE_TAG = "showcase-mode"

/** A slow admin must degrade to the fallback reel fast — R17's ~5s budget. */
const EXPERIENCE_FETCH_DEADLINE_MS = 6000

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
      const videos =
        coreIds.length > 0
          ? await fetchTopUpVideos(client, coreIds, args.fetchPolicy)
          : []
      const parsed = parseShowcaseExperience(
        blocks,
        buildVideoByCoreIdIndex(videos),
      )
      chapters = parsed.chapters
      statLines = parsed.statLines
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
  const { setDecoderClaimed } = useVideoPlayerContext()
  const { model, loading: poolLoading } = useWatchHome()
  const [state, dispatch] = useReducer(reelReducer, INITIAL_REEL_STATE)
  const [stream, setStream] = useState<ShowcaseStream | null>(null)

  // Native emitters (U4's player listeners) fire outside React's commit, so every
  // gating read they make must come from a ref, never a render closure.
  const stateRef = useRef<ReelState>(state)
  const modelRef = useRef(model)
  const mountedRef = useRef(true)
  const rotationRef = useRef(initialRotationState)
  const requestIdRef = useRef(0)

  useEffect(() => {
    stateRef.current = state
  }, [state])

  useEffect(() => {
    modelRef.current = model
  }, [model])

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
  const isFirstOfChapter = state.excerptIndex === 0
  useEffect(() => {
    if (excerpt == null) return
    let cancelled = false
    const fetchVideo = createShowcaseVideoFetcher(
      getApolloClient(),
      "cache-first",
    )
    void (async () => {
      const resolved = await resolveExcerptStream({
        excerpt,
        // R7 scopes language rotation to the chapter, so entry resets it.
        rotation: isFirstOfChapter ? initialRotationState : rotationRef.current,
        fetchVideo,
      })
      if (cancelled || !mountedRef.current) return
      if (resolved == null) {
        setStream(null)
        dispatch({ type: "excerptFailed" })
        return
      }
      rotationRef.current = resolved.rotation
      setStream(resolved.stream)
    })()
    return () => {
      cancelled = true
    }
  }, [excerpt, isFirstOfChapter, state.excerptToken])

  // R17: warm the next excerpt's stream choice while the current one plays. Data
  // only — a second buffering player is the expo-video leak trigger (KTD-3).
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
  }, [upcoming, state.phase])

  // The reducer decides the exit; the screen only performs it. Deep links can land
  // here with no back stack, and R12 promises a way out from every state.
  useEffect(() => {
    if (state.phase !== "exited") return
    if (router.canGoBack()) router.back()
    else router.replace("/")
  }, [state.phase, router])

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
    dispatch({ type: "excerptPlaying" })
  }, [])

  const chapter = currentChapter(state)

  return (
    <View style={styles.screen}>
      <ReelPlayer
        stream={stream}
        posterUrl={excerpt?.posterUrl ?? null}
        excerptToken={state.excerptToken}
        // Cards and interstitials keep the player loaded but silent, so the card
        // doubles as the next excerpt's buffer window instead of bleeding its audio.
        active={state.phase === "excerpt"}
        onPlaying={handlePlaying}
        onEnded={handleEnded}
        onFailed={handleFailed}
      />
      <OverlaySlot
        state={state}
        chapterTitle={chapter?.title ?? ""}
        chapterSubtitle={chapter?.subtitle ?? null}
      />
    </View>
  )
}

// ── Slots owned by sibling units ────────────────────────────────────
// U5 replaces OverlaySlot with ChapterCard / ExcerptChrome / StatInterstitial /
// StillsSlideshow.

type OverlaySlotProps = {
  state: ReelState
  chapterTitle: string
  chapterSubtitle: string | null
}

function OverlaySlot({ state, chapterTitle }: OverlaySlotProps) {
  if (state.phase === "resolving") {
    return <ScreenStateView kind="loading" />
  }
  if (state.phase === "stills") {
    return (
      <View style={styles.overlay}>
        <Text style={styles.slotText}>
          {stillsPosters(state).length} stills
        </Text>
      </View>
    )
  }
  if (state.phase === "chapterCard" || state.phase === "interstitial") {
    return (
      <View style={styles.overlay}>
        <Text style={styles.slotText}>{chapterTitle}</Text>
      </View>
    )
  }
  return null
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: WATCH_THEME.below,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  slotText: {
    fontFamily: "System",
    fontSize: Math.round(48),
    fontWeight: "700",
    color: WATCH_THEME.text,
  },
})
