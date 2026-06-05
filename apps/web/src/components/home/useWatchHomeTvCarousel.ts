"use client"

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"

export type WatchHomeTvCarouselSlide = {
  id: string
  title: string
  description: string | null
  label: string
  href: string | null
  posterUrl: string | null
  thumbnailUrl: string | null
  imageAlt: string
  src: string | null
  playbackId: string | null
}

export const WATCH_HOME_TV_ADVANCE_THRESHOLD = 95
export const WATCH_HOME_TV_PLAYED_IDS_STORAGE_KEY = "carousel-played-ids"
const IMAGE_SLIDE_ADVANCE_MS = 7000

type PlayedIdsStorageValue = {
  month?: unknown
  ids?: unknown
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

function currentStorageMonth() {
  return new Date().toISOString().slice(0, 7)
}

export function readWatchHomeTvPlayedIds(): string[] {
  if (typeof window === "undefined") return []

  try {
    const stored = localStorage.getItem(WATCH_HOME_TV_PLAYED_IDS_STORAGE_KEY)
    if (!stored) return []

    const data = JSON.parse(stored) as PlayedIdsStorageValue
    if (data.month !== currentStorageMonth()) {
      localStorage.removeItem(WATCH_HOME_TV_PLAYED_IDS_STORAGE_KEY)
      return []
    }

    return Array.isArray(data.ids)
      ? data.ids.filter((id): id is string => typeof id === "string")
      : []
  } catch {
    return []
  }
}

export function resetWatchHomeTvPlayedIds() {
  if (typeof window === "undefined") return

  try {
    localStorage.removeItem(WATCH_HOME_TV_PLAYED_IDS_STORAGE_KEY)
  } catch {
    // Ignore storage errors from private browsing or disabled storage.
  }
}

export function addWatchHomeTvPlayedId(slideId: string) {
  if (typeof window === "undefined") return

  try {
    const current = readWatchHomeTvPlayedIds()
    const ids = current.includes(slideId) ? current : [...current, slideId]
    localStorage.setItem(
      WATCH_HOME_TV_PLAYED_IDS_STORAGE_KEY,
      JSON.stringify({
        month: currentStorageMonth(),
        ids,
      }),
    )
  } catch {
    // Ignore storage errors from private browsing or disabled storage.
  }
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
) {
  const hasHydrated = useSyncExternalStore(
    subscribeToHydrationStore,
    getClientHydrationSnapshot,
    getServerHydrationSnapshot,
  )
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const [isMuted, setIsMuted] = useState(true)
  const [progress, setProgress] = useState(0)
  const isMutedRef = useRef(isMuted)
  const previousProgressRef = useRef(0)
  const imageSlideStartedAtRef = useRef<number | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)

  const defaultActiveIndex = hasHydrated
    ? firstUnplayedWatchHomeTvCarouselIndex(slides)
    : firstPlayableIndex(slides)
  const safeActiveIndex =
    activeIndex != null && activeIndex < slides.length
      ? activeIndex
      : defaultActiveIndex
  const activeSlide = slides[safeActiveIndex] ?? slides[0] ?? null

  const selectIndex = useCallback(
    (index: number) => {
      if (index < 0 || index >= slides.length) return
      imageSlideStartedAtRef.current = null
      previousProgressRef.current = 0
      setProgress(0)
      setActiveIndex(index)
    },
    [slides.length],
  )

  const selectSlide = useCallback(
    (slideId: string) => {
      const index = slides.findIndex((slide) => slide.id === slideId)
      selectIndex(index)
    },
    [selectIndex, slides],
  )

  const advance = useCallback(() => {
    selectIndex(nextUnplayedWatchHomeTvCarouselIndex(safeActiveIndex, slides))
  }, [safeActiveIndex, selectIndex, slides])

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
    if (hasHydrated && activeSlide?.id) addWatchHomeTvPlayedId(activeSlide.id)
    const video = videoRef.current
    if (!video) return
    video.muted = isMutedRef.current
    video.currentTime = 0
  }, [activeSlide?.id, hasHydrated])

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
      isMuted,
      progress,
      selectSlide,
      toggleMuted,
    ],
  )
}
