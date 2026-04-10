"use client"

import { useEffect, useRef } from "react"
import Hls from "hls.js"

type VideoPlayerProps = {
  src: string
  onClose: () => void
}

export function VideoPlayer({ src, onClose }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      // Safari: native HLS
      video.src = src
      video.play()
      return
    }

    if (Hls.isSupported()) {
      const hls = new Hls()
      hls.loadSource(src)
      hls.attachMedia(video)
      hls.on(Hls.Events.MANIFEST_PARSED, () => video.play())
      return () => hls.destroy()
    }
  }, [src])

  return (
    <div className="relative w-full">
      <video
        ref={videoRef}
        controls
        autoPlay
        className="w-full rounded-lg"
        onClick={(e) => e.stopPropagation()}
      />
      <button
        type="button"
        onClick={onClose}
        className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-xs text-white hover:bg-black/80"
      >
        ✕
      </button>
    </div>
  )
}
