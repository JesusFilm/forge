"use client"

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type RefObject,
} from "react"

import type { MuxPlayerRef } from "@forge/video-player"

import type { WatchSubtitle } from "@/lib/content"
import { WATCH_PAGE_CONTENT_CLASSES } from "@/lib/content-width"
import { GLASS_OUTLINE_CLASS } from "@/lib/glass-outline"

type Cue = { start: number; end: number; text: string }

const TIMING_RE =
  /(?:(\d+):)?(\d+):(\d+)[.,](\d+)\s*-->\s*(?:(\d+):)?(\d+):(\d+)[.,](\d+)/

function toSeconds(
  h: string | undefined,
  m: string,
  s: string,
  ms: string,
): number {
  const hours = h ? parseInt(h, 10) : 0
  return (
    hours * 3600 +
    parseInt(m, 10) * 60 +
    parseInt(s, 10) +
    parseInt(ms.padEnd(3, "0").slice(0, 3), 10) / 1000
  )
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
}

export function parseVtt(raw: string): Cue[] {
  const cues: Cue[] = []
  const normalized = raw.replace(/\r\n?/g, "\n")
  const blocks = normalized.split(/\n\n+/)
  for (const block of blocks) {
    const lines = block.split("\n").filter((l) => l.length > 0)
    const timingIdx = lines.findIndex((l) => l.includes("-->"))
    if (timingIdx < 0) continue
    const m = lines[timingIdx]!.match(TIMING_RE)
    if (!m) continue
    const start = toSeconds(m[1], m[2]!, m[3]!, m[4]!)
    const end = toSeconds(m[5], m[6]!, m[7]!, m[8]!)
    const textLines = lines.slice(timingIdx + 1)
    const text = decodeEntities(
      textLines
        .join(" ")
        .replace(/<[^>]+>/g, "")
        .trim(),
    )
    if (text) cues.push({ start, end, text })
  }
  return cues
}

