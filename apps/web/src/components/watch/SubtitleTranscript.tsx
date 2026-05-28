"use client"

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type RefObject,
} from "react"
import { useTranslations } from "next-intl"

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

// Entity map. Single-pass replace so a literal `&amp;lt;` in source
// decodes to `&lt;` (not `<`). Decoding `&amp;` last in a chained
// `.replace()` would double-unescape that case — see CodeQL js/double-escaping.
const HTML_ENTITY_MAP: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&nbsp;": " ",
}
const HTML_ENTITY_RE = /&(?:amp|lt|gt|quot|#39|nbsp);/g

function decodeEntities(text: string): string {
  return text.replace(HTML_ENTITY_RE, (m) => HTML_ENTITY_MAP[m] ?? m)
}

// Strip VTT/HTML-ish tags. Iterate until the string stabilises so nested
// or overlapping payloads (e.g. `<scr<script>ipt>`) can't survive a single
// pass — see CodeQL js/incomplete-multi-character-sanitization. Output
// still flows into a React text node, so the regex is defense-in-depth
// over auto-escaped JSX rather than the primary safety boundary.
function stripTags(text: string): string {
  let prev = ""
  let cur = text
  while (cur !== prev) {
    prev = cur
    cur = cur.replace(/<[^>]*>/g, "")
  }
  return cur
}

/**
 * SMPTE-offset normalization. Broadcast-authored VTT files often start at
 * 01:00:00 (the first hour reserved for color bars / leader), so cues run
 * 01:HH:MM:SS instead of 00:HH:MM:SS. The video file itself plays from
 * 0:00, so the raw cues never line up with `currentTime`. Detect by
 * comparing the last cue's end against the variant duration with a 60s
 * grace; shift by the largest whole-hour offset that brings cues back
 * inside duration. No-op when duration is unknown.
 */
export function normalizeCueOffset(
  cues: Cue[],
  durationSeconds: number | null | undefined,
): Cue[] {
  if (cues.length === 0) return cues
  if (!durationSeconds || durationSeconds <= 0) return cues
  const first = cues[0]!.start
  const last = cues[cues.length - 1]!.end
  if (last <= durationSeconds + 60) return cues
  if (first < 3600) return cues
  const offset = Math.floor(first / 3600) * 3600
  const candidateLast = last - offset
  if (candidateLast < 0 || candidateLast > durationSeconds + 60) return cues
  return cues.map((c) => ({
    start: c.start - offset,
    end: c.end - offset,
    text: c.text,
  }))
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
    const text = decodeEntities(stripTags(textLines.join(" ")).trim())
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
  /**
   * Selected variant's duration in seconds. Used to detect and unwind
   * SMPTE-style 1-hour authoring offsets in the VTT timing (see
   * `normalizeCueOffset`). Optional — when omitted, cues render as
   * authored.
   */
  durationSeconds?: number | null
}

export function SubtitleTranscript({
  subtitles,
  playerRef,
  audioSlug,
  durationSeconds,
}: SubtitleTranscriptProps) {
  const t = useTranslations("SubtitleTranscript")
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
        setLoaded({
          vttSrc: activeVttSrc,
          cues: normalizeCueOffset(parseVtt(text), durationSeconds),
        })
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return
        setLoaded({ vttSrc: activeVttSrc, cues: null })
      })
    return () => controller.abort()
  }, [activeVttSrc, durationSeconds])

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
      // Promote the hero out of muted-preview if it has not committed yet.
      // The pre-reveal click surface owns the unmute + chrome-revealed
      // state transition inside HeroPlayer; clicking it from this cue-click
      // handler chains the user gesture so the browser still treats the
      // synthetic click as user-initiated and grants unmuted playback.
      // The synthetic click also resets `currentTime` to 0 inside
      // HeroPlayer, so we apply the seek AFTER the click to land at the
      // requested cue.
      if (typeof document !== "undefined") {
        const wrapper = document.querySelector(
          '[data-testid="hero-player-wrapper"]',
        )
        const revealed =
          wrapper?.getAttribute("data-chrome-revealed") === "true"
        if (!revealed) {
          const surface = document.querySelector(
            '[data-testid="hero-player-pre-reveal-click-surface"]',
          ) as HTMLButtonElement | null
          surface?.click()
        }
      }
      // Belt-and-suspenders unmute for the already-revealed case (the
      // click surface above is absent post-reveal). Safe to set on every
      // click — the user explicitly asked for the moment, so silent
      // playback is never the desired outcome here.
      el.muted = false
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
                {t("heading")}
              </h2>
              <p className="mt-1 text-sm text-stone-400">{t("subheading")}</p>
            </div>
            <div className="flex items-center gap-3">
              {subtitles.length > 1 ? (
                <label className="flex items-center gap-2 text-sm text-stone-300">
                  <span className="sr-only">{t("subtitleLanguage")}</span>
                  <select
                    data-testid="watch-subtitle-language"
                    value={selectedSlug ?? ""}
                    onChange={(e) => setSelectedSlug(e.target.value)}
                    className={`appearance-none rounded-full bg-stone-900/80 px-4 py-2 text-sm font-medium text-stone-100 ${GLASS_OUTLINE_CLASS} focus-visible:outline-2 focus-visible:outline-white/80 focus-visible:outline-offset-2`}
                  >
                    {subtitles.map((s) => (
                      <option key={s.documentId} value={s.language.slug}>
                        {languageLabel(s)}
                        {s.aiGenerated ? t("aiSuffix") : ""}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <span className="rounded-full bg-stone-900/60 px-3 py-1 text-xs font-medium uppercase tracking-wide text-stone-300">
                  {activeSubtitle ? languageLabel(activeSubtitle) : ""}
                  {activeSubtitle?.aiGenerated ? t("aiSuffix") : ""}
                </span>
              )}
            </div>
          </header>

          {status === "loading" ? (
            <div className="flex items-center justify-center px-8 py-16 text-sm text-stone-400">
              {t("loading")}
            </div>
          ) : status === "error" ? (
            <div className="px-8 py-16 text-center text-sm text-stone-400">
              {t("unavailable")}
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
              {t("empty")}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
