"use client"

import { useEffect, useRef, useState } from "react"
import type { MuxPlayerRef } from "@forge/video-player"

export function SubtitleOverlay({
  playerRef,
}: {
  playerRef: React.RefObject<MuxPlayerRef | null>
}) {
  const [cueText, setCueText] = useState<string | null>(null)
  const [chromeRevealed, setChromeRevealed] = useState(false)
  const listenerRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    const hero = document.querySelector(
      '[data-testid="hero-player-wrapper"]',
    ) as HTMLElement | null
    if (!hero) return
    setChromeRevealed(hero.getAttribute("data-chrome-revealed") === "true")
    const observer = new MutationObserver(() => {
      setChromeRevealed(hero.getAttribute("data-chrome-revealed") === "true")
    })
    observer.observe(hero, {
      attributes: true,
      attributeFilter: ["data-chrome-revealed"],
    })
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const el = playerRef.current as HTMLMediaElement | null
    if (!el?.textTracks) return

    const findSubtitleTrack = (): TextTrack | null => {
      for (let i = 0; i < el.textTracks.length; i++) {
        const t = el.textTracks[i]!
        if (
          (t.kind === "subtitles" || t.kind === "captions") &&
          t.mode === "showing"
        ) {
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
          if (cue.text) texts.push(cue.text)
        }
        setCueText(texts.length > 0 ? texts.join("\n") : null)
      }

      track.addEventListener("cuechange", onCueChange)
      listenerRef.current = () => {
        track.removeEventListener("cuechange", onCueChange)
      }
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
  }, [playerRef])

  return (
    <div
      data-testid="subtitle-overlay"
      className={`flex min-h-[3rem] items-center justify-center px-4 transition-all duration-300 ease-out ${
        chromeRevealed ? "pb-14" : "pb-2"
      }`}
    >
      {cueText && (
        <div className="max-w-[min(80%,700px)] whitespace-pre-line rounded-md bg-black/75 px-5 py-2.5 text-center text-lg font-medium text-white shadow-lg backdrop-blur-sm md:text-xl">
          {cueText}
        </div>
      )}
    </div>
  )
}