function formatTimestamp(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number) => n.toString().padStart(2, "0")
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`
  return `${m}:${pad(s)}`
}

function pickInitialSubtitleSlug(
  subtitles: WatchSubtitle[],
  audioSlug: string | null | undefined,
): string | null {
  if (subtitles.length === 0) return null
  if (audioSlug) {
    const match = subtitles.find((s) => s.language.slug === audioSlug)
    if (match) return match.language.slug
  }
  const primary = subtitles.find((s) => s.primary)
  if (primary) return primary.language.slug
  const human = subtitles.find((s) => !s.aiGenerated)
  if (human) return human.language.slug
  return subtitles[0]!.language.slug
}

type SubtitleTranscriptProps = {
  subtitles: WatchSubtitle[]
  playerRef: RefObject<MuxPlayerRef | null>
  audioSlug?: string | null
}

export function SubtitleTranscript({
  subtitles,
  playerRef,
  audioSlug,
}: SubtitleTranscriptProps) {
  const initialSlug = useMemo(
    () => pickInitialSubtitleSlug(subtitles, audioSlug ?? null),
    [subtitles, audioSlug],
  )
  const [selectedSlug, setSelectedSlug] = useState<string | null>(initialSlug)

  const activeSubtitle = useMemo(() => {
    if (!selectedSlug) return null
    return (
      subtitles.find((s) => s.language.slug === selectedSlug) ??
      subtitles[0] ??
      null
    )
  }, [selectedSlug, subtitles])

  const [loaded, setLoaded] = useState<{
    vttSrc: string
    cues: Cue[] | null
  } | null>(null)
  // activeMark carries BOTH the cue-list identity and the highlighted index,
  // so render-time we only treat the index as valid when it belongs to the
  // currently-rendered cues array. Switching subtitle language drops the
  // stale highlight without an extra effect-driven setState.
  const [activeMark, setActiveMark] = useState<{
    cues: Cue[] | null
    idx: number
  }>({ cues: null, idx: -1 })

  const activeVttSrc = activeSubtitle?.vttSrc ?? null
  const cues =
    loaded && activeVttSrc && loaded.vttSrc === activeVttSrc
      ? loaded.cues
      : null
  const status: "idle" | "loading" | "error" | "ready" = !activeVttSrc
    ? "idle"
    : !loaded || loaded.vttSrc !== activeVttSrc
      ? "loading"
      : loaded.cues === null
        ? "error"
        : loaded.cues.length === 0
          ? "error"
          : "ready"

  const activeIdx = activeMark.cues === cues ? activeMark.idx : -1

  useEffect(() => {
    if (!activeVttSrc) return
    const controller = new AbortController()
    fetch(activeVttSrc, {
      credentials: "omit",
      signal: controller.signal,
    })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.text()
      })
      .then((text) => {
        setLoaded({ vttSrc: activeVttSrc, cues: parseVtt(text) })
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return
        setLoaded({ vttSrc: activeVttSrc, cues: null })
      })
    return () => controller.abort()
  }, [activeVttSrc])

  useEffect(() => {
    const el = playerRef.current as HTMLMediaElement | null
    if (!el || !cues || cues.length === 0) return
    let lastIdx = -1
    const update = () => {
      const t = el.currentTime
      let idx = -1
      for (let i = 0; i < cues.length; i++) {
        const c = cues[i]!
        if (t >= c.start && t < c.end) {
          idx = i
          break
        }
        if (c.start > t) break
      }
      if (idx !== lastIdx) {
        lastIdx = idx
        setActiveMark({ cues, idx })
      }
    }
    update()
    el.addEventListener("timeupdate", update)
    el.addEventListener("seeking", update)
    return () => {
      el.removeEventListener("timeupdate", update)
      el.removeEventListener("seeking", update)
    }
  }, [cues, playerRef])

  const handleSeek = useCallback(
    (cue: Cue) => {
      const el = playerRef.current as HTMLMediaElement | null
      if (!el) return
      el.currentTime = cue.start
      const result = el.play()
      if (result && typeof (result as Promise<void>).then === "function") {
        ;(result as Promise<void>).catch(() => {})
      }
      // Bring the player into view so the user sees the moment they
      // jumped to. The hero wrapper is sticky-positioned, so
      // scrollIntoView is a no-op (it's always at viewport top); scroll
      // the window to the document origin instead.
      if (typeof window !== "undefined") {
        window.scrollTo({ top: 0, behavior: "smooth" })
      }
    },
    [playerRef],
  )

  if (subtitles.length === 0) return null

  const languageLabel = (s: WatchSubtitle) =>
    s.language.nativeName && s.language.nativeName !== s.language.name
      ? `${s.language.name} (${s.language.nativeName})`
      : s.language.name

  return (
    <section
      data-testid="watch-subtitle-transcript"
      aria-labelledby="watch-transcript-heading"
      className="bg-stone-900/60 pt-12 pb-20 backdrop-blur-md sm:pt-16 sm:pb-24"
    >
      <div className={WATCH_PAGE_CONTENT_CLASSES}>
        <div className={`rounded-2xl bg-stone-800/40 ${GLASS_OUTLINE_CLASS}`}>
          <header className="flex flex-col gap-3 border-b border-white/10 px-6 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-8">
            <div>
              <h2
                id="watch-transcript-heading"
                className="text-2xl font-semibold tracking-tight text-stone-50"
              >
                Transcript
              </h2>
              <p className="mt-1 text-sm text-stone-400">
                Tap any line to jump to that moment.
              </p>
            </div>
            <div className="flex items-center gap-3">
              {subtitles.length > 1 ? (
                <label className="flex items-center gap-2 text-sm text-stone-300">
                  <span className="sr-only">Subtitle language</span>
                  <select
                    data-testid="watch-subtitle-language"
                    value={selectedSlug ?? ""}
                    onChange={(e) => setSelectedSlug(e.target.value)}
                    className={`appearance-none rounded-full bg-stone-900/80 px-4 py-2 text-sm font-medium text-stone-100 ${GLASS_OUTLINE_CLASS} focus-visible:outline-2 focus-visible:outline-white/80 focus-visible:outline-offset-2`}
                  >
                    {subtitles.map((s) => (
                      <option key={s.documentId} value={s.language.slug}>
                        {languageLabel(s)}
                        {s.aiGenerated ? " · AI" : ""}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <span className="rounded-full bg-stone-900/60 px-3 py-1 text-xs font-medium uppercase tracking-wide text-stone-300">
                  {activeSubtitle ? languageLabel(activeSubtitle) : ""}
                  {activeSubtitle?.aiGenerated ? " · AI" : ""}
                </span>
              )}
            </div>
          </header>

          {status === "loading" ? (
            <div className="flex items-center justify-center px-8 py-16 text-sm text-stone-400">
              Loading transcript…
            </div>
          ) : status === "error" ? (
            <div className="px-8 py-16 text-center text-sm text-stone-400">
              Transcript unavailable for this subtitle track.
            </div>
          ) : cues && cues.length > 0 ? (
            <ol
              data-testid="watch-subtitle-cues"
              className="px-2 py-3 sm:px-4 sm:py-4"
            >
              {cues.map((cue, idx) => {
                const isActive = idx === activeIdx
                return (
                  <li key={`${cue.start}-${idx}`}>
                    <button
                      type="button"
                      onClick={() => handleSeek(cue)}
                      aria-current={isActive ? "true" : undefined}
                      className={[
                        "group flex w-full items-baseline gap-4 rounded-lg px-4 py-3 text-left transition-colors duration-150",
                        "focus-visible:outline-2 focus-visible:outline-white/80 focus-visible:outline-offset-2",
                        isActive
                          ? "bg-white/10 text-stone-50"
                          : "text-stone-300 hover:bg-white/5 hover:text-stone-100",
                      ].join(" ")}
                    >
                      <time
                        dateTime={`PT${Math.floor(cue.start)}S`}
                        className={[
                          "shrink-0 font-mono text-xs tabular-nums tracking-tight transition-colors",
                          isActive
                            ? "text-amber-300"
                            : "text-stone-500 group-hover:text-stone-300",
                        ].join(" ")}
                      >
                        {formatTimestamp(cue.start)}
                      </time>
                      <span className="text-base leading-relaxed sm:text-lg">
                        {cue.text}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ol>
          ) : (
            <div className="px-8 py-16 text-center text-sm text-stone-400">
              No transcript lines found.
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
