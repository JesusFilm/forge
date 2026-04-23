"use client"

import { useEffect, useId, useRef, useState } from "react"
import Hls from "hls.js"

import {
  registerPlayer,
  touchPlayer,
  unregisterPlayer,
} from "@/lib/lazy-video/registry"

type VideoPlayerProps = {
  src: string
  onClose: () => void
  poster?: string
  /**
   * When true, the player should start as soon as media is ready after an
   * explicit user action that mounted the component.
   */
  playOnMount?: boolean
  /**
   * When true, the player will attempt to autoplay (muted) as soon as
   * it enters the viewport. Only VideoHero should pass this — every
   * other consumer must require a user tap to kick off playback.
   */
  autoplayOnViewport?: boolean
}

export function VideoPlayer({
  src,
  onClose,
  poster,
  playOnMount = false,
  autoplayOnViewport = false,
}: VideoPlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  // Stable unique id for the LRU registry — scoped to this mounted
  // VideoPlayer instance. Including `src` keeps it unique across
  // re-mounts with a new source.
  const reactId = useId()
  const registryId = `${reactId}:${src}`

  // Gate HLS init behind IntersectionObserver. Starts false; flips to
  // true the first time the container enters the viewport (with 400px
  // of slop so we start fetching the manifest just before the user
  // scrolls to the video).
  const [initialized, setInitialized] = useState(false)

  // Watch the viewport: set `initialized = true` on first intersection.
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    if (initialized) return

    if (typeof IntersectionObserver === "undefined") {
      // SSR / old browser fallback: just init immediately.
      setInitialized(true)
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setInitialized(true)
            observer.disconnect()
            break
          }
        }
      },
      { rootMargin: "400px" },
    )
    observer.observe(container)

    return () => observer.disconnect()
  }, [initialized])

  // Attach HLS once we're initialized. The <video> element is always
  // in the DOM (so the poster renders immediately), but we don't pay
  // the cost of a MediaSource + segment parser until needed.
  useEffect(() => {
    if (!initialized) return

    const video = videoRef.current
    if (!video) return
    const shouldStartWhenReady = playOnMount || autoplayOnViewport

    let hls: Hls | null = null
    let cleanedUp = false

    const destroy = () => {
      if (cleanedUp) return
      cleanedUp = true
      if (hls) {
        try {
          hls.destroy()
        } catch {
          // Already torn down.
        }
        hls = null
      }
      // Stop any in-flight native HLS playback.
      try {
        video.pause()
        video.removeAttribute("src")
        video.load()
      } catch {
        // Ignore — element may already be detached.
      }
    }

    // Register with the LRU registry. If this pushes us past the cap,
    // the oldest other player gets evicted (its destroy() is called).
    registerPlayer(registryId, destroy)

    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      // Safari: native HLS, no hls.js needed.
      video.src = src
      if (shouldStartWhenReady) {
        video.play().catch(() => {})
      }
    } else if (Hls.isSupported()) {
      hls = new Hls()
      hls.loadSource(src)
      hls.attachMedia(video)
      if (shouldStartWhenReady) {
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          video.play().catch(() => {})
        })
      }
    }

    return () => {
      unregisterPlayer(registryId)
      destroy()
    }
  }, [initialized, src, playOnMount, autoplayOnViewport, registryId])

  // Bump LRU recency on user interaction so that whichever player the
  // user is actively watching doesn't get evicted by a newly scrolled-
  // in sibling.
  useEffect(() => {
    if (!initialized) return

    const video = videoRef.current
    if (!video) return

    const bump = () => touchPlayer(registryId)
    video.addEventListener("play", bump)
    video.addEventListener("pause", bump)
    video.addEventListener("seeking", bump)

    return () => {
      video.removeEventListener("play", bump)
      video.removeEventListener("pause", bump)
      video.removeEventListener("seeking", bump)
    }
  }, [initialized, registryId])

  return (
    <div
      ref={containerRef}
      className="relative aspect-video w-full overflow-hidden rounded-lg bg-black"
    >
      <video
        ref={videoRef}
        controls
        autoPlay={playOnMount || autoplayOnViewport}
        playsInline
        preload="none"
        poster={poster}
        className="absolute inset-0 h-full w-full object-contain"
        onClick={(e) => e.stopPropagation()}
      />
      <button
        type="button"
        onClick={onClose}
        className="absolute right-2 top-2 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-xs text-white hover:bg-black/80"
      >
        {"✕"}
      </button>
    </div>
  )
}
