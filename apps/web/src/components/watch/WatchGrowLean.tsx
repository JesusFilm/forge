"use client"

// Ported from the read-only prototype. The tight version of the Grow tab: THREE modules, all
// tied to the film on screen, about one screen of scroll instead of four.
//
// Why it is shaped this way — from the critique of the long version:
//  1. The most obvious next step on a series page is the next episode. The long
//     version never offered it; this one leads with it.
//  2. "Carry one verse" must be one line, not an eleven-line passage. The full
//     passage is one click away, and the pull-quote is labelled "From <ref>" so
//     nothing is misattributed.
//  3. Fifteen plans is a library, not a next step. One question returns one
//     plan; the rest stay behind a quiet link.
//
// Everything page-independent (the nine-session course, the plan library, the
// monthly prayer guide) belongs on a destination, not stapled under all 200
// films. Here it is one link.

import {
  ArrowRight,
  Check,
  ChevronDown,
  Copy,
  Download,
  Play,
  Quote,
} from "lucide-react"
import Link from "next/link"
import { useMemo, useState } from "react"

import type { WatchBibleQuotesBlock } from "@/lib/content"
import { buttonVariants } from "@/components/ui/button-variants"
import { WatchFindButton } from "@/components/watch/WatchFindLauncher"
import { WatchGrowPlanRail } from "@/components/watch/WatchGrowPlanRail"
import { WATCH_SECTION_EYEBROW_CLASS } from "@/components/watch/watch-section-styles"
import { cn } from "@/lib/utils"
import { watchPassageTextProps } from "./watch-passage-language"

export type NextEpisode = {
  title: string
  minutes: number | null
  href: string
}

/** The most quotable single sentence — long enough to stand alone, short enough to carry. */
function pullQuote(passage: string): string {
  const sentences = passage
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?”"])\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
  return (
    sentences.find((s) => s.length >= 45 && s.length <= 190) ??
    sentences[0] ??
    passage
  )
}

function wrap(
  ctx: CanvasRenderingContext2D,
  text: string,
  max: number,
): string[] {
  const out: string[] = []
  let line = ""
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word
    if (ctx.measureText(next).width > max && line) {
      out.push(line)
      line = word
    } else {
      line = next
    }
  }
  if (line) out.push(line)
  return out
}

export function WatchGrowLean({
  citations,
  filmTitle,
  seriesTitle,
  episodeCount,
  episodeIndex,
  nextEpisode,
}: {
  citations: WatchBibleQuotesBlock["bibleCitations"]
  filmTitle: string
  seriesTitle: string | null
  episodeCount: number
  /** 1-based position of this film in its series, when it has one. */
  episodeIndex: number | null
  nextEpisode: NextEpisode | null
}) {
  return (
    <div data-testid="watch-grow-lean" className="w-full min-w-0">
      <ContinueCard
        seriesTitle={seriesTitle}
        episodeCount={episodeCount}
        episodeIndex={episodeIndex}
        nextEpisode={nextEpisode}
      />
      <VerseCard citations={citations} filmTitle={filmTitle} />
      <WatchGrowPlanRail />

      <div className="mt-10 min-w-0 md:mt-12">
        <WatchFindButton />
      </div>

      <p className="mt-6 text-[13px] text-white/45">
        <a
          href="?as=grow&grow=full"
          className="inline-flex items-center gap-1.5 underline decoration-white/25 underline-offset-4 transition-colors hover:text-white/80"
        >
          More ways to grow — courses, all 15 plans, the monthly prayer guide
          <ArrowRight aria-hidden className="size-4" />
        </a>
      </p>
    </div>
  )
}

/* 1 — the next episode of the series they are already in. */
function ContinueCard({
  seriesTitle,
  episodeCount,
  episodeIndex,
  nextEpisode,
}: {
  seriesTitle: string | null
  episodeCount: number
  episodeIndex: number | null
  nextEpisode: NextEpisode | null
}) {
  if (!nextEpisode) return null
  return (
    <section
      data-testid="watch-grow-continue"
      aria-labelledby="watch-grow-continue-heading"
      className="w-full min-w-0 pt-12 text-white md:pt-16"
    >
      {/* episodeIndex is this film's place in the series, not viewing
          history: nothing here claims an episode was watched. */}
      <p className={WATCH_SECTION_EYEBROW_CLASS}>
        {seriesTitle != null ? (
          <span lang="" dir="auto">
            {seriesTitle}
          </span>
        ) : (
          "Keep going"
        )}
        {episodeIndex && episodeCount
          ? ` · ${episodeIndex} of ${episodeCount}`
          : ""}
      </p>
      <h2
        id="watch-grow-continue-heading"
        className="mt-3 text-3xl leading-[1.08] font-semibold text-balance sm:text-4xl"
      >
        Tomorrow:{" "}
        <span lang="" dir="auto">
          {nextEpisode.title}
        </span>
      </h2>

      {episodeCount > 1 && episodeIndex ? (
        <div
          role="img"
          className="mt-5 flex min-w-0 gap-1.5"
          aria-label={`Episode ${episodeIndex} of ${episodeCount}`}
        >
          {Array.from({ length: episodeCount }, (_, i) => (
            <span
              key={i}
              className={cn(
                "h-1.5 flex-1 rounded-full",
                i === episodeIndex - 1 ? "bg-brand-red" : "bg-white/15",
              )}
            />
          ))}
        </div>
      ) : null}

      <div className="mt-5 flex min-w-0 flex-wrap items-center gap-3">
        <Link
          href={nextEpisode.href as never}
          className={cn(buttonVariants({ variant: "pill" }), "h-12 gap-2")}
        >
          <Play aria-hidden className="size-4" />
          Watch it now
        </Link>
        {nextEpisode.minutes ? (
          <p className="text-[13px] text-white/45">
            {nextEpisode.minutes} min — same time tomorrow works too.
          </p>
        ) : null}
      </div>
    </section>
  )
}

