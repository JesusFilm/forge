"use client"

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
import {
  WATCH_HOME_TV_ADVANCE_THRESHOLD,
  WATCH_HOME_TV_PLAYED_IDS_STORAGE_KEY,
  addWatchHomeTvPlayedId,
  buildWatchHomeVideoQueue,
  createWatchHomeProgramEngine,
  drawNextWatchHomeProgramItem,
  exposeWatchHomeProgramIdentity,
  markWatchHomeVideoPlayed,
  mergeWatchHomeMuxInserts,
  persistWatchHomeProgramLedger,
  quarantineWatchHomeProgramIdentity,
  readWatchHomeProgramLedger,
  readWatchHomeTvPlayedIds,
  resetWatchHomeTvPlayedIds,
  saveWatchHomeCurrentVideoSession,
  type WatchHomeCarouselSequenceData,
  type WatchHomeProgramEngineState,
  type WatchHomeProgramSelection,
  type WatchHomeTvCarouselSlide,
  type WatchHomeTvCarouselVideoSlide,
} from "@/lib/watch-home-carousel-sequence"
import type { WatchHomeProgram } from "@/lib/watch-home-types"
import {
  getWatchProgressRatio,
  useWatchProgressEntries,
  type WatchProgressEntry,
} from "@/lib/watch-progress-client"

export {
  WATCH_HOME_TV_ADVANCE_THRESHOLD,
  WATCH_HOME_TV_PLAYED_IDS_STORAGE_KEY,
  addWatchHomeTvPlayedId,
  readWatchHomeTvPlayedIds,
  resetWatchHomeTvPlayedIds,
}
export type { WatchHomeCarouselSequenceData, WatchHomeTvCarouselSlide }

const IMAGE_SLIDE_ADVANCE_MS = 7000
const VIDEO_POSTER_HOLD_MS = 1500
const VIDEO_POSTER_HOLD_SECONDS = VIDEO_POSTER_HOLD_MS / 1000
const VIDEO_POSTER_HOLD_PROGRESS_TICK_MS = 250
export const WATCH_HOME_TV_VIDEO_PREVIEW_MAX_SECONDS = 30
export const WATCH_HOME_PROGRAM_EXPOSURE_SECONDS = 3
const WATCH_HOME_PROGRAM_MAX_SAMPLE_DELTA_SECONDS = 2

type WatchHomeProgrammedSlide = {
  selection: WatchHomeProgramSelection
  slide: WatchHomeTvCarouselSlide
  stateAfter: WatchHomeProgramEngineState
}

type WatchHomeProgramSession = {
  items: WatchHomeProgrammedSlide[]
  state: WatchHomeProgramEngineState
  fallback: boolean
}

type WatchHomeAdvanceCause =
  | "ended"
  | "preview-cap"
  | "explicit-skip"
  | "rail"
  | "failure"

export function getWatchHomeAccountSeenVideoIds(
  entries: readonly WatchProgressEntry[],
) {
  return [
    ...new Set(
      entries
        .filter((entry) => getWatchProgressRatio(entry) > 0)
        .map((entry) => entry.videoId),
    ),
  ]
}

export function watchHomeProgramSelectionToCarouselSlide(
  selection: WatchHomeProgramSelection,
): WatchHomeTvCarouselSlide {
  if (selection.kind === "video") {
    return {
      kind: "video",
      id: selection.sequenceId,
      videoId: selection.item.videoId,
      programIdentity: selection.identity,
      programIsIntro: false,
      title: selection.item.title,
      description: selection.item.description,
      label: selection.item.label,
      href: selection.item.href,
      posterUrl: selection.item.posterUrl,
      thumbnailUrl: selection.item.thumbnailUrl,
      imageAlt: selection.item.imageAlt,
      src: selection.item.src,
      playbackId: selection.item.playbackId,
      subtitleVttSrc: selection.item.subtitleVttSrc,
      subtitleLanguageBcp47: selection.item.subtitleLanguageBcp47,
      durationSeconds: selection.item.durationSeconds,
    }
  }

  return {
    kind: "promo",
    id: selection.sequenceId,
    programIdentity: selection.identity,
    programIsIntro: selection.isIntro,
    title: selection.item.title,
    description: selection.item.description,
    label: selection.item.label,
    href: null,
    primaryAction: selection.item.primaryAction,
    secondaryAction: selection.item.secondaryAction,
    posterUrl: selection.item.posterUrl,
    thumbnailUrl: selection.item.posterUrl,
    src: selection.item.src,
    playbackId: selection.item.playbackId,
    durationSeconds: selection.item.durationSeconds,
    logo: selection.item.showLogo,
  }
}

