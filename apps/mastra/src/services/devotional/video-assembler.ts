import { spawn } from "node:child_process"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import type { Devotional } from "./types"

/**
 * Local video assembler — turns a devotional's text + narration MP3 into a real
 * portrait (1080×1920) MP4 of timed "cards", set to the narration audio.
 *
 * This is the LOCAL proof of the "video devotional" idea using ffmpeg (no render
 * infra). The production-grade path is Remotion (packages/shorts-compositions) —
 * this assembler exists so you can SEE and hear a finished video end-to-end now.
 *
 * The card layout, wrapping, and ffmpeg `drawtext` filter are pure functions
 * (testable without ffmpeg); only `assembleDevotionalVideo` touches the binary.
 */

const WIDTH = 1080
const HEIGHT = 1920
const BG_COLOR = "0x0B132B" // deep night blue
const FONT_CANDIDATES = [
  "/System/Library/Fonts/Supplemental/Georgia.ttf",
  "/System/Library/Fonts/Supplemental/Arial.ttf",
  "/System/Library/Fonts/Helvetica.ttc",
]
const MIN_CARD_SEC = 2.5
const REFLECTION_CHARS_PER_CARD = 320

export type DevotionalCard = {
  kind: "hook" | "scripture" | "reflection" | "questions"
  /** Pre-wrapped lines, ready to render. */
  lines: string[]
  fontSize: number
}

/** Greedy word-wrap to a max character width. Preserves explicit newlines. */
export function wrapText(text: string, maxCharsPerLine: number): string[] {
  const out: string[] = []
  for (const paragraph of text.split("\n")) {
    let line = ""
    for (const word of paragraph.trim().split(/\s+/).filter(Boolean)) {
      if (line.length === 0) {
        line = word
      } else if (line.length + 1 + word.length <= maxCharsPerLine) {
        line += ` ${word}`
      } else {
        out.push(line)
        line = word
      }
    }
    out.push(line)
  }
  return out.length ? out : [""]
}

function chunkReflection(text: string, perCard: number): string[] {
  const sentences = text.split(/(?<=[.!?])\s+/)
  const chunks: string[] = []
  let cur = ""
  for (const s of sentences) {
    if (cur && cur.length + 1 + s.length > perCard) {
      chunks.push(cur)
      cur = s
    } else {
      cur = cur ? `${cur} ${s}` : s
    }
  }
  if (cur) chunks.push(cur)
  return chunks.length ? chunks : [text]
}

/** Build the ordered cards for a devotional. Pure. */
export function buildCards(devotional: Devotional): DevotionalCard[] {
  const cards: DevotionalCard[] = []
  cards.push({
    kind: "hook",
    lines: wrapText(devotional.hook.title, 22),
    fontSize: 84,
  })
  cards.push({
    kind: "scripture",
    lines: [
      ...wrapText(`"${devotional.scripture.text}"`, 30),
      "",
      `— ${devotional.scripture.reference}`,
    ],
    fontSize: 60,
  })
  for (const chunk of chunkReflection(
    devotional.reflection,
    REFLECTION_CHARS_PER_CARD,
  )) {
    cards.push({ kind: "reflection", lines: wrapText(chunk, 34), fontSize: 52 })
  }
  if (devotional.questions.length) {
    cards.push({
      kind: "questions",
      lines: devotional.questions.flatMap((q) => [
        ...wrapText(`• ${q}`, 32),
        "",
      ]),
      fontSize: 50,
    })
  }
  return cards
}

/**
 * Distribute `totalSec` across cards proportional to their text length, each at
 * least `minSec`. Returns cumulative [start, end] ranges. Pure.
 */
export function computeCardTimings(
  cards: DevotionalCard[],
  totalSec: number,
  minSec = MIN_CARD_SEC,
): Array<{ start: number; end: number }> {
  const weights = cards.map((c) => Math.max(c.lines.join(" ").length, 1))
  const weightSum = weights.reduce((a, b) => a + b, 0)
  const floor = minSec * cards.length
  const flexible = Math.max(totalSec - floor, 0)
  let t = 0
  return cards.map((_, i) => {
    const dur = minSec + (flexible * weights[i]) / weightSum
    const range = { start: t, end: t + dur }
    t += dur
    return range
  })
}

function escapeDrawtextPath(p: string): string {
  // drawtext fontfile: escape the path separators/colon for the filter syntax.
  return p.replace(/\\/g, "\\\\").replace(/:/g, "\\:")
}

