"use client"

import { useEffect, useRef, useState } from "react"
import type { MuxPlayerRef } from "@forge/video-player"

const CHROME_BAR_HEIGHT = 64

function stripHtmlTags(text: string): string {
  return text.replace(/<[^>]*>/g, "")
}

export function SubtitleOverlay({
  playerRef,
  wrapperRef,
  player,
}: {
  playerRef: React.RefObject<MuxPlayerRef | null>
  wrapperRef: React.RefObject<HTMLDivElement | null>
  player: MuxPlayerRef | null
}) {
  const [cueText, setCueText] = useState<string | null>(null)
  const [bottomOffset, setBottomOffset] = useState(16)
  const [chromeRevealed, setChromeRevealed] = useState(false)
  const listenerRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    const wrapper = wrapperRef.current
    if (!wrapper) return
    setChromeRevealed(wrapper.getAttribute("data-chrome-revealed") === "true")
    const observer = new MutationObserver(() => {
      setChromeRevealed(wrapper.getAttribute("data-chrome-revealed") === "true")
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

    let ticking = false
    const update = () => {
      const heroRect = wrapper.getBoundingClientRect()
      const viewportH = window.innerHeight
      const bodyZone = document.querySelector(
        '[data-testid="watch-body-zone"]',
      ) as HTMLElement | null
      const bodyTop = bodyZone?.getBoundingClientRect().top ?? viewportH
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
          if (cue.text) texts.push(stripHtmlTags(cue.text))
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

  if (!cueText) return null

  const finalBottom = bottomOffset + (chromeRevealed ? CHROME_BAR_HEIGHT : 0)

  return (
    <div
      data-testid="subtitle-overlay"
      className="pointer-events-none absolute inset-x-0 z-20 flex justify-center"
      style={{ bottom: `${finalBottom}px` }}
    >
      <div className="max-w-[min(80%,700px)] whitespace-pre-line rounded-md bg-black/75 px-5 py-2.5 text-center text-lg font-medium text-white shadow-lg backdrop-blur-sm md:text-xl">
        {cueText}
      </div>
    </div>
  )
}