export function accumulateWatchHomeProgramPlayback({
  accumulatedSeconds,
  currentTime,
  previousTime,
  isPlaying,
  isVisible,
}: {
  accumulatedSeconds: number
  currentTime: number
  previousTime: number
  isPlaying: boolean
  isVisible: boolean
}) {
  const rawDelta = currentTime - previousTime
  const delta =
    isPlaying && isVisible && Number.isFinite(rawDelta) && rawDelta > 0
      ? Math.min(rawDelta, WATCH_HOME_PROGRAM_MAX_SAMPLE_DELTA_SECONDS)
      : 0
  const nextSeconds = Math.min(
    WATCH_HOME_PROGRAM_EXPOSURE_SECONDS,
    accumulatedSeconds + delta,
  )
  return {
    accumulatedSeconds: nextSeconds,
    exposed: nextSeconds >= WATCH_HOME_PROGRAM_EXPOSURE_SECONDS,
  }
}

function drawWatchHomeProgramHorizon(
  program: WatchHomeProgram,
  initialState: WatchHomeProgramEngineState,
  targetCount: number,
) {
  let state = initialState
  const items: WatchHomeProgrammedSlide[] = []
  let fallback = false

  while (items.length < targetCount) {
    const result = drawNextWatchHomeProgramItem(program, state)
    state = result.state
    if (!result.item) {
      fallback = result.fallback
      break
    }
    items.push({
      selection: result.item,
      slide: watchHomeProgramSelectionToCarouselSlide(result.item),
      stateAfter: result.state,
    })
  }

  return { items, state, fallback }
}

function reconcileWatchHomeProgramState(
  base: WatchHomeProgramEngineState,
  current: WatchHomeProgramEngineState,
  accountVideoIds: readonly string[],
): WatchHomeProgramEngineState {
  return {
    ...base,
    accountVideoIds: [...accountVideoIds],
    exposedIdentities: [...current.exposedIdentities],
    quarantinedIdentities: [...current.quarantinedIdentities],
  }
}

function subscribeToHydrationStore() {
  return () => undefined
}

function getClientHydrationSnapshot() {
  return true
}

function getServerHydrationSnapshot() {
  return false
}

export function nextWatchHomeTvCarouselIndex(
  currentIndex: number,
  slideCount: number,
) {
  if (slideCount <= 0) return 0
  return (currentIndex + 1) % slideCount
}

export function watchHomeTvProgressPercent(
  currentTime: number,
  duration: number,
) {
  const targetSeconds = watchHomeTvAdvanceTargetSeconds(duration)
  if (targetSeconds <= 0) return 0
  return Math.min(100, Math.max(0, (currentTime / targetSeconds) * 100))
}

export function watchHomeTvAdvanceTargetSeconds(
  duration: number,
  threshold = WATCH_HOME_TV_ADVANCE_THRESHOLD,
  maxSeconds = WATCH_HOME_TV_VIDEO_PREVIEW_MAX_SECONDS,
) {
  if (!Number.isFinite(duration) || duration <= 0) return maxSeconds
  return Math.min(maxSeconds, duration * (threshold / 100))
}

export function shouldAdvanceWatchHomeTvCarousel(
  currentProgress: number,
  previousProgress: number,
  threshold = 100,
) {
  return previousProgress < threshold && currentProgress >= threshold
}

function firstPlayableIndex(slides: readonly WatchHomeTvCarouselSlide[]) {
  const index = slides.findIndex((slide) => Boolean(slide.src))
  return index >= 0 ? index : 0
}

function playableSlideIndexes(slides: readonly WatchHomeTvCarouselSlide[]) {
  const indexes = slides
    .map((slide, index) => (slide.src ? index : -1))
    .filter((index) => index >= 0)

  return indexes.length > 0 ? indexes : slides.map((_, index) => index)
}

export function firstUnplayedWatchHomeTvCarouselIndex(
  slides: readonly WatchHomeTvCarouselSlide[],
) {
  if (slides.length === 0) return 0

  const played = new Set(readWatchHomeTvPlayedIds())
  const candidateIndexes = playableSlideIndexes(slides)
  const unplayedIndex = candidateIndexes.find(
    (index) => !played.has(slides[index].id),
  )

  if (unplayedIndex != null) return unplayedIndex

  resetWatchHomeTvPlayedIds()
  return candidateIndexes[0] ?? 0
}