/**
 * Build the ffmpeg `-filter_complex` drawtext chain: one drawtext per card,
 * enabled only during its time range, reading its text from a per-card file.
 * Pure — takes the resolved font + per-card textfile paths. `videoLabel` is the
 * input pad to draw onto (e.g. "0:v" or a scaled bg label).
 */
export function buildDrawtextFilter(input: {
  videoLabel: string
  fontFile: string
  cards: DevotionalCard[]
  timings: Array<{ start: number; end: number }>
  textFiles: string[]
}): string {
  const font = escapeDrawtextPath(input.fontFile)
  let label = input.videoLabel.startsWith("[")
    ? input.videoLabel
    : `[${input.videoLabel}]`
  const steps = input.cards.map((card, i) => {
    const tf = escapeDrawtextPath(input.textFiles[i])
    const { start, end } = input.timings[i]
    const out = `[v${i}]`
    const draw =
      `${label}drawtext=fontfile='${font}':textfile='${tf}':` +
      `fontcolor=white:fontsize=${card.fontSize}:line_spacing=18:` +
      `x=(w-text_w)/2:y=(h-text_h)/2:` +
      `box=0:enable='between(t,${start.toFixed(2)},${end.toFixed(2)})'${out}`
    label = out
    return draw
  })
  // Rename the final label to a stable [vout].
  return `${steps.join(";")};${label}null[vout]`
}

/**
 * A self-contained HTML storyboard of the cards — the "what the video shows"
 * view, openable in a browser. Used as the visual deliverable on machines whose
 * ffmpeg lacks the `drawtext` filter (so text can't be burned into the MP4).
 * Pure.
 */
export function buildStoryboardHtml(devotional: Devotional): string {
  const cards = buildCards(devotional)
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  const cardHtml = cards
    .map(
      (c) =>
        `<section class="card ${c.kind}"><div class="inner">${c.lines
          .map((l) => (l ? `<p>${esc(l)}</p>` : `<p class="sp"></p>`))
          .join("")}</div></section>`,
    )
    .join("\n")
  return `<!doctype html><html><head><meta charset="utf-8">
<title>Devotional ${esc(devotional.date)}</title>
<style>
  body{margin:0;background:#05070f;font-family:Georgia,serif;color:#fff}
  .deck{display:flex;flex-wrap:wrap;gap:24px;padding:24px;justify-content:center}
  .card{width:300px;height:533px;border-radius:20px;background:#0B132B;
    box-shadow:0 8px 30px rgba(0,0,0,.5);display:flex;align-items:center;
    justify-content:center;padding:28px;box-sizing:border-box;text-align:center}
  .card.hook .inner p:first-child{font-size:30px;font-weight:bold}
  .card.scripture{background:#11224a}
  .card .inner p{margin:.35em 0;line-height:1.45;font-size:18px}
  .card .inner p.sp{height:.6em;margin:0}
  .card.questions .inner p{text-align:left;font-size:17px}
  h1{color:#9fb3ff;font-size:20px;padding:24px 24px 0;font-weight:normal}
</style></head><body>
<h1>Daily devotional — ${esc(devotional.date)} (storyboard)</h1>
<div class="deck">${cardHtml}</div>
</body></html>`
}

function ffmpegHasFilter(name: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn("ffmpeg", ["-hide_banner", "-filters"])
    let out = ""
    child.stdout.on("data", (d) => (out += d.toString()))
    child.on("error", () => resolve(false))
    child.on("close", () => resolve(new RegExp(`\\b${name}\\b`).test(out)))
  })
}

function resolveFont(): string {
  const found = FONT_CANDIDATES.find((f) => existsSync(f))
  if (!found) {
    throw new Error(
      `no usable font found for video text (looked in: ${FONT_CANDIDATES.join(", ")})`,
    )
  }
  return found
}

function run(
  bin: string,
  args: string[],
): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args)
    let stderr = ""
    child.stderr.on("data", (d) => (stderr += d.toString()))
    child.on("error", reject)
    child.on("close", (code) => resolve({ code: code ?? -1, stderr }))
  })
}

// ffprobe writes the duration to stdout.
function probeDuration(audioPath: string): Promise<number | null> {
  return new Promise((resolve) => {
    const child = spawn("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=nw=1:nk=1",
      audioPath,
    ])
    let stdout = ""
    child.stdout.on("data", (d) => (stdout += d.toString()))
    child.on("error", () => resolve(null))
    child.on("close", () => {
      const value = Number.parseFloat(stdout.trim() || "")
      resolve(Number.isFinite(value) && value > 0 ? value : null)
    })
  })
}

