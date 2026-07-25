"use client"

import {
  lazy,
  Suspense,
  useEffect,
  useId,
  useMemo,
  useState,
  type RefObject,
  type ReactNode,
} from "react"
import { ChevronDown } from "lucide-react"
import { useTranslations } from "next-intl"

import type { MuxPlayerRef } from "@forge/video-player"

import type { WatchSubtitle } from "@/lib/content"
import { WATCH_PAGE_CONTENT_CLASSES } from "@/lib/content-width"
import { GLASS_OUTLINE_CLASS } from "@/lib/glass-outline"
import {
  filterTranscriptSubtitlesForAudio,
  formatCompactTranscript,
  pickInitialSubtitleSlug,
  type InitialSubtitleTranscript,
  type SubtitleCue,
} from "@/lib/subtitle-transcript"

type InteractiveTranscriptModule =
  typeof import("./InteractiveSubtitleTranscript")

let interactiveTranscriptModulePromise: Promise<InteractiveTranscriptModule> | null =
  null

function loadInteractiveTranscriptModule(): Promise<InteractiveTranscriptModule> {
  interactiveTranscriptModulePromise ??=
    import("./InteractiveSubtitleTranscript").catch((error: unknown) => {
      interactiveTranscriptModulePromise = null
      throw error
    })
  return interactiveTranscriptModulePromise
}

const LazyInteractiveSubtitleTranscript = lazy(loadInteractiveTranscriptModule)

type SubtitleTranscriptProps = {
  subtitles: WatchSubtitle[]
  playerRef: RefObject<MuxPlayerRef | null>
  audioSlug?: string | null
  /**
   * Selected variant's duration in seconds. Used to detect and unwind
   * SMPTE-style 1-hour authoring offsets in the VTT timing.
   */
  durationSeconds?: number | null
  initialTranscript?: InitialSubtitleTranscript
}

type TranscriptStatus = "loading" | "error" | "ready"

