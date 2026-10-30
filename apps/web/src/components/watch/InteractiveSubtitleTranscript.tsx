"use client"

import {
  useCallback,
  useEffect,
  useState,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
} from "react"

import type { MuxPlayerRef } from "@forge/video-player"

import { formatDuration } from "@/lib/format-duration"
import {
  normalizeCueOffset,
  parseVtt,
  type SubtitleCue,
} from "@/lib/subtitle-transcript"

export async function loadSubtitleCues(
  vttSrc: string,
  durationSeconds: number | null | undefined,
  signal: AbortSignal,
): Promise<SubtitleCue[]> {
  const response = await fetch(vttSrc, {
    credentials: "omit",
    signal,
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)

  return normalizeCueOffset(parseVtt(await response.text()), durationSeconds)
}

type InteractiveSubtitleTranscriptProps = {
  cues: SubtitleCue[]
  id: string
  playerRef: RefObject<MuxPlayerRef | null>
}

export default function InteractiveSubtitleTranscript({
  cues,
  id,
  playerRef,
}: InteractiveSubtitleTranscriptProps) {
  const [activeIdx, setActiveIdx] = useState(-1)

  useEffect(() => {
    const player = playerRef.current as HTMLMediaElement | null
    if (!player || cues.length === 0) return

    let lastIdx = -1
    const updateActiveCue = () => {
      const currentTime = player.currentTime
      let nextIdx = -1
      for (let idx = 0; idx < cues.length; idx++) {
        const cue = cues[idx]!
        if (currentTime >= cue.start && currentTime < cue.end) {
          nextIdx = idx
          break
        }
        if (cue.start > currentTime) break
      }
      if (nextIdx !== lastIdx) {
        lastIdx = nextIdx
        setActiveIdx(nextIdx)
      }
    }

    updateActiveCue()
    player.addEventListener("timeupdate", updateActiveCue)
    player.addEventListener("seeking", updateActiveCue)
    return () => {
      player.removeEventListener("timeupdate", updateActiveCue)
      player.removeEventListener("seeking", updateActiveCue)
    }
  }, [cues, playerRef])

  const handleSeek = useCallback(
    (cue: SubtitleCue, event: ReactMouseEvent<HTMLButtonElement>) => {
      // Ignore any click that is part of a multi-click gesture. Expanding the
      // transcript mounts this list under the reader's pointer, so the second
      // click of a double-click on the collapsed teaser (the normal gesture for
      // selecting a word) would otherwise land here and seek, unmute, play, and
      // scroll the page. `detail` only increments for repeated clicks at the
      // same position, so a deliberate click on a different cue still seeks.
      if (event.detail > 1) return

      const player = playerRef.current as HTMLMediaElement | null
      if (!player) return

      // Promote the hero out of muted preview before applying the seek. The
      // synthetic click remains chained to the user's transcript click.
      const wrapper = document.querySelector(
        '[data-testid="hero-player-wrapper"]',
      )
      const revealed = wrapper?.getAttribute("data-chrome-revealed") === "true"
      if (!revealed) {
        const surface = document.querySelector(
          '[data-testid="hero-player-pre-reveal-click-surface"]',
        ) as HTMLButtonElement | null
        surface?.click()
      }

      player.muted = false
      player.currentTime = cue.start
      const playResult = player.play()
      if (
        playResult &&
        typeof (playResult as Promise<void>).then === "function"
      ) {
        ;(playResult as Promise<void>).catch(() => {})
      }
      window.scrollTo({ top: 0, behavior: "smooth" })
    },
    [playerRef],
  )

  return (
    <ol
      id={id}
      data-testid="watch-subtitle-cues"
      className="px-2 py-3 sm:px-4 sm:py-4"
    >
      {cues.map((cue, idx) => {
        const isActive = idx === activeIdx
        return (
          <li key={`${cue.start}-${idx}`}>
            <button
              type="button"
              onClick={(event) => handleSeek(cue, event)}
              aria-current={isActive ? "true" : undefined}
              className={[
                "group flex w-full cursor-pointer items-baseline gap-4 rounded-lg px-4 py-3 text-left transition-colors duration-150",
                "focus-visible:outline-2 focus-visible:outline-white/80 focus-visible:outline-offset-2",
                isActive
                  ? "bg-white/10 text-stone-50"
                  : "text-stone-300 hover:bg-white/5 hover:text-stone-100",
              ].join(" ")}
            >
              <time
                dateTime={`PT${Math.floor(cue.start)}S`}
                className={[
                  "shrink-0 font-mono text-sm sm:text-xs tabular-nums tracking-tight transition-colors",
                  isActive
                    ? "text-amber-300"
                    : "text-stone-500 group-hover:text-stone-300",
                ].join(" ")}
              >
                {formatDuration(cue.start)}
              </time>
              <span className="text-base leading-relaxed sm:text-lg">
                {cue.text}
              </span>
            </button>
          </li>
        )
      })}
    </ol>
  )
}
