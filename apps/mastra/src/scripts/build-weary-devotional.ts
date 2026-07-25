#!/usr/bin/env tsx
/**
 * Author the "Advice for the Weary at Heart" devotional (adapted from Cru) into
 * a self-contained manifest: per-card Azure narration, a continuous background
 * cut from a JFP chapter clip ("Jesus Calms the Storm", fetched via the Arclight
 * public API), the same clip as the clear video card, and a music bed.
 *
 * Run:  node_modules/.bin/tsx apps/mastra/src/scripts/build-weary-devotional.ts
 * Then: apps/shorts-worker/scripts/render-devotional-video.mjs --manifest=devo/artifacts/weary/manifest.json --style=sepia --cover=frosted ...
 */
import { spawn } from "node:child_process"
import { readFileSync } from "node:fs"
import { copyFile, mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const MASTRA_DIR = path.resolve(SCRIPT_DIR, "../..")
const REPO_ROOT = path.resolve(MASTRA_DIR, "../..")

function loadEnvFile(filePath: string): void {
  let raw: string
  try {
    raw = readFileSync(filePath, "utf8")
  } catch {
    return
  }
  for (const line of raw.split("\n")) {
    const t = line.trim()
    if (!t || t.startsWith("#")) continue
    const eq = t.indexOf("=")
    if (eq === -1) continue
    const k = t.slice(0, eq).trim()
    let v = t.slice(eq + 1).trim()
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    )
      v = v.slice(1, -1)
    if (k && process.env[k] === undefined) process.env[k] = v
  }
}
loadEnvFile(path.join(MASTRA_DIR, ".env.local"))
loadEnvFile(path.join(REPO_ROOT, ".env.local"))

function probeDuration(file: string): Promise<number | null> {
  return new Promise((resolve) => {
    const c = spawn("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=nw=1:nk=1",
      file,
    ])
    let out = ""
    c.stdout.on("data", (d) => (out += d.toString()))
    c.on("error", () => resolve(null))
    c.on("close", () => {
      const v = Number.parseFloat(out.trim() || "")
      resolve(Number.isFinite(v) && v > 0 ? v : null)
    })
  })
}