/* 2 — one line from this film, image-first. */
function VerseCard({
  citations,
  filmTitle,
}: {
  citations: WatchBibleQuotesBlock["bibleCitations"]
  filmTitle: string
}) {
  const [copied, setCopied] = useState(false)
  const [showFull, setShowFull] = useState(false)

  const first = useMemo(
    () => citations.find((c) => c.passage?.content) ?? null,
    [citations],
  )
  if (!first?.passage) return null

  const full = first.passage.content.replace(/\s+/g, " ").trim()
  const line = pullQuote(full)
  const reference = first.passage.humanReference
  const version = first.passage.versionAbbreviation ?? ""
  // "From" keeps it honest: this is one line out of a longer passage.
  const credit = `From ${reference}${version ? ` · ${version}` : ""}`

  const copy = () => {
    void navigator.clipboard?.writeText(`“${line}” — ${reference}`).then(
      () => {
        setCopied(true)
        window.setTimeout(() => setCopied(false), 2000)
      },
      () => {},
    )
  }

  const saveImage = () => {
    const canvas = document.createElement("canvas")
    const size = 1080
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const bg = ctx.createLinearGradient(0, 0, size, size)
    bg.addColorStop(0, "#1a1512")
    bg.addColorStop(1, "#2b1b18")
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, size, size)
    ctx.fillStyle = "#E23B47"
    ctx.fillRect(90, 170, 64, 8)

    ctx.fillStyle = "#ffffff"
    let fontSize = 76
    let lines: string[] = []
    for (const candidate of [76, 66, 58, 50, 44]) {
      fontSize = candidate
      ctx.font = `600 ${candidate}px Georgia, serif`
      lines = wrap(ctx, `“${line}”`, size - 180)
      if (lines.length <= 8) break
    }
    const lh = fontSize * 1.32
    const top = 300 + Math.max(0, (420 - lines.length * lh) / 2)
    lines.forEach((l, i) => ctx.fillText(l, 90, top + i * lh))

    ctx.fillStyle = "rgba(255,255,255,0.65)"
    ctx.font = "500 32px Helvetica, Arial, sans-serif"
    ctx.fillText(credit, 90, size - 180)
    ctx.fillStyle = "rgba(255,255,255,0.4)"
    ctx.font = "400 26px Helvetica, Arial, sans-serif"
    ctx.fillText(filmTitle, 90, size - 132)
    ctx.fillText("jesusfilm.org/watch", 90, size - 90)

    canvas.toBlob((blob) => {
      if (!blob) return
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `verse-${reference.replace(/[^\w]+/g, "-").toLowerCase()}.png`
      a.click()
      URL.revokeObjectURL(url)
    }, "image/png")
  }

  return (
    <section
      data-testid="watch-grow-line"
      aria-labelledby="watch-grow-line-heading"
      className="w-full min-w-0 pt-12 text-white md:pt-16"
    >
      <p className={WATCH_SECTION_EYEBROW_CLASS}>From this film</p>
      <h2
        id="watch-grow-line-heading"
        className="mt-3 text-3xl leading-[1.08] font-semibold text-balance sm:text-4xl"
      >
        One line to carry.
      </h2>

      <figure className="mt-6 min-w-0 rounded-3xl border border-white/10 bg-white/[0.06] p-6 md:p-8">
        <Quote aria-hidden className="size-6 text-brand-red" />
        <blockquote
          {...watchPassageTextProps(first.passage)}
          className="mt-3 font-serif text-2xl leading-snug text-balance md:text-3xl"
        >
          {line}
        </blockquote>
        <figcaption className="mt-4 text-[14px] text-white/55">
          From{" "}
          <span {...watchPassageTextProps(first.passage)}>{reference}</span>
          {version ? ` · ${version}` : ""}
        </figcaption>

        {showFull ? (
          <p
            {...watchPassageTextProps(first.passage)}
            className="mt-5 border-t border-white/10 pt-5 text-[15px] leading-relaxed text-white/70"
          >
            {full}
          </p>
        ) : null}

        <div className="mt-6 flex min-w-0 flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={saveImage}
            className={cn(buttonVariants({ variant: "pill" }), "h-12 gap-2")}
          >
            <Download aria-hidden className="size-4" />
            Save as image
          </button>
          <button
            type="button"
            onClick={copy}
            className="inline-flex h-12 cursor-pointer items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-5 text-[14px] font-semibold transition-colors hover:border-white hover:bg-white hover:text-stone-900 focus-visible:outline-none"
          >
            {copied ? (
              <Check aria-hidden className="size-4" />
            ) : (
              <Copy aria-hidden className="size-4" />
            )}
            {copied ? "Copied" : "Copy"}
          </button>
          <button
            type="button"
            onClick={() => setShowFull((v) => !v)}
            aria-expanded={showFull}
            className="inline-flex cursor-pointer items-center gap-1.5 text-[13px] text-white/45 transition-colors hover:text-white/80"
          >
            <ChevronDown
              aria-hidden
              className={cn(
                "size-4 transition-transform",
                showFull && "rotate-180",
              )}
            />
            <span className="underline decoration-white/25 underline-offset-4">
              {showFull ? "Hide the passage" : "Read the whole passage"}
            </span>
          </button>
        </div>
      </figure>
    </section>
  )
}
