"use client"

import {
  lazy,
  Suspense,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
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

/**
 * The overflow measurement must land before the browser paints, or a transcript
 * that fits shows the "there is more" fade for a frame (seconds on a slow
 * phone, where hydration is late). `useLayoutEffect` warns during SSR, so fall
 * back to `useEffect` on the server, where there is no paint to beat anyway.
 */
const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect

/**
 * Collapsed transcripts are clamped so the card stops pushing every section
 * below it thousands of pixels down. The clamp applies to the TEXT box; the
 * subtracted 15rem is the card's non-text chrome (measured 237-249px across
 * desktop and mobile: section padding plus header), so the CARD is what lands
 * at ~60% of the viewport.
 *
 * `svh`, NOT `dvh`: this is an in-flow, document-scroll element, and every
 * other viewport-unit box in apps/web is a fixed/absolute overlay. `dvh`
 * re-resolves as mobile browser chrome retracts, which would move this card —
 * and everything below it — by ~35-60px mid-scroll. `WatchHomeTvCarousel`'s
 * in-flow `h-[66svh]` is the precedent.
 *
 * The 60% target only holds while `0.6 * viewport - 240px` clears the 6rem
 * floor, i.e. above a ~560px-tall viewport. Below that the chrome alone
 * exceeds 60%, the floor binds, and the card is a fixed ~336px (a landscape
 * phone therefore sees a card taller than 60% showing ~3 lines) — deliberate,
 * because the alternative is a card too short to read.
 */
const COLLAPSED_TEXT_CLAMP_CLASS =
  "max-h-[max(6rem,calc(60svh_-_15rem))] overflow-hidden"

/**
 * Bottom fade telling the reader there is more text behind the clamp. Paired
 * with the `-webkit-` property for Safari, matching `SiblingCarousel`.
 *
 * Do NOT factor the repeated gradient into a shared variable: Tailwind
 * extracts candidates by scanning source text, so an interpolated class name
 * never appears in the source and the utility is silently never generated —
 * the fade would just stop rendering with no build or test error.
 */
const COLLAPSED_TEXT_FADE_CLASS =
  "[mask-image:linear-gradient(to_bottom,black_0%,black_62%,transparent_100%)] [-webkit-mask-image:linear-gradient(to_bottom,black_0%,black_62%,transparent_100%)]"

/**
 * Sub-pixel line-height rounding leaves `scrollHeight` a hair above
 * `clientHeight` on text that visually fits, so require more than a rounding
 * error's worth of overflow before claiming there is more to read.
 */
const OVERFLOW_TOLERANCE_PX = 4

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

  const collapsedTextRef = useRef<HTMLDivElement | null>(null)
  // Defaults to faded: a real transcript overflows the clamp far more often
  // than not, and measurement only ever removes the fade. Environments that
  // cannot measure (jsdom, a hidden ancestor) therefore keep the honest hint.
  const [collapsedTextOverflows, setCollapsedTextOverflows] = useState(true)

  useIsomorphicLayoutEffect(() => {
    if (expanded) return
    const element = collapsedTextRef.current
    if (!element) return

    const measure = () => {
      // A zero-height box means "not laid out", not "fits" — treating it as
      // fitting would strip the fade from every overflowing transcript.
      if (element.clientHeight === 0) return
      setCollapsedTextOverflows(
        element.scrollHeight - element.clientHeight > OVERFLOW_TOLERANCE_PX,
      )
    }

    // Measure once synchronously: ResizeObserver's first callback is async, and
    // this is the only measurement at all when ResizeObserver is unavailable.
    measure()
    if (typeof ResizeObserver === "undefined") {
      // No observer to re-measure on viewport/orientation change, so listen
      // for the one event that changes this box's height.
      window.addEventListener("resize", measure)
      return () => window.removeEventListener("resize", measure)
    }
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [compactText, expanded])

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
  const handleCollapsedClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    // Ignore the second click of a double-click. Expanding mounts the cue list
    // synchronously whenever cues are already cached, so the next click can
    // land on a cue button and seek/unmute/play/scroll the page — a reader
    // double-clicking to select a word would lose their place in the video.
    if (event.detail > 1) return
    // A click that ends a text selection is a selection, not a request to
    // expand. Without this, selecting teaser text collapses into an expand.
    const selection =
      typeof window === "undefined" ? null : window.getSelection()
    if (selection && !selection.isCollapsed) return
    openTranscript()
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
    // Click-anywhere is a MOUSE-ONLY enhancement layered on a plain, non-
    // interactive text container. It is deliberately not a <button>:
    //   - a button's role is children-presentational, so wrapping the teaser
    //     pruned it from the accessibility tree and (with aria-label) from the
    //     accessible name too, making the default state unreadable to screen
    //     readers and worse for text-extracting crawlers;
    //   - WebKit sets `-webkit-user-select: none` on button, which broke
    //     selecting and copying the transcript;
    //   - the button unmounted on activation, dropping keyboard focus to
    //     <body>;
    //   - <div> inside <button> violates the button content model.
    // The header chevron remains the sole accessible disclosure control: it
    // already carries aria-expanded/aria-controls, is keyboard reachable, and
    // PERSISTS across expand/collapse, so focus never sits on a disappearing
    // element. Anything added here must keep that property.
    content = (
      <div
        data-testid="watch-subtitle-compact-expand"
        onClick={handleCollapsedClick}
        className="cursor-pointer rounded-b-2xl"
      >
        <div
          id={contentId}
          ref={collapsedTextRef}
          data-testid="watch-subtitle-compact-text"
          className={`whitespace-pre-line px-6 py-6 text-base leading-relaxed text-stone-300 sm:px-8 sm:py-8 sm:text-lg ${COLLAPSED_TEXT_CLAMP_CLASS} ${
            collapsedTextOverflows ? COLLAPSED_TEXT_FADE_CLASS : ""
          }`}
        >
          {compactText}
        </div>
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