/** Cut a segment (silent for backgrounds, or keep audio for the video card). */
function cutSegment(
  src: string,
  startSec: number,
  lenSec: number,
  outPath: string,
  keepAudio = false,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = [
      "-y",
      "-ss",
      startSec.toFixed(3),
      "-i",
      src,
      "-t",
      lenSec.toFixed(3),
      ...(keepAudio ? [] : ["-an"]),
      "-vf",
      "scale=1080:-2",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "21",
      "-pix_fmt",
      "yuv420p",
      ...(keepAudio ? ["-c:a", "aac", "-b:a", "128k"] : []),
      outPath,
    ]
    const c = spawn("ffmpeg", args, { stdio: "ignore" })
    c.on("error", reject)
    c.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg cut failed (${code})`)),
    )
  })
}

type AuthorCard = {
  kind: string
  spoken?: string
  fields: Record<string, unknown>
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
]
/** A plausible random header date, e.g. "Apr 9" (short so it never wraps/resizes). */
function randomDate(): string {
  return `${MONTHS[Math.floor(Math.random() * 12)]} ${1 + Math.floor(Math.random() * 28)}`
}

const CARDS: AuthorCard[] = [
  {
    kind: "cover",
    spoken: "What if nothing you're waiting for is actually overdue?",
    fields: {
      title: "What if nothing you're waiting for is actually overdue?",
      highlight: "overdue",
    },
  },
  {
    kind: "scripture",
    spoken:
      "And we know that God works all things together for the good of those who love him. Romans 8:28.",
    fields: {
      verse:
        "And we know that God works all things together for the good of those who love him.",
      citation: "Romans 8:28 · NIV",
      highlight: "all things",
    },
  },
  { kind: "video", fields: {} }, // Jesus Calms the Storm — plays its own audio
  {
    kind: "reflection-focus",
    spoken:
      "Keep walking. Stay close to God — reading, praying, listening. You'll rarely miss His will while you're walking with Him.",
    fields: {
      title: "Keep Walking",
      sectionLabel: "Reflect",
      text: "Stay close to God — reading, praying, listening. You'll rarely miss His will while you're walking with Him.",
      highlight: "walking with Him",
    },
  },
  {
    kind: "reflection-focus",
    spoken:
      "Keep praying. Keep bringing it to God until the answer is clear — yes, no, or a peace to wait.",
    fields: {
      title: "Keep Praying",
      text: "Keep bringing it to God until the answer is clear — yes, no, or a peace to wait.",
      highlight: "peace to wait",
    },
  },
  {
    kind: "reflection-focus",
    spoken:
      "Be patient. We want everything now. But peace and patience grow slowly, like fruit — not fast food.",
    fields: {
      title: "Be Patient",
      text: "We want everything now. But peace and patience grow slowly, like fruit — not fast food.",
      highlight: "patience",
    },
  },
  {
    kind: "reflection-focus",
    spoken:
      "Keep an eternal perspective. Nothing you're waiting for compares to the surpassing greatness of knowing Him.",
    fields: {
      title: "Eternal Perspective",
      text: "Nothing you're waiting for compares to the surpassing greatness of knowing Him.",
      highlight: "knowing Him",
    },
  },
  {
    kind: "conclusion",
    spoken: "[[break:500]] He is never overdue.",
    // Longer hold so there's a real pause before the questions card.
    fields: {
      text: "He is never overdue.",
      highlight: "never overdue",
      holdSec: 3,
    },
  },
  {
    kind: "questions",
    // Prayer = an INVITATION to pray (encouraging the viewer), not the narrator
    // praying to God on their behalf.
    spoken:
      "Sit with this. [[break:1100]] Where do you feel stuck, waiting, or short-changed? [[break:1400]] What would change if you trusted His timing? [[break:1400]] Now take a moment to pray. [[break:800]] Bring God the thing you're waiting for — the longing, the impatience — and ask Him for the peace to trust His timing.",
    fields: {
      questions: [
        "Where do you feel stuck, waiting, or short-changed?",
        "What would change if you trusted His timing?",
      ],
      prayer:
        "Take a moment to pray. Bring God the thing you're waiting for — the longing, the impatience — and ask Him for the peace to trust His timing.",
    },
  },
]

// JFP chapter clip (fetched from Arclight) used as BOTH the clear video card and
// the continuous blurred background. The video card sits at SNIPPET_START.
const FILM_SRC = path.join(REPO_ROOT, "devo/assets/jfp-storm.mp4")
const MUSIC_SRC = path.join(REPO_ROOT, "devo/assets/ambient-calm.m4a")
// The video card shows the WHOLE story beat — disciples in panic → Jesus rebukes
// the storm → the calm sea (~0:62–1:48). The clip ends with a "Get your next
// step" QR promo (~1:51+), so usable footage stops at FILM_USABLE_END.
const VIDEO_START = 58
const VIDEO_LEN = 46
const FILM_USABLE_END = 110
const TAIL_SEC = 0.4
const INTRO_SEC = 0.8
const OUTRO_SEC = 8.0
// Calm, mature female narration (Azure). Overridable via env for A/B voice tests.
const VOICE = process.env.DEVO_VOICE ?? "en-US-CoraMultilingualNeural"
const PITCH = process.env.DEVO_PITCH ?? "-7%"
const RATE = process.env.DEVO_RATE ?? "-8%"
const OUT_SUBDIR = process.env.DEVO_OUT ?? "weary"

async function main(): Promise<void> {
  const { generateVoiceover } = await import("../services/devotional/voiceover")
  const outDir = path.join(REPO_ROOT, "devo/artifacts", OUT_SUBDIR)
  await mkdir(outDir, { recursive: true })

  // Video card = the storm clip's clear snippet (with its own audio). Cut a few
  // seconds LONGER than the on-screen length so the slow dissolve out has footage
  // (no freeze). `videoDur` is the on-screen length, not the file length.
  await cutSegment(
    FILM_SRC,
    VIDEO_START,
    VIDEO_LEN + 3,
    path.join(outDir, "videocard.mp4"),
    true,
  )
  const videoDur = VIDEO_LEN

  console.log(`Synthesizing narration for ${CARDS.length} cards…`)
  const cards: Record<string, unknown>[] = []
  for (let i = 0; i < CARDS.length; i++) {
    const c = CARDS[i]
    if (c.kind === "video") {
      cards.push({
        kind: "video",
        videoFile: "videocard.mp4",
        durationSec: videoDur,
      })
      console.log(`  ${i} video: ${videoDur.toFixed(1)}s`)
      continue
    }
    const res = await generateVoiceover({
      text: c.spoken!,
      voice: VOICE,
      pitch: PITCH,
      rate: RATE,
    })
    if (!res.ok) throw new Error(`voiceover failed (${c.kind}): ${res.reason}`)
    const audioFile = `seg-${i}.mp3`
    await writeFile(path.join(outDir, audioFile), res.audio.bytes)
    const durationSec = (await probeDuration(path.join(outDir, audioFile))) ?? 4
    console.log(`  ${i} ${c.kind}: ${durationSec.toFixed(1)}s`)
    cards.push({ kind: c.kind, ...c.fields, audioFile, durationSec })
  }

  // Background is CONTIGUOUS with the video card: cards BEFORE it show footage
  // leading up to the snippet; cards AFTER it show footage following the snippet
  // (so the film isn't shown as one interrupted clip). `visible` includes each
  // card's holdSec, so an extended card keeps its background PLAYING (no freeze).
  const lastIndex = cards.length - 1
  const videoIndex = cards.findIndex((c) => c.kind === "video")
  const visible = cards.map(
    (c, i) =>
      (c.durationSec as number) +
      ((c.holdSec as number) ?? 0) +
      TAIL_SEC +
      (i === 0 ? INTRO_SEC : 0) +
      (i === lastIndex ? OUTRO_SEC : 0),
  )
  const filmDur = (await probeDuration(FILM_SRC)) ?? 0
  const usable = Math.min(filmDur || FILM_USABLE_END, FILM_USABLE_END)
  const videoEnd = VIDEO_START + videoDur

  const filmStart = new Array<number>(cards.length).fill(0)
  let anchor = VIDEO_START // walk backward for the cards before the video card
  for (let i = videoIndex - 1; i >= 0; i--) {
    anchor -= visible[i]
    filmStart[i] = anchor
  }
  anchor = videoEnd // walk forward for the cards after the video card
  for (let i = videoIndex + 1; i < cards.length; i++) {
    filmStart[i] = anchor
    anchor += visible[i]
  }

  console.log(`Cutting background from storm clip (usable ${usable}s)…`)
  for (let i = 0; i < cards.length; i++) {
    if (i === videoIndex) continue
    const len = visible[i] + 1
    // Wrap into the usable window [0, usable): before-cards that fall below 0 and
    // after-cards past the end reuse "any" footage rather than run off the clip.
    let start = ((filmStart[i] % usable) + usable) % usable
    if (start + len > usable) start = Math.max(0, usable - len)
    const bgFile = `bg-${i}.mp4`
    await cutSegment(FILM_SRC, start, len, path.join(outDir, bgFile))
    cards[i].bgFile = bgFile
    console.log(
      `  ${i} ${cards[i].kind}: ${start.toFixed(1)}–${(start + len).toFixed(1)}s`,
    )
  }

  let musicFile: string | undefined
  try {
    await copyFile(MUSIC_SRC, path.join(outDir, "music.m4a"))
    musicFile = "music.m4a"
  } catch {
    console.warn(`  ! music not found at ${MUSIC_SRC}`)
  }

  const manifest = {
    schemaVersion: "2",
    headerDate: randomDate(),
    ...(musicFile ? { musicFile } : {}),
    cards,
  }
  await writeFile(
    path.join(outDir, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
    "utf8",
  )
  const total = cards.reduce((s, c) => s + ((c.durationSec as number) ?? 0), 0)
  console.log(
    `\n✅ manifest: ${path.join(outDir, "manifest.json")} (${total.toFixed(1)}s)`,
  )
}

main().catch((e) => {
  console.error("author failed:", e)
  process.exitCode = 1
})
