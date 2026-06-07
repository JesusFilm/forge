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
  loadWatchHomeCurrentVideoSession,
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
  if (!Number.isFinite(duration) || duration <= 0) return 0
  return Math.min(100, Math.max(0, (currentTime / duration) * 100))
}

export function shouldAdvanceWatchHomeTvCarousel(
  currentProgress: number,
  previousProgress: number,
  threshold = WATCH_HOME_TV_ADVANCE_THRESHOLD,
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
  const [activeSlideId, setActiveSlideId] = useState<string | null>(null)
  const [prefetchedQueue, setPrefetchedQueue] = useState<{
    sequenceKey: string
    videos: WatchHomeTvCarouselVideoSlide[]
    nextPoolIndex: number
  } | null>(null)
  const [isMuted, setIsMuted] = useState(true)
  const [progress, setProgress] = useState(0)
  const isMutedRef = useRef(isMuted)
  const previousProgressRef = useRef(0)
  const imageSlideStartedAtRef = useRef<number | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const isSequenced = hasHydrated && sequence != null
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

    const session = loadWatchHomeCurrentVideoSession()
    return buildWatchHomeVideoQueue({
      pools: sequence.pools,
      startPoolIndex: session?.poolIndex ?? 0,
      targetVideoCount: 7,
    })
  }, [isSequenced, sequence])
  const activePrefetchedQueue =
    prefetchedQueue?.sequenceKey === sequenceKey ? prefetchedQueue : null
  const videoQueue = activePrefetchedQueue?.videos ?? initialQueue.videos
  const nextPoolIndex =
    activePrefetchedQueue?.nextPoolIndex ?? initialQueue.nextPoolIndex

  const sequencedSlides = useMemo(() => {
    if (!isSequenced || videoQueue.length === 0 || !sequence) return null
    return mergeWatchHomeMuxInserts(videoQueue, sequence.muxInserts)
  }, [isSequenced, sequence, videoQueue])

  const displaySlides = sequencedSlides ?? slides

  const defaultActiveIndex = hasHydrated
    ? firstUnplayedWatchHomeTvCarouselIndex(displaySlides)
    : firstPlayableIndex(displaySlides)
  const activeSlide =
    (activeSlideId != null
      ? displaySlides.find((slide) => slide.id === activeSlideId)
      : null) ??
    displaySlides[defaultActiveIndex] ??
    displaySlides[0] ??
    null
  const safeActiveIndex = activeSlide
    ? Math.max(
        0,
        displaySlides.findIndex((slide) => slide.id === activeSlide.id),
      )
    : 0

  const selectIndex = useCallback(
    (index: number) => {
      if (index < 0 || index >= displaySlides.length) return
      imageSlideStartedAtRef.current = null
      previousProgressRef.current = 0
      setProgress(0)
      setActiveSlideId(displaySlides[index]?.id ?? null)
    },
    [displaySlides],
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
      video.currentTime,
      video.duration,
    )
    setProgress(nextProgress)
    if (
      shouldAdvanceWatchHomeTvCarousel(
        nextProgress,
        previousProgressRef.current,
      )
    ) {
      previousProgressRef.current = nextProgress
      advance()
      return
    }
    previousProgressRef.current = nextProgress
  }, [advance])

  const handleLoadedMetadata = useCallback(() => {
    previousProgressRef.current = 0
    setProgress(0)
  }, [])

  const handleCanPlay = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    video.muted = isMutedRef.current
    void video.play().catch(() => undefined)
  }, [])

  useEffect(() => {
    isMutedRef.current = isMuted
    const video = videoRef.current
    if (video) video.muted = isMuted
  }, [isMuted])

  useEffect(() => {
    imageSlideStartedAtRef.current = null
    previousProgressRef.current = 0
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
  }, [activeSlide, activeSlide?.id, hasHydrated, isSequenced])

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
      if (nextProgress >= 100) {
        advance()
        return
      }
      animationFrame = requestAnimationFrame(tick)
    }

    animationFrame = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(animationFrame)
    }
  }, [activeSlide, advance])

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
      progress,
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
      progress,
      selectSlide,
      toggleMuted,
    ],
  )
}