export function SubtitleTranscript({
  subtitles,
  playerRef,
  audioSlug,
  durationSeconds,
  initialTranscript = null,
}: SubtitleTranscriptProps) {
  const t = useTranslations("SubtitleTranscript")
  const contentId = useId()
  const transcriptSubtitles = useMemo(
    () => filterTranscriptSubtitlesForAudio(subtitles, audioSlug),
    [subtitles, audioSlug],
  )
  const initialSlug = useMemo(
    () => pickInitialSubtitleSlug(transcriptSubtitles, audioSlug ?? null),
    [transcriptSubtitles, audioSlug],
  )
  const [interaction, setInteraction] = useState(() => ({
    expanded: false,
    initialSlug,
    selectedSlug: initialSlug,
  }))
  const interactionIsCurrent = interaction.initialSlug === initialSlug
  const selectedSlug = interactionIsCurrent
    ? interaction.selectedSlug
    : initialSlug
  const expanded = interactionIsCurrent ? interaction.expanded : false

  const activeSubtitle = useMemo(() => {
    if (!selectedSlug) return null
    return (
      transcriptSubtitles.find((s) => s.language.slug === selectedSlug) ??
      transcriptSubtitles[0] ??
      null
    )
  }, [selectedSlug, transcriptSubtitles])

  const activeVttSrc = activeSubtitle?.vttSrc ?? null
  const [loadedTranscripts, setLoadedTranscripts] = useState<
    ReadonlyMap<string, SubtitleCue[] | null>
  >(() => new Map())
  const hasLoadedActiveSource = activeVttSrc
    ? loadedTranscripts.has(activeVttSrc)
    : false
  const cues =
    activeVttSrc && hasLoadedActiveSource
      ? (loadedTranscripts.get(activeVttSrc) ?? null)
      : null
  const serverCompactText =
    initialTranscript?.vttSrc === activeVttSrc
      ? initialTranscript.compactText
      : null
  const compactText = useMemo(() => {
    if (serverCompactText) return serverCompactText
    if (expanded || !cues || cues.length === 0) return null
    return formatCompactTranscript(cues)
  }, [cues, expanded, serverCompactText])

  useEffect(() => {
    if (!expanded || !activeVttSrc || hasLoadedActiveSource) return

    const controller = new AbortController()
    loadInteractiveTranscriptModule()
      .then(({ loadSubtitleCues }) => {
        if (controller.signal.aborted) return []
        return loadSubtitleCues(
          activeVttSrc,
          durationSeconds,
          controller.signal,
        )
      })
      .then((nextCues) => {
        if (controller.signal.aborted) return
        setLoadedTranscripts((current) => {
          const next = new Map(current)
          next.set(activeVttSrc, nextCues.length > 0 ? nextCues : null)
          return next
        })
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return
        if (controller.signal.aborted) return
        setLoadedTranscripts((current) => {
          const next = new Map(current)
          next.set(activeVttSrc, null)
          return next
        })
      })

    return () => controller.abort()
  }, [activeVttSrc, durationSeconds, expanded, hasLoadedActiveSource])

  if (transcriptSubtitles.length === 0) return null

  const languageLabel = (subtitle: WatchSubtitle) =>
    subtitle.language.nativeName &&
    subtitle.language.nativeName !== subtitle.language.name
      ? `${subtitle.language.name} (${subtitle.language.nativeName})`
      : subtitle.language.name

  const openTranscript = () => {
    if (activeVttSrc && loadedTranscripts.get(activeVttSrc) === null) {
      setLoadedTranscripts((current) => {
        if (current.get(activeVttSrc) !== null) return current
        const next = new Map(current)
        next.delete(activeVttSrc)
        return next
      })
    }
    setInteraction({ expanded: true, initialSlug, selectedSlug })
  }
  const closeTranscript = () => {
    setInteraction({ expanded: false, initialSlug, selectedSlug })
  }
  let interactiveStatus: TranscriptStatus = "ready"
  if (!hasLoadedActiveSource) interactiveStatus = "loading"
  else if (!cues || cues.length === 0) interactiveStatus = "error"

  const collapsedStatus: TranscriptStatus = compactText ? "ready" : "error"
  const status = expanded ? interactiveStatus : collapsedStatus

  const loadingContent = (
    <div
      id={contentId}
      className="flex items-center justify-center px-8 py-16 text-sm text-stone-400"
    >
      {t("loading")}
    </div>
  )
  let content: ReactNode
  if (status === "loading") {
    content = loadingContent
  } else if (status === "error") {
    content = (
      <div
        id={contentId}
        className="px-8 py-16 text-center text-sm text-stone-400"
      >
        {t("unavailable")}
      </div>
    )
  } else if (expanded && cues) {
    content = (
      <Suspense fallback={loadingContent}>
        <LazyInteractiveSubtitleTranscript
          id={contentId}
          cues={cues}
          playerRef={playerRef}
        />
      </Suspense>
    )
  } else {
    content = (
      <div
        id={contentId}
        data-testid="watch-subtitle-compact-text"
        className="whitespace-pre-line px-6 py-6 text-base leading-relaxed text-stone-300 sm:px-8 sm:py-8 sm:text-lg"
      >
        {compactText}
      </div>
    )
  }

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
              {expanded ? (
                <p className="mt-1 text-sm text-stone-400">{t("subheading")}</p>
              ) : null}
            </div>
            <div className="flex items-center gap-3">
              {expanded && transcriptSubtitles.length > 1 ? (
                <label className="flex items-center gap-2 text-sm text-stone-300">
                  <span className="sr-only">{t("subtitleLanguage")}</span>
                  <select
                    data-testid="watch-subtitle-language"
                    value={selectedSlug ?? ""}
                    onChange={(event) => {
                      const nextSlug = event.target.value
                      const nextVttSrc = transcriptSubtitles.find(
                        (subtitle) => subtitle.language.slug === nextSlug,
                      )?.vttSrc
                      if (
                        nextVttSrc &&
                        loadedTranscripts.get(nextVttSrc) === null
                      ) {
                        setLoadedTranscripts((current) => {
                          if (current.get(nextVttSrc) !== null) return current
                          const next = new Map(current)
                          next.delete(nextVttSrc)
                          return next
                        })
                      }
                      setInteraction({
                        expanded,
                        initialSlug,
                        selectedSlug: nextSlug,
                      })
                    }}
                    className={`appearance-none rounded-full bg-stone-900/80 px-4 py-2 text-sm font-medium text-stone-100 ${GLASS_OUTLINE_CLASS} focus-visible:outline-2 focus-visible:outline-white/80 focus-visible:outline-offset-2`}
                  >
                    {transcriptSubtitles.map((subtitle) => (
                      <option
                        key={subtitle.documentId}
                        value={subtitle.language.slug}
                      >
                        {languageLabel(subtitle)}
                        {subtitle.aiGenerated ? t("aiSuffix") : ""}
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
              <button
                type="button"
                data-testid="watch-subtitle-transcript-toggle"
                aria-expanded={expanded}
                aria-controls={contentId}
                aria-label={t("heading")}
                title={t("heading")}
                onClick={expanded ? closeTranscript : openTranscript}
                className="inline-flex size-9 cursor-pointer items-center justify-center rounded-full text-stone-300 transition-colors hover:bg-white/10 hover:text-stone-50 focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:outline-none"
              >
                <ChevronDown
                  aria-hidden="true"
                  className={`size-5 transition-transform duration-200 ${
                    expanded ? "rotate-180" : ""
                  }`}
                />
              </button>
            </div>
          </header>

          {content}
        </div>
      </div>
    </section>
  )
}
