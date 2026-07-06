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
  markWatchHomeVideoPlayed,
  mergeWatchHomeMuxInserts,
  readWatchHomeTvPlayedIds,
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
    const mergedSlides = mergeWatchHomeMuxInserts(
      videoQueue,
      sequence.muxInserts,
      undefined,
      { useStoredSelections: false },
    )
    return mergedSlides.length > 0 ? mergedSlides : null
  }, [isSequenced, sequence, videoQueue])

  const displaySlides = sequencedSlides ?? slides

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
  const safeActiveIndex = activeSlide
    ? Math.max(
        0,
        displaySlides.findIndex((slide) => slide.id === activeSlide.id),
      )
    : 0

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
      if (activeSlide && nextSlide?.id !== activeSlide.id) {
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
      void video.play().catch(() => undefined)
      videoPosterHoldTimeoutRef.current = null
    }, VIDEO_POSTER_HOLD_MS)
  }, [clearVideoPosterHold])

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
    if (hasHydrated) {
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
    clearVideoPosterHold,
    hasHydrated,
    isSequenced,
  ])

  useEffect(() => {
    if (!activeSlide) return

    clearSlideAdvanceTimeout()
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
    if (!activeSlide || activeSlide.src) return

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
  }, [activeSlide])

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
