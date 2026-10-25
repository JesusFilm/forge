"use client"

// Ported from the read-only prototype. G4: verse of the day, taken from THIS film's own
// Bible citations (the same `bibleCitations` the Bible Quotes band renders),
// with a real shareable image drawn in-browser on a canvas.
//
// Which verse: the day of the year modulo the number of citations, so the card
// changes daily and is the same for everyone on that day — no storage, no
// backend.

import { Copy, Check, Download, Quote } from "lucide-react"
import { useMemo, useRef, useState } from "react"

import type { WatchBibleQuotesBlock } from "@/lib/content"
import { buttonVariants } from "@/components/ui/button-variants"
import { WATCH_SECTION_EYEBROW_CLASS } from "@/components/watch/watch-section-styles"
import { cn } from "@/lib/utils"
import { watchPassageTextProps } from "./watch-passage-language"

type Citation = WatchBibleQuotesBlock["bibleCitations"][number]

function dayOfYear(d: Date): number {
  const start = Date.UTC(d.getUTCFullYear(), 0, 0)
  return Math.floor(
    (Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - start) /
      86400000,
  )
}

/** Wraps text on a canvas and returns the lines that fit the given width. */
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

export function WatchGrowVerse({
  citations,
  filmTitle,
}: {
  citations: Citation[]
  filmTitle: string
}) {
  const [copied, setCopied] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  // Only citations that actually carry passage text can be shown as a verse.
  const withText = useMemo(
    () => citations.filter((c) => c.passage?.content),
    [citations],
  )

  const today = withText.length
    ? withText[dayOfYear(new Date()) % withText.length]
    : null

  if (!today?.passage) return null

  const text = today.passage.content.replace(/\s+/g, " ").trim()
  const reference = today.passage.humanReference
  const version = today.passage.versionAbbreviation ?? ""

  const copy = () => {
    void navigator.clipboard
      ?.writeText(`“${text}” — ${reference}${version ? ` (${version})` : ""}`)
      .then(
        () => {
          setCopied(true)
          window.setTimeout(() => setCopied(false), 2000)
        },
        () => {},
      )
  }

  const saveImage = () => {
    const canvas = canvasRef.current ?? document.createElement("canvas")
    canvasRef.current = canvas
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
    ctx.fillRect(90, 150, 64, 8)

    // Shrink until the whole passage fits the card; only ellipsise if even the
    // smallest size runs past the bottom, so the card never ends mid-sentence
    // without saying so.
    ctx.fillStyle = "#ffffff"
    const MAX_LINES = 12
    let fontSize = 62
    let lines: string[] = []
    for (const candidate of [62, 54, 46, 40, 34, 30]) {
      fontSize = candidate
      ctx.font = `600 ${candidate}px Georgia, serif`
      lines = wrap(ctx, `“${text}”`, size - 180)
      if (lines.length <= MAX_LINES) break
    }
    if (lines.length > MAX_LINES) {
      lines = lines.slice(0, MAX_LINES)
      lines[MAX_LINES - 1] =
        `${lines[MAX_LINES - 1].replace(/[,;:.\s]+$/, "")}…”`
    }
    const lineHeight = fontSize * 1.34
    // Centre the block between the rule and the reference line.
    const top = Math.max(250, 250 + (620 - lines.length * lineHeight) / 2)
    lines.forEach((line, i) => {
      ctx.fillText(line, 90, top + i * lineHeight)
    })

    ctx.fillStyle = "rgba(255,255,255,0.65)"
    ctx.font = "500 34px Helvetica, Arial, sans-serif"
    ctx.fillText(
      `${reference}${version ? ` · ${version}` : ""}`,
      90,
      size - 190,
    )

    ctx.fillStyle = "rgba(255,255,255,0.4)"
    ctx.font = "400 26px Helvetica, Arial, sans-serif"
    ctx.fillText(filmTitle, 90, size - 140)
    ctx.fillText("jesusfilm.org/watch", 90, size - 96)

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
      data-testid="watch-grow-verse"
      aria-labelledby="watch-grow-verse-heading"
      className="w-full min-w-0 pt-12 text-white md:pt-16"
    >
      <p className={WATCH_SECTION_EYEBROW_CLASS}>Today, from this film</p>
      <h2
        id="watch-grow-verse-heading"
        className="mt-3 text-3xl leading-[1.08] font-semibold text-balance sm:text-4xl"
      >
        Carry one verse with you.
      </h2>

      <figure className="mt-6 min-w-0 rounded-3xl border border-white/10 bg-white/[0.06] p-6 md:p-8">
        <Quote aria-hidden className="size-6 text-brand-red" />
        <blockquote
          {...watchPassageTextProps(today.passage)}
          className="mt-3 text-xl leading-snug font-medium text-balance md:text-2xl"
        >
          {text}
        </blockquote>
        <figcaption className="mt-4 text-[14px] text-white/55">
          <span {...watchPassageTextProps(today.passage)}>{reference}</span>
          {version ? ` · ${version}` : ""}
        </figcaption>

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
            className="inline-flex h-12 cursor-pointer items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-5 text-[14px] font-semibold transition-colors hover:border-white hover:bg-white hover:text-stone-900 focus-visible:border-white focus-visible:bg-white focus-visible:text-stone-900 focus-visible:outline-none"
          >
            {copied ? (
              <Check aria-hidden className="size-4" />
            ) : (
              <Copy aria-hidden className="size-4" />
            )}
            {copied ? "Copied" : "Copy text"}
          </button>
          <p className="text-[13px] text-white/40">A new verse each day.</p>
        </div>
      </figure>
    </section>
  )
}