export function nextUnplayedWatchHomeTvCarouselIndex(
  currentIndex: number,
  slides: readonly WatchHomeTvCarouselSlide[],
) {
  if (slides.length <= 0) return 0

  const candidateIndexes = playableSlideIndexes(slides)
  const candidateSet = new Set(candidateIndexes)
  const played = new Set(readWatchHomeTvPlayedIds())

  for (let offset = 1; offset <= slides.length; offset++) {
    const index = (currentIndex + offset) % slides.length
    if (!candidateSet.has(index)) continue
    if (!played.has(slides[index].id)) return index
  }

  resetWatchHomeTvPlayedIds()

  for (let offset = 1; offset <= slides.length; offset++) {
    const index = (currentIndex + offset) % slides.length
    if (candidateSet.has(index)) return index
  }

  return nextWatchHomeTvCarouselIndex(currentIndex, slides.length)
}

export function useWatchHomeTvCarousel(
  slides: readonly WatchHomeTvCarouselSlide[],
  sequence: WatchHomeCarouselSequenceData | null = null,
  program: WatchHomeProgram | null = null,
  options: {
    autoAdvancePausedForSlideId?: string | null
    suppressLeavingSlide?: boolean
  } = {},
) {
  const hasHydrated = useSyncExternalStore(
    subscribeToHydrationStore,
    getClientHydrationSnapshot,
    getServerHydrationSnapshot,
  )
  const watchProgressEntries = useWatchProgressEntries()
  const accountVideoIds = useMemo(
    () => getWatchHomeAccountSeenVideoIds(watchProgressEntries),
    [watchProgressEntries],
  )
  const accountVideoIdsKey = accountVideoIds.join("\u0000")
  const accountVideoIdsRef = useRef(accountVideoIds)
  useEffect(() => {
    accountVideoIdsRef.current = accountVideoIds
  }, [accountVideoIds])
  const [programEntryGeneration, setProgramEntryGeneration] = useState(0)
  const [programSession, setProgramSessionState] =
    useState<WatchHomeProgramSession | null>(null)
  const programSessionRef = useRef<WatchHomeProgramSession | null>(null)
  const initializedProgramEntryRef = useRef<{
    program: WatchHomeProgram
    generation: number
  } | null>(null)
  const setProgramSession = useCallback(
    (next: WatchHomeProgramSession | null) => {
      programSessionRef.current = next
      setProgramSessionState(next)
    },
    [],
  )
  const [prefetchedQueue, setPrefetchedQueue] = useState<{
    sequenceKey: string
    videos: WatchHomeTvCarouselVideoSlide[]
    nextPoolIndex: number
  } | null>(null)
  const [isMuted, setIsMuted] = useState(true)
  const [progress, setProgress] = useState(0)
  const [playbackTime, setPlaybackTime] = useState<{
    seconds: number
    slideId: string | null
  }>({ seconds: 0, slideId: null })
  const [leavingSlide, setLeavingSlide] =
    useState<WatchHomeTvCarouselSlide | null>(null)
  const [mediaReady, setMediaReady] = useState(false)
  const isMutedRef = useRef(isMuted)
  const leavingSlideTimeoutRef = useRef<number | null>(null)
  const slideAdvanceTimeoutRef = useRef<number | null>(null)
  const videoPosterHoldIntervalRef = useRef<number | null>(null)
  const videoPosterHoldTimeoutRef = useRef<number | null>(null)
  const previousProgressRef = useRef(0)
  const imageSlideStartedAtRef = useRef<number | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const heroRef = useRef<HTMLElement | null>(null)
  const heroVisibleRef = useRef(true)
  const advancedSlideIdRef = useRef<string | null>(null)
  const playbackExposureRef = useRef({
    slideId: null as string | null,
    previousTime: 0,
    accumulatedSeconds: 0,
  })
  const isSequenced = sequence != null
  const sequenceKey = useMemo(
    () =>
      sequence
        ? sequence.pools
            .map(
              (pool) =>
                `${pool.id}:${pool.videos.map((video) => video.id).join(",")}`,
            )
            .join("|")
        : "fallback",
    [sequence],
  )
  const initialQueue = useMemo(() => {
    if (!isSequenced || !sequence) {
      return { videos: [], nextPoolIndex: 0 }
    }

    return buildWatchHomeVideoQueue({
      pools: sequence.pools,
      startPoolIndex: 0,
      targetVideoCount: 7,
      useStoredProgress: false,
    })
  }, [isSequenced, sequence])
  const activePrefetchedQueue =
    prefetchedQueue?.sequenceKey === sequenceKey ? prefetchedQueue : null
  const videoQueue = activePrefetchedQueue?.videos ?? initialQueue.videos
  const nextPoolIndex =
    activePrefetchedQueue?.nextPoolIndex ?? initialQueue.nextPoolIndex

  const sequencedSlides = useMemo(() => {
    if (!isSequenced || !sequence) return null
    const mergedSlides = mergeWatchHomeMuxInserts(
      videoQueue,
      sequence.muxInserts,
      undefined,
      { useStoredSelections: false },
    )
    return mergedSlides.length > 0 ? mergedSlides : null
  }, [isSequenced, sequence, videoQueue])

  const legacySlides = useMemo(
    () => sequencedSlides ?? slides,
    [sequencedSlides, slides],
  )
  const programSlides = useMemo(
    () => programSession?.items.map((item) => item.slide) ?? [],
    [programSession],
  )
  const programIsActive =
    hasHydrated && program != null && programSlides.length > 0
  const displaySlides = useMemo(
    () =>
      programIsActive
        ? [...programSlides, ...(programSession?.fallback ? legacySlides : [])]
        : legacySlides,
    [legacySlides, programIsActive, programSession?.fallback, programSlides],
  )

  const defaultActiveIndex = hasHydrated
    ? firstUnplayedWatchHomeTvCarouselIndex(displaySlides)
    : firstPlayableIndex(displaySlides)
  const [activeSlideId, setActiveSlideId] = useState<string | null>(null)

  const selectedActiveSlide =
    activeSlideId != null
      ? displaySlides.find((slide) => slide.id === activeSlideId)
      : null
  const activeSlide =
    selectedActiveSlide ??
    displaySlides[defaultActiveIndex] ??
    displaySlides[0] ??
    null
  const autoAdvancePaused =
    activeSlide != null &&
    activeSlide.id === options.autoAdvancePausedForSlideId
  const safeActiveIndex = activeSlide
    ? Math.max(
        0,
        displaySlides.findIndex((slide) => slide.id === activeSlide.id),
      )
    : 0
  const autoAdvancePausedRef = useRef(autoAdvancePaused)

  useEffect(() => {
    let cancelled = false
    queueMicrotask(() => {
      if (cancelled) return
      if (!hasHydrated || !program) {
        initializedProgramEntryRef.current = null
        setProgramSession(null)
        return
      }
      if (
        initializedProgramEntryRef.current?.program === program &&
        initializedProgramEntryRef.current.generation === programEntryGeneration
      ) {
        return
      }
      initializedProgramEntryRef.current = {
        program,
        generation: programEntryGeneration,
      }

      const engine = createWatchHomeProgramEngine(program, {
        ledger: readWatchHomeProgramLedger(program),
        accountVideoIds: accountVideoIdsRef.current,
      })
      const horizon = drawWatchHomeProgramHorizon(program, engine, 2)
      setProgramSession(horizon)
      persistWatchHomeProgramLedger(program, horizon.state)
      setActiveSlideId(null)
    })
    return () => {
      cancelled = true
    }
  }, [hasHydrated, program, programEntryGeneration, setProgramSession])

  useEffect(() => {
    if (!program) return
    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted) setProgramEntryGeneration((value) => value + 1)
    }
    window.addEventListener("pageshow", handlePageShow)
    return () => window.removeEventListener("pageshow", handlePageShow)
  }, [program])

  const previousAccountVideoIdsKeyRef = useRef(accountVideoIdsKey)
  useEffect(() => {
    if (previousAccountVideoIdsKeyRef.current === accountVideoIdsKey) return
    previousAccountVideoIdsKeyRef.current = accountVideoIdsKey
    const current = programSessionRef.current
    if (!program || !current || current.items.length === 0) return

    const activeIndex = current.items.findIndex(
      (item) => item.slide.id === activeSlide?.id,
    )
    if (activeIndex < 0) return
    const retained = current.items.slice(0, activeIndex + 1)
    const base = reconcileWatchHomeProgramState(
      retained[retained.length - 1]!.stateAfter,
      current.state,
      accountVideoIds,
    )
    const future = drawWatchHomeProgramHorizon(program, base, 1)
    const next = {
      items: [...retained, ...future.items],
      state: future.state,
      fallback: future.fallback,
    }
    setProgramSession(next)
    persistWatchHomeProgramLedger(program, next.state)
  }, [
    accountVideoIds,
    accountVideoIdsKey,
    activeSlide?.id,
    program,
    setProgramSession,
  ])

  useEffect(() => {
    const element = heroRef.current
    if (!element || typeof IntersectionObserver === "undefined") {
      heroVisibleRef.current = true
      return
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        heroVisibleRef.current = Boolean(entry?.isIntersecting)
      },
      { threshold: 0.01 },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [programEntryGeneration])

  const clearVideoPosterHold = useCallback(() => {
    if (videoPosterHoldTimeoutRef.current != null) {
      window.clearTimeout(videoPosterHoldTimeoutRef.current)
      videoPosterHoldTimeoutRef.current = null
    }
    if (videoPosterHoldIntervalRef.current != null) {
      window.clearInterval(videoPosterHoldIntervalRef.current)
      videoPosterHoldIntervalRef.current = null
    }
  }, [])

  const clearSlideAdvanceTimeout = useCallback(() => {
    if (slideAdvanceTimeoutRef.current != null) {
      window.clearTimeout(slideAdvanceTimeoutRef.current)
      slideAdvanceTimeoutRef.current = null
    }
  }, [])

  const selectResolvedSlide = useCallback(
    (nextSlide: WatchHomeTvCarouselSlide | null) => {
      if (!nextSlide) return
      if (
        activeSlide &&
        nextSlide?.id !== activeSlide.id &&
        options.suppressLeavingSlide !== true
      ) {
        if (leavingSlideTimeoutRef.current != null) {
          window.clearTimeout(leavingSlideTimeoutRef.current)
        }
        setLeavingSlide(activeSlide)
        leavingSlideTimeoutRef.current = window.setTimeout(() => {
          setLeavingSlide(null)
          leavingSlideTimeoutRef.current = null
        }, 900)
      }
      imageSlideStartedAtRef.current = null
      previousProgressRef.current = 0
      clearSlideAdvanceTimeout()
      clearVideoPosterHold()
      setProgress(0)
      setMediaReady(false)
      setPlaybackTime({ seconds: 0, slideId: nextSlide?.id ?? null })
      setActiveSlideId(nextSlide?.id ?? null)
    },
    [
      activeSlide,
      clearSlideAdvanceTimeout,
      clearVideoPosterHold,
      options.suppressLeavingSlide,
    ],
  )

  const selectIndex = useCallback(
    (index: number) => {
      if (index < 0 || index >= displaySlides.length) return
      selectResolvedSlide(displaySlides[index] ?? null)
    },
    [displaySlides, selectResolvedSlide],
  )

  const selectSlide = useCallback(
    (slideId: string) => {
      const current = programSessionRef.current
      const programIndex = current?.items.findIndex(
        (item) => item.slide.id === slideId,
      )
      if (current && programIndex != null && programIndex > 0) {
        setProgramSession({
          ...current,
          items: current.items.slice(programIndex),
        })
      }
      const index = displaySlides.findIndex((slide) => slide.id === slideId)
      selectIndex(index)
    },
    [displaySlides, selectIndex, setProgramSession],
  )

  const recordProgramExposure = useCallback(
    (slide: WatchHomeTvCarouselSlide | null) => {
      if (
        !program ||
        !slide?.programIdentity ||
        slide.programIsIntro === true
      ) {
        return
      }
      const current = programSessionRef.current
      if (
        !current ||
        current.state.exposedIdentities.includes(slide.programIdentity)
      ) {
        return
      }
      const nextState = exposeWatchHomeProgramIdentity(
        current.state,
        slide.programIdentity,
      )
      const activeIndex = current.items.findIndex(
        (item) => item.slide.id === slide.id,
      )
      if (activeIndex < 0) return
      const retained = current.items.slice(0, activeIndex + 1)
      const base = reconcileWatchHomeProgramState(
        retained[retained.length - 1]!.stateAfter,
        nextState,
        accountVideoIdsRef.current,
      )
      const future = drawWatchHomeProgramHorizon(program, base, 1)
      const next = {
        items: [...retained, ...future.items],
        state: future.state,
        fallback: future.fallback,
      }
      setProgramSession(next)
      persistWatchHomeProgramLedger(program, next.state)
    },
    [program, setProgramSession],
  )

  const advance = useCallback(
    (cause: WatchHomeAdvanceCause = "explicit-skip") => {
      if (!activeSlide) return
      if (advancedSlideIdRef.current === activeSlide.id) return
      advancedSlideIdRef.current = activeSlide.id

      if (cause === "explicit-skip") {
        recordProgramExposure(activeSlide)
      }

      const current = programSessionRef.current
      const programIndex = current?.items.findIndex(
        (item) => item.slide.id === activeSlide.id,
      )
      if (program && current && programIndex != null && programIndex >= 0) {
        let workingSession = current
        let nextItem = current.items[programIndex + 1]
        if (!nextItem && !current.fallback) {
          const future = drawWatchHomeProgramHorizon(program, current.state, 1)
          workingSession = {
            items: [...current.items, ...future.items],
            state: future.state,
            fallback: future.fallback,
          }
          persistWatchHomeProgramLedger(program, workingSession.state)
          nextItem = future.items[0]
        }
        if (nextItem) {
          const nextIndex = workingSession.items.findIndex(
            (item) => item.slide.id === nextItem?.slide.id,
          )
          setProgramSession({
            ...workingSession,
            items: workingSession.items.slice(Math.max(0, nextIndex)),
          })
          selectResolvedSlide(nextItem.slide)
          return
        }
        if (current.fallback || programSessionRef.current?.fallback) {
          setProgramSession(null)
          selectResolvedSlide(legacySlides[0] ?? null)
          return
        }
      }

      const nextIndex = isSequenced
        ? safeActiveIndex + 1 < displaySlides.length
          ? safeActiveIndex + 1
          : 0
        : nextUnplayedWatchHomeTvCarouselIndex(safeActiveIndex, displaySlides)
      selectIndex(nextIndex)
    },
    [
      activeSlide,
      displaySlides,
      isSequenced,
      legacySlides,
      program,
      recordProgramExposure,
      safeActiveIndex,
      selectIndex,
      selectResolvedSlide,
      setProgramSession,
    ],
  )

  const handleProgramFailure = useCallback(() => {
    if (!activeSlide || advancedSlideIdRef.current === activeSlide.id) return
    const current = programSessionRef.current
    const activeIndex = current?.items.findIndex(
      (item) => item.slide.id === activeSlide.id,
    )
    if (!program || !current || activeIndex == null || activeIndex < 0) {
      advance("failure")
      return
    }

    advancedSlideIdRef.current = activeSlide.id
    const retained = current.items.slice(0, activeIndex)
    let base = reconcileWatchHomeProgramState(
      current.items[activeIndex]!.stateAfter,
      current.state,
      accountVideoIdsRef.current,
    )
    if (activeSlide.programIdentity && activeSlide.programIsIntro !== true) {
      base = quarantineWatchHomeProgramIdentity(
        base,
        activeSlide.programIdentity,
      )
    }
    const future = drawWatchHomeProgramHorizon(program, base, 1)
    persistWatchHomeProgramLedger(program, future.state)
    if (future.fallback && future.items.length === 0) {
      setProgramSession(null)
    } else {
      setProgramSession({
        items: [...retained, ...future.items],
        state: future.state,
        fallback: future.fallback,
      })
    }
    selectResolvedSlide(future.items[0]?.slide ?? legacySlides[0] ?? null)
  }, [
    activeSlide,
    advance,
    legacySlides,
    program,
    selectResolvedSlide,
    setProgramSession,
  ])

  const handleEnded = useCallback(() => {
    if (activeSlide?.kind === "promo") {
      recordProgramExposure(activeSlide)
    }
    advance("ended")
  }, [activeSlide, advance, recordProgramExposure])

  const toggleMuted = useCallback(() => {
    setIsMuted((current) => {
      const next = !current
      const video = videoRef.current
      if (video) video.muted = next
      return next
    })
  }, [])

  const handleTimeUpdate = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    const nextProgress = watchHomeTvProgressPercent(
      video.currentTime + VIDEO_POSTER_HOLD_SECONDS,
      video.duration,
    )
    setPlaybackTime({
      seconds: video.currentTime,
      slideId: activeSlide?.id ?? null,
    })
    setProgress(nextProgress)
    previousProgressRef.current = nextProgress

    if (!activeSlide?.programIdentity || activeSlide.programIsIntro === true) {
      return
    }
    const previous = playbackExposureRef.current
    const previousTime =
      previous.slideId === activeSlide.id ? previous.previousTime : 0
    const accumulatedSeconds =
      previous.slideId === activeSlide.id ? previous.accumulatedSeconds : 0
    const sample = accumulateWatchHomeProgramPlayback({
      accumulatedSeconds,
      currentTime: video.currentTime,
      previousTime,
      isPlaying: !video.paused,
      isVisible:
        document.visibilityState === "visible" && heroVisibleRef.current,
    })
    playbackExposureRef.current = {
      slideId: activeSlide.id,
      previousTime: video.currentTime,
      accumulatedSeconds: sample.accumulatedSeconds,
    }
    if (sample.exposed) recordProgramExposure(activeSlide)
  }, [activeSlide, recordProgramExposure])

  const handleLoadedMetadata = useCallback(() => {
    previousProgressRef.current = 0
    clearVideoPosterHold()
    setMediaReady(false)
    setPlaybackTime({ seconds: 0, slideId: activeSlide?.id ?? null })
    setProgress(0)
  }, [activeSlide?.id, clearVideoPosterHold])

  const handleCanPlay = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    video.muted = isMutedRef.current
    clearVideoPosterHold()

    let startedAt: number | null = null

    function tick() {
      const currentVideo = videoRef.current
      if (!currentVideo) return
      const now = performance.now()
      if (startedAt == null) startedAt = now

      const elapsedSeconds = (now - startedAt) / 1000
      const nextProgress = watchHomeTvProgressPercent(
        elapsedSeconds,
        currentVideo.duration,
      )
      setProgress(nextProgress)
      previousProgressRef.current = nextProgress
    }

    tick()
    videoPosterHoldIntervalRef.current = window.setInterval(
      tick,
      VIDEO_POSTER_HOLD_PROGRESS_TICK_MS,
    )
    videoPosterHoldTimeoutRef.current = window.setTimeout(() => {
      if (videoPosterHoldIntervalRef.current != null) {
        window.clearInterval(videoPosterHoldIntervalRef.current)
        videoPosterHoldIntervalRef.current = null
      }
      const nextProgress = watchHomeTvProgressPercent(
        VIDEO_POSTER_HOLD_SECONDS,
        video.duration,
      )
      setProgress(nextProgress)
      previousProgressRef.current = nextProgress
      setMediaReady(true)
      if (!autoAdvancePausedRef.current) {
        void video.play().catch(handleProgramFailure)
      }
      videoPosterHoldTimeoutRef.current = null
    }, VIDEO_POSTER_HOLD_MS)
  }, [clearVideoPosterHold, handleProgramFailure])

  useEffect(() => {
    autoAdvancePausedRef.current = autoAdvancePaused
  }, [autoAdvancePaused])

  useEffect(() => {
    isMutedRef.current = isMuted
    const video = videoRef.current
    if (video) video.muted = isMuted
  }, [isMuted])

  useEffect(() => {
    return () => {
      if (leavingSlideTimeoutRef.current != null) {
        window.clearTimeout(leavingSlideTimeoutRef.current)
      }
      if (slideAdvanceTimeoutRef.current != null) {
        window.clearTimeout(slideAdvanceTimeoutRef.current)
      }
      if (videoPosterHoldTimeoutRef.current != null) {
        window.clearTimeout(videoPosterHoldTimeoutRef.current)
      }
      if (videoPosterHoldIntervalRef.current != null) {
        window.clearInterval(videoPosterHoldIntervalRef.current)
      }
    }
  }, [])

  useEffect(() => {
    imageSlideStartedAtRef.current = null
    previousProgressRef.current = 0
    advancedSlideIdRef.current = null
    playbackExposureRef.current = {
      slideId: activeSlide?.id ?? null,
      previousTime: 0,
      accumulatedSeconds: 0,
    }
    clearVideoPosterHold()
    if (hasHydrated && !activeSlide?.programIdentity) {
      if (isSequenced) {
        markWatchHomeVideoPlayed(activeSlide)
        saveWatchHomeCurrentVideoSession(activeSlide)
      } else if (activeSlide?.id) {
        addWatchHomeTvPlayedId(activeSlide.id)
      }
    }
    const video = videoRef.current
    if (!video) return
    video.muted = isMutedRef.current
    video.currentTime = 0
  }, [
    activeSlide,
    activeSlide?.id,
    activeSlide?.programIdentity,
    clearVideoPosterHold,
    hasHydrated,
    isSequenced,
  ])

  useEffect(() => {
    if (!activeSlide) return

    clearSlideAdvanceTimeout()
    if (autoAdvancePaused) return undefined

    const advanceAfterMs = activeSlide.src
      ? watchHomeTvAdvanceTargetSeconds(
          activeSlide.durationSeconds ?? Number.NaN,
        ) * 1000
      : IMAGE_SLIDE_ADVANCE_MS

    slideAdvanceTimeoutRef.current = window.setTimeout(() => {
      slideAdvanceTimeoutRef.current = null
      advance("preview-cap")
    }, advanceAfterMs)

    return () => {
      clearSlideAdvanceTimeout()
    }
  }, [
    activeSlide,
    activeSlide?.durationSeconds,
    activeSlide?.id,
    activeSlide?.src,
    advance,
    autoAdvancePaused,
    clearSlideAdvanceTimeout,
  ])

  useEffect(() => {
    if (!isSequenced || !sequence || videoQueue.length === 0) return
    const activeVideoIndex =
      activeSlide?.kind === "video"
        ? videoQueue.findIndex((video) => video.id === activeSlide.id)
        : -1
    const targetVideoCount =
      videoQueue.length < 7
        ? 7
        : activeVideoIndex >= 0
          ? activeVideoIndex + 2
          : videoQueue.length

    if (targetVideoCount <= videoQueue.length) return

    const built = buildWatchHomeVideoQueue({
      pools: sequence.pools,
      existingVideos: videoQueue,
      startPoolIndex: nextPoolIndex,
      targetVideoCount,
    })
    if (built.videos.length === videoQueue.length) return

    const timeout = window.setTimeout(() => {
      setPrefetchedQueue({
        sequenceKey,
        videos: built.videos,
        nextPoolIndex: built.nextPoolIndex,
      })
    }, 0)

    return () => {
      window.clearTimeout(timeout)
    }
  }, [
    activeSlide,
    isSequenced,
    nextPoolIndex,
    sequence,
    sequenceKey,
    videoQueue,
  ])

  useEffect(() => {
    const current = programSessionRef.current
    if (!program || !current || current.fallback || !activeSlide) return
    const activeIndex = current.items.findIndex(
      (item) => item.slide.id === activeSlide.id,
    )
    if (activeIndex < 0 || activeIndex + 1 < current.items.length) return

    const future = drawWatchHomeProgramHorizon(program, current.state, 1)
    const next = {
      items: [...current.items, ...future.items],
      state: future.state,
      fallback: future.fallback,
    }
    setProgramSession(next)
    persistWatchHomeProgramLedger(program, next.state)
  }, [activeSlide, program, setProgramSession])

  useEffect(() => {
    if (!activeSlide || activeSlide.src || autoAdvancePaused) return

    let animationFrame = 0

    function tick(now: number) {
      if (imageSlideStartedAtRef.current == null) {
        imageSlideStartedAtRef.current = now
      }
      const elapsed = now - imageSlideStartedAtRef.current
      const nextProgress = Math.min(
        100,
        (elapsed / IMAGE_SLIDE_ADVANCE_MS) * 100,
      )
      setProgress(nextProgress)
      animationFrame = requestAnimationFrame(tick)
    }

    animationFrame = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(animationFrame)
    }
  }, [activeSlide, autoAdvancePaused])

  return useMemo(
    () => ({
      activeIndex: safeActiveIndex,
      activeSlide,
      advance: () => advance("explicit-skip"),
      handleCanPlay,
      handleEnded,
      handleError: handleProgramFailure,
      handleLoadedMetadata,
      handleTimeUpdate,
      isMuted,
      leavingSlide,
      mediaReady,
      progress,
      playbackTimeSeconds:
        playbackTime.slideId === activeSlide?.id ? playbackTime.seconds : 0,
      selectSlide,
      slides: displaySlides,
      toggleMuted,
      videoRef,
      heroRef,
    }),
    [
      safeActiveIndex,
      activeSlide,
      advance,
      handleCanPlay,
      handleEnded,
      handleProgramFailure,
      handleLoadedMetadata,
      handleTimeUpdate,
      displaySlides,
      isMuted,
      leavingSlide,
      mediaReady,
      playbackTime,
      progress,
      selectSlide,
      toggleMuted,
    ],
  )
}
