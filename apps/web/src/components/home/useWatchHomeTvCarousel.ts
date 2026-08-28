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
  addWatchHomeVerticalVideoId,
  boundedRandomIndex,
  buildWatchHomeVideoQueue,
  markWatchHomeVideoPlayed,
  isWatchHomeHeroPlayableAspect,
  pickRandomWatchHomeHeroVideo,
  readWatchHomeTvPlayedIds,
  readWatchHomeVerticalVideoIds,
  resetWatchHomeTvPlayedIds,
  saveWatchHomeCurrentVideoSession,
  type WatchHomeCarouselSequenceData,
  type WatchHomeTvCarouselSlide,
  type WatchHomeTvCarouselVideoSlide,
} from "@/lib/watch-home-carousel-sequence"

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

/**
 * `<mux-video>` is a custom element wrapping a real `<video>`; depending on the
 * build it either forwards the media properties or only exposes them on the
 * inner element, so both are checked before giving up.
 */
export function readMediaVideoSize(
  media: HTMLVideoElement | null,
): { width: number; height: number } | null {
  if (!media) return null

  const host = media as unknown as HTMLElement
  const inner =
    (host.shadowRoot
      ?.querySelector("mux-video")
      ?.shadowRoot?.querySelector("video") as HTMLVideoElement | null) ??
    (host.shadowRoot?.querySelector("video") as HTMLVideoElement | null) ??
    null

  for (const candidate of [media, inner]) {
    const width = candidate?.videoWidth ?? 0
    const height = candidate?.videoHeight ?? 0
    if (width > 0 && height > 0) return { width, height }
  }

  return null
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
  options: {
    autoAdvancePausedForSlideId?: string | null
    randomSource?: () => number
    suppressLeavingSlide?: boolean
  } = {},
) {
  const hasHydrated = useSyncExternalStore(
    subscribeToHydrationStore,
    getClientHydrationSnapshot,
    getServerHydrationSnapshot,
  )
  const [prefetchedQueue, setPrefetchedQueue] = useState<{
    sequenceKey: string
    videos: WatchHomeTvCarouselVideoSlide[]
    nextPoolIndex: number
  } | null>(null)
  const [portraitSlideIds, setPortraitSlideIds] = useState<readonly string[]>(
    [],
  )
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
    if (videoQueue.length === 0) return null
    if (portraitSlideIds.length === 0) return videoQueue
    const portrait = new Set(portraitSlideIds)
    const landscape = videoQueue.filter((slide) => !portrait.has(slide.id))
    // Never empty the hero: if every queued video measured portrait, keep the
    // queue and let the bounded skip counter stop the churn.
    return landscape.length > 0 ? landscape : videoQueue
  }, [isSequenced, portraitSlideIds, sequence, videoQueue])

  const displaySlides = sequencedSlides ?? slides

  // Server render and the first client render must agree, so the sequenced
  // hero opens on the deterministic queue's first playable slide. The random
  // per-visit draw lands right after mount, once hydration can no longer break.
  const defaultActiveIndex = isSequenced
    ? firstPlayableIndex(displaySlides)
    : hasHydrated
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
  const randomSourceRef = useRef(options.randomSource ?? Math.random)
  const randomStartAppliedRef = useRef(false)
  const pendingRandomHeroIdRef = useRef<string | null>(null)
  const portraitSkipCountRef = useRef(0)
  // `advance` is defined below the metadata handler that needs it.
  const advanceRef = useRef<(() => void) | null>(null)

  // The homepage is statically rendered and shared by every visitor, so the
  // per-visit draw happens here — once, right after mount — over the pools the
  // server already shipped. No extra request, no extra server render.
  useEffect(() => {
    if (randomStartAppliedRef.current) return
    randomStartAppliedRef.current = true

    const random = randomSourceRef.current
    const playedIds = readWatchHomeTvPlayedIds()
    // Videos an earlier load measured as portrait are out of the draw entirely;
    // the hero is a wide frame and would crop them to a centre strip.
    // Not mirrored into state: the queue below is built with them excluded, so
    // a stored portrait video never reaches the slide list in the first place.
    const excludedIds = readWatchHomeVerticalVideoIds()

    if (isSequenced && sequence) {
      const hero = pickRandomWatchHomeHeroVideo({
        excludedIds,
        playedIds,
        pools: sequence.pools,
        random,
      })
      if (!hero) return

      const built = buildWatchHomeVideoQueue({
        pools: sequence.pools,
        existingVideos: [hero],
        excludedIds,
        startPoolIndex: boundedRandomIndex(sequence.pools.length, random),
        targetVideoCount: 7,
        randomSource: random,
      })

      pendingRandomHeroIdRef.current = hero.id
      setPrefetchedQueue({
        sequenceKey,
        videos: built.videos,
        nextPoolIndex: built.nextPoolIndex,
      })
      setActiveSlideId(hero.id)
      return
    }

    const excluded = new Set(excludedIds)
    const playable = displaySlides.filter(
      (slide) => Boolean(slide.src) && !excluded.has(slide.id),
    )
    const candidates = playable.length > 0 ? playable : displaySlides
    if (candidates.length === 0) return
    const played = new Set(playedIds)
    const unplayed = candidates.filter((slide) => !played.has(slide.id))
    const drawFrom = unplayed.length > 0 ? unplayed : candidates
    const hero = drawFrom[boundedRandomIndex(drawFrom.length, random)]
    if (!hero) return

    pendingRandomHeroIdRef.current = hero.id
    setActiveSlideId(hero.id)
  }, [displaySlides, isSequenced, sequence, sequenceKey])

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

  const selectIndex = useCallback(
    (index: number) => {
      if (index < 0 || index >= displaySlides.length) return
      const nextSlide = displaySlides[index] ?? null
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
      displaySlides,
      options.suppressLeavingSlide,
    ],
  )

  const selectSlide = useCallback(
    (slideId: string) => {
      const index = displaySlides.findIndex((slide) => slide.id === slideId)
      selectIndex(index)
    },
    [displaySlides, selectIndex],
  )

  const advance = useCallback(() => {
    const nextIndex = isSequenced
      ? safeActiveIndex + 1 < displaySlides.length
        ? safeActiveIndex + 1
        : 0
      : nextUnplayedWatchHomeTvCarouselIndex(safeActiveIndex, displaySlides)
    selectIndex(nextIndex)
  }, [displaySlides, isSequenced, safeActiveIndex, selectIndex])

  useEffect(() => {
    advanceRef.current = advance
  }, [advance])

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
  }, [activeSlide?.id])

  const handleLoadedMetadata = useCallback(() => {
    previousProgressRef.current = 0
    clearVideoPosterHold()
    setMediaReady(false)
    setPlaybackTime({ seconds: 0, slideId: activeSlide?.id ?? null })
    setProgress(0)

    // The decoded size is the first and only trustworthy orientation signal in
    // the pipeline, so the skip happens here rather than at draw time. Bounded
    // because a pool that is portrait all the way down must not skip forever.
    const slideId = activeSlide?.id
    const size = readMediaVideoSize(videoRef.current)
    if (
      !slideId ||
      !size ||
      isWatchHomeHeroPlayableAspect(size.width, size.height) ||
      portraitSkipCountRef.current >= displaySlides.length
    ) {
      return
    }

    portraitSkipCountRef.current += 1
    addWatchHomeVerticalVideoId(slideId)
    setPortraitSlideIds((current) =>
      current.includes(slideId) ? current : [...current, slideId],
    )
    advanceRef.current?.()
  }, [activeSlide?.id, clearVideoPosterHold, displaySlides.length, videoRef])

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
        void video.play().catch(() => undefined)
      }
      videoPosterHoldTimeoutRef.current = null
    }, VIDEO_POSTER_HOLD_MS)
  }, [clearVideoPosterHold])

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
    clearVideoPosterHold()
    // Between mount and the per-visit draw committing, the active slide is the
    // deterministic bootstrap slide nobody actually watched. Recording it would
    // permanently exclude that one video from every visitor's random draw.
    // Compared against the id we set rather than the resolved slide, so a
    // drawn id that fails to resolve cannot wedge play tracking off for the
    // rest of the session.
    const awaitingRandomHero =
      pendingRandomHeroIdRef.current != null &&
      activeSlideId !== pendingRandomHeroIdRef.current
    if (activeSlideId === pendingRandomHeroIdRef.current) {
      pendingRandomHeroIdRef.current = null
    }
    if (hasHydrated && !awaitingRandomHero) {
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
    activeSlideId,
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
      advance()
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
      advance,
      handleCanPlay,
      handleEnded: advance,
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
    }),
    [
      safeActiveIndex,
      activeSlide,
      advance,
      handleCanPlay,
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
