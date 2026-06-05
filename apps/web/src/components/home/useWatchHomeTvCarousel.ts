"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"

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
const IMAGE_SLIDE_ADVANCE_MS = 7000

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

export function useWatchHomeTvCarousel(
  slides: readonly WatchHomeTvCarouselSlide[],
) {
  const [activeIndex, setActiveIndex] = useState(() =>
    firstPlayableIndex(slides),
  )
  const [isMuted, setIsMuted] = useState(true)
  const [progress, setProgress] = useState(0)
  const isMutedRef = useRef(isMuted)
  const previousProgressRef = useRef(0)
  const imageSlideStartedAtRef = useRef<number | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)

  const safeActiveIndex =
    activeIndex < slides.length ? activeIndex : firstPlayableIndex(slides)
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
    selectIndex(nextWatchHomeTvCarouselIndex(safeActiveIndex, slides.length))
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
    const video = videoRef.current
    if (!video) return
    video.muted = isMutedRef.current
    video.currentTime = 0
  }, [activeSlide?.id])

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
