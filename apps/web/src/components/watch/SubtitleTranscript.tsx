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
import {
  filterTranscriptSubtitlesForAudio,
  normalizeCueOffset,
  parseVtt,
  pickInitialSubtitleSlug,
  type InitialSubtitleTranscript,
  type SubtitleCue,
} from "@/lib/subtitle-transcript"

function formatTimestamp(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number) => n.toString().padStart(2, "0")
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`
  return `${m}:${pad(s)}`
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
  initialTranscript?: InitialSubtitleTranscript
}

export function SubtitleTranscript({
  subtitles,
  playerRef,
  audioSlug,
  durationSeconds,
  initialTranscript = null,
}: SubtitleTranscriptProps) {
  const t = useTranslations("SubtitleTranscript")
  const transcriptSubtitles = useMemo(
    () => filterTranscriptSubtitlesForAudio(subtitles, audioSlug),
    [subtitles, audioSlug],
  )
  const initialSlug = useMemo(
    () => pickInitialSubtitleSlug(transcriptSubtitles, audioSlug ?? null),
    [transcriptSubtitles, audioSlug],
  )
  const [selectedSlug, setSelectedSlug] = useState<string | null>(initialSlug)

  useEffect(() => {
    setSelectedSlug(initialSlug)
  }, [initialSlug])

  const activeSubtitle = useMemo(() => {
    if (!selectedSlug) return null
    return (
      transcriptSubtitles.find((s) => s.language.slug === selectedSlug) ??
      transcriptSubtitles[0] ??
      null
    )
  }, [selectedSlug, transcriptSubtitles])

  const [loaded, setLoaded] = useState<{
    vttSrc: string
    cues: SubtitleCue[] | null
  } | null>(initialTranscript)
  // activeMark carries BOTH the cue-list identity and the highlighted index,
  // so render-time we only treat the index as valid when it belongs to the
  // currently-rendered cues array. Switching subtitle language drops the
  // stale highlight without an extra effect-driven setState.
  const [activeMark, setActiveMark] = useState<{
    cues: SubtitleCue[] | null
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
    if (loaded?.vttSrc === activeVttSrc) return
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
  }, [activeVttSrc, durationSeconds, loaded?.vttSrc])

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
    (cue: SubtitleCue) => {
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

  if (transcriptSubtitles.length === 0) return null

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
              {transcriptSubtitles.length > 1 ? (
                <label className="flex items-center gap-2 text-sm text-stone-300">
                  <span className="sr-only">{t("subtitleLanguage")}</span>
                  <select
                    data-testid="watch-subtitle-language"
                    value={selectedSlug ?? ""}
                    onChange={(e) => setSelectedSlug(e.target.value)}
                    className={`appearance-none rounded-full bg-stone-900/80 px-4 py-2 text-sm font-medium text-stone-100 ${GLASS_OUTLINE_CLASS} focus-visible:outline-2 focus-visible:outline-white/80 focus-visible:outline-offset-2`}
                  >
                    {transcriptSubtitles.map((s) => (
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
