"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { WatchHomeCarouselSlide } from "@/lib/watch-home-carousel"

export const WATCH_HOME_ADVANCE_THRESHOLD = 95

export function nextWatchHomeCarouselIndex(
  currentIndex: number,
  slideCount: number,
) {
  if (slideCount <= 0) return 0
  return (currentIndex + 1) % slideCount
}

export function progressPercent(currentTime: number, duration: number) {
  if (!Number.isFinite(duration) || duration <= 0) return 0
  return Math.min(100, Math.max(0, (currentTime / duration) * 100))
}

export function shouldAutoAdvance(
  currentProgress: number,
  previousProgress: number,
  threshold = WATCH_HOME_ADVANCE_THRESHOLD,
) {
  return previousProgress < threshold && currentProgress >= threshold
}

function firstVideoIndex(slides: readonly WatchHomeCarouselSlide[]) {
  const index = slides.findIndex((slide) => slide.kind === "video")
  return index >= 0 ? index : 0
}

export function useWatchHomeCarousel(
  slides: readonly WatchHomeCarouselSlide[],
) {
  const [activeIndex, setActiveIndex] = useState(() => firstVideoIndex(slides))
  const [isMuted, setIsMuted] = useState(true)
  const [progress, setProgress] = useState(0)
  const isMutedRef = useRef(isMuted)
  const previousProgressRef = useRef(0)
  const videoRef = useRef<HTMLVideoElement | null>(null)

  const safeActiveIndex =
    activeIndex < slides.length ? activeIndex : firstVideoIndex(slides)
  const activeSlide = slides[safeActiveIndex] ?? slides[0] ?? null

  const selectIndex = useCallback(
    (index: number) => {
      if (index < 0 || index >= slides.length) return
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
    selectIndex(nextWatchHomeCarouselIndex(safeActiveIndex, slides.length))
  }, [safeActiveIndex, selectIndex, slides.length])

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
    const nextProgress = progressPercent(video.currentTime, video.duration)
    setProgress(nextProgress)
    if (shouldAutoAdvance(nextProgress, previousProgressRef.current)) {
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
    previousProgressRef.current = 0
    const video = videoRef.current
    if (!video) return
    video.muted = isMutedRef.current
    video.currentTime = 0
  }, [activeSlide?.id])

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