export type AssembleDevotionalVideoInput = {
  devotional: Devotional
  /** Narration MP3 (from the voiceover step). Omit for a silent video. */
  audioPath?: string
  /** Optional background video (e.g. a JESUS clip you uploaded). */
  backgroundVideoPath?: string
  outPath: string
}

export type AssembleDevotionalVideoResult = {
  path: string
  durationSec: number
  cardCount: number
  /** "cards" = text burned into the video; "audio+storyboard" = ffmpeg lacked
   * drawtext, so the MP4 is background+narration and the cards are an HTML file. */
  mode: "cards" | "audio+storyboard"
  storyboardPath?: string
}

export async function assembleDevotionalVideo(
  input: AssembleDevotionalVideoInput,
): Promise<AssembleDevotionalVideoResult> {
  const cards = buildCards(input.devotional)
  const durationSec =
    (input.audioPath ? await probeDuration(input.audioPath) : null) ??
    Math.max(cards.length * 4, 12)
  const timings = computeCardTimings(cards, durationSec)
  const canBurnText = await ffmpegHasFilter("drawtext")

  await mkdir(path.dirname(input.outPath), { recursive: true })
  const work = await mkdtemp(path.join(tmpdir(), "devo-video-"))
  try {
    const args: string[] = ["-y"]
    // Input 0: background (a supplied clip, looped, or a solid color).
    if (input.backgroundVideoPath) {
      args.push("-stream_loop", "-1", "-i", input.backgroundVideoPath)
    } else {
      args.push(
        "-f",
        "lavfi",
        "-i",
        `color=c=${BG_COLOR}:s=${WIDTH}x${HEIGHT}:d=${durationSec.toFixed(2)}`,
      )
    }
    if (input.audioPath) args.push("-i", input.audioPath)

    // Background prep: scale/crop/darken a supplied clip; color is already sized.
    const bgPrep = input.backgroundVideoPath
      ? `[0:v]scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase,` +
        `crop=${WIDTH}:${HEIGHT},eq=brightness=-0.35[bg];`
      : ""
    const bgLabel = input.backgroundVideoPath ? "[bg]" : "0:v"

    if (canBurnText) {
      const fontFile = resolveFont()
      const textFiles: string[] = []
      for (let i = 0; i < cards.length; i++) {
        const tf = path.join(work, `card-${i}.txt`)
        await writeFile(tf, cards[i].lines.join("\n"), "utf8")
        textFiles.push(tf)
      }
      const filter =
        bgPrep +
        buildDrawtextFilter({
          videoLabel: bgLabel,
          fontFile,
          cards,
          timings,
          textFiles,
        })
      args.push("-filter_complex", filter, "-map", "[vout]")
    } else if (input.backgroundVideoPath) {
      // No text filter: just the prepared background.
      args.push("-filter_complex", `${bgPrep}[bg]null[vout]`, "-map", "[vout]")
    } else {
      args.push("-map", "0:v")
    }

    // Audio is always the second input (0 = background, 1 = narration).
    if (input.audioPath) args.push("-map", "1:a")
    args.push(
      "-t",
      durationSec.toFixed(2),
      "-r",
      "30",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-preset",
      "veryfast",
    )
    if (input.audioPath) args.push("-c:a", "aac", "-b:a", "128k")
    args.push("-shortest", input.outPath)

    const { code, stderr } = await run("ffmpeg", args)
    if (code !== 0) {
      throw new Error(
        `ffmpeg failed (code ${code}): ${stderr.split("\n").slice(-6).join("\n")}`,
      )
    }

    // Without burned text, emit the cards as an HTML storyboard alongside.
    let storyboardPath: string | undefined
    if (!canBurnText) {
      storyboardPath = input.outPath.replace(/\.mp4$/i, "") + "-cards.html"
      await writeFile(
        storyboardPath,
        buildStoryboardHtml(input.devotional),
        "utf8",
      )
    }

    return {
      path: input.outPath,
      durationSec,
      cardCount: cards.length,
      mode: canBurnText ? "cards" : "audio+storyboard",
      ...(storyboardPath ? { storyboardPath } : {}),
    }
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => undefined)
  }
}

export const _internal = { resolveFont, escapeDrawtextPath, ffmpegHasFilter }
