"use client"

import { useEffect, useRef, useState } from "react"
import type { MuxPlayerRef } from "@forge/video-player"

import { getWebVttCueText } from "@/lib/webvtt"

import { FORGE_SUBTITLE_TRACK_LABEL } from "./subtitle-track"

const CHROME_BAR_HEIGHT = 64

export function SubtitleOverlay({
  playerRef,
  wrapperRef,
  player,
  controlsVisible,
}: {
  playerRef: React.RefObject<MuxPlayerRef | null>
  wrapperRef: React.RefObject<HTMLDivElement | null>
  player: MuxPlayerRef | null
  controlsVisible: boolean
}) {
  const [cueText, setCueText] = useState<string | null>(null)
  const [bottomOffset, setBottomOffset] = useState(16)
  const [playbackCommitted, setPlaybackCommitted] = useState(false)
  const listenerRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    const wrapper = wrapperRef.current
    if (!wrapper) return
    setPlaybackCommitted(
      wrapper.getAttribute("data-chrome-revealed") === "true",
    )
    const observer = new MutationObserver(() => {
      setPlaybackCommitted(
        wrapper.getAttribute("data-chrome-revealed") === "true",
      )
    })
    observer.observe(wrapper, {
      attributes: true,
      attributeFilter: ["data-chrome-revealed"],
    })
    return () => observer.disconnect()
  }, [wrapperRef])

  useEffect(() => {
    const wrapper = wrapperRef.current
    if (!wrapper) return

    let bodyZoneRef: HTMLElement | null = null
    let ticking = false
    const update = () => {
      if (!bodyZoneRef) {
        bodyZoneRef = document.querySelector(
          '[data-testid="watch-body-zone"]',
        ) as HTMLElement | null
      }
      const heroRect = wrapper.getBoundingClientRect()
      const viewportH = window.innerHeight
      const bodyTop = bodyZoneRef?.getBoundingClientRect().top ?? viewportH
      const visibleBottom = Math.min(heroRect.bottom, viewportH, bodyTop)
      const bottomInHero = heroRect.bottom - visibleBottom
      setBottomOffset(Math.max(16, bottomInHero + 16))
      ticking = false
    }

    const onScroll = () => {
      if (!ticking) {
        ticking = true
        requestAnimationFrame(update)
      }
    }

    update()
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [wrapperRef])

  useEffect(() => {
    const el = playerRef.current as HTMLMediaElement | null
    if (!el?.textTracks) return

    const findSubtitleTrack = (): TextTrack | null => {
      for (let i = 0; i < el.textTracks.length; i++) {
        const t = el.textTracks[i]!
        if (
          (t.kind === "subtitles" || t.kind === "captions") &&
          t.label === FORGE_SUBTITLE_TRACK_LABEL &&
          (t.mode === "showing" || t.mode === "hidden")
        ) {
          t.mode = "hidden"
          return t
        }
      }
      return null
    }

    const attachCueListener = (track: TextTrack) => {
      if (listenerRef.current) return

      const onCueChange = () => {
        const activeCues = track.activeCues
        if (!activeCues || activeCues.length === 0) {
          setCueText(null)
          return
        }
        const texts: string[] = []
        for (let i = 0; i < activeCues.length; i++) {
          const cue = activeCues[i] as VTTCue
          if (cue.text) texts.push(getWebVttCueText(cue))
        }
        setCueText(texts.length > 0 ? texts.join("\n") : null)
      }

      track.addEventListener("cuechange", onCueChange)
      listenerRef.current = () =>
        track.removeEventListener("cuechange", onCueChange)
      onCueChange()
    }

    const track = findSubtitleTrack()
    if (track) attachCueListener(track)

    const onTrackChange = () => {
      if (listenerRef.current) {
        listenerRef.current()
        listenerRef.current = null
      }
      setCueText(null)
      const t = findSubtitleTrack()
      if (t) attachCueListener(t)
    }

    el.textTracks.addEventListener("change", onTrackChange)
    el.textTracks.addEventListener("addtrack", onTrackChange)

    return () => {
      el.textTracks.removeEventListener("change", onTrackChange)
      el.textTracks.removeEventListener("addtrack", onTrackChange)
      if (listenerRef.current) {
        listenerRef.current()
        listenerRef.current = null
      }
    }
  }, [playerRef, player])

  if (!cueText || !playbackCommitted) return null

  const chromeShift = (() => {
    if (!controlsVisible) return 0
    const bar = document.querySelector(
      '[data-testid="hero-player-custom-chrome"]',
    )
    if (!bar) return 0
    const rect = bar.getBoundingClientRect()
    const visibleHeight =
      Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0)
    const ratio = Math.max(0, Math.min(1, visibleHeight / rect.height))
    return CHROME_BAR_HEIGHT * ratio
  })()

  return (
    <div
      data-testid="subtitle-overlay"
      className="pointer-events-none absolute inset-x-0 z-20 flex justify-center"
      style={{
        bottom: `${bottomOffset}px`,
        transform: `translateY(-${chromeShift}px)`,
        transition: "transform 200ms ease-out",
      }}
    >
      <div className="max-w-[min(80%,700px)] whitespace-pre-line px-5 py-2.5 text-center text-lg font-medium text-white [text-shadow:0_2px_4px_rgba(0,0,0,0.9)] md:text-xl">
        {cueText}
      </div>
    </div>
  )
}
