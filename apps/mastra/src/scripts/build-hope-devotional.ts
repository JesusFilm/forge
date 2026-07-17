#!/usr/bin/env tsx
/**
 * Author "There Is Hope" (adapted from Our Daily Bread) into a self-contained
 * manifest: per-card Azure narration (with spoken connector phrases threading
 * the cards), a continuous background + clear video card cut from a JFP
 * resurrection chapter (Arclight), and a music bed.
 *
 * Run: node_modules/.bin/tsx apps/mastra/src/scripts/build-hope-devotional.ts
 * Then: render-devotional-video.mjs --manifest=devo/artifacts/hope/manifest.json --style=teal --cover=bottomRule ...
 */
import { spawn } from "node:child_process"
import { readFileSync } from "node:fs"
import { copyFile, mkdir, writeFile } from "node:fs/promises"
import path from "node:path"

const SCRIPT_DIR = path.dirname(new URL(import.meta.url).pathname)
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
/** A plausible random header date, e.g. "Apr 9" (kept short so it never wraps/resizes). */
function randomDate(): string {
  return `${MONTHS[Math.floor(Math.random() * 12)]} ${1 + Math.floor(Math.random() * 28)}`
}

// Spoken connector phrases (approved) thread the cards. "Let's watch." rides the
// tail of the scripture card, right before the video plays.
const CARDS: AuthorCard[] = [
  {
    kind: "cover",
    spoken: "Today's devotional. What if hope isn't just wishful thinking?",
    fields: {
      title: "What if hope isn't just wishful thinking?",
      highlight: "hope",
    },
  },
  {
    kind: "scripture",
    spoken:
      "It begins with God's Word. May the God of hope fill you with all joy and peace as you trust in him, so that you may overflow with hope. Romans 15:13. [[break:600]] Let's watch.",
    fields: {
      verse:
        "May the God of hope fill you with all joy and peace as you trust in him, so that you may overflow with hope.",
      citation: "Romans 15:13 · NIV",
      highlight: "hope",
    },
  },
  { kind: "video", fields: {} }, // Resurrected Jesus appears — plays its own audio
  {
    kind: "reflection-focus",
    spoken:
      "Reflect on this. When the news is hard, fear and even despair are natural. Scripture never scolds those feelings — it meets you inside them.",
    fields: {
      title: "Despair Is Honest",
      sectionLabel: "Reflect",
      text: "When the news is hard, fear and even despair are natural. Scripture never scolds those feelings — it meets you inside them.",
      highlight: "meets you inside them",
    },
  },
  {
    kind: "reflection-focus",
    spoken:
      "But real hope isn't flimsy optimism or crossed fingers. It's a confident expectation, anchored to something outside your changing circumstances.",
    fields: {
      title: "Not Wishful Thinking",
      text: "But real hope isn't flimsy optimism or crossed fingers. It's a confident expectation, anchored outside your changing circumstances.",
      highlight: "confident expectation",
    },
  },
  {
    kind: "reflection-focus",
    spoken:
      "Paul carried hope through prison and beatings because he had staked everything on one fact: Christ rose. If death couldn't hold Him, it will not hold you.",
    fields: {
      title: "Anchored in an Empty Tomb",
      text: "Paul carried hope through prison and beatings — because he had staked everything on one fact: Christ rose. If death couldn't hold Him, it won't hold you.",
      highlight: "Christ rose",
    },
  },
  {
    kind: "reflection-focus",
    spoken:
      "So for everyone who trusts Him, the grave is not the end. It becomes a doorway into a life that never fades.",
    fields: {
      title: "Not the End",
      text: "So for everyone who trusts Him, the grave is not the end — but a doorway into a life that never fades.",
      highlight: "not the end",
    },
  },
  {
    kind: "conclusion",
    spoken: "[[break:500]] So death doesn't get the last word.",
    fields: {
      text: "Death doesn't get the last word.",
      highlight: "the last word",
      holdSec: 3,
    },
  },
  {
    kind: "questions",
    spoken:
      "Sit with this. [[break:1100]] Where do you most need hope today? [[break:1400]] What would change if you truly believed it? [[break:1400]] Now, take a moment to pray. [[break:800]] Bring God the place you feel hopeless, and ask Him to fill you with His hope.",
    fields: {
      questions: [
        "Where do you most need hope today?",
        "What would change if you truly believed it?",
      ],
      prayer:
        "Take a moment to pray. Bring God the place you feel hopeless, and ask Him to fill you with His hope.",
    },
  },
]

// JFP resurrection chapter (Arclight) as the clear video card + background.
// Video card = Jesus risen, appearing to the disciples (~1:08–1:44); the clip's
// dark tail / promo is excluded via FILM_USABLE_END.
const FILM_SRC = path.join(REPO_ROOT, "devo/assets/jfp-resurrection.mp4")
// Music library lives in devo/assets/music/ — pick per devo (env-overridable).
const MUSIC_SRC =
  process.env.DEVO_MUSIC ?? path.join(REPO_ROOT, "devo/assets/music/spring.m4a")
const VIDEO_START = 68
const VIDEO_LEN = 36
const FILM_USABLE_END = 108
const TAIL_SEC = 0.4
const INTRO_SEC = 0.8
const OUTRO_SEC = 8.0
const VOICE = process.env.DEVO_VOICE ?? "en-US-CoraMultilingualNeural"
const PITCH = process.env.DEVO_PITCH ?? "-7%"
const RATE = process.env.DEVO_RATE ?? "-8%"
const OUT_SUBDIR = process.env.DEVO_OUT ?? "hope"

async function main(): Promise<void> {
  const { generateVoiceover } = await import("../services/devotional/voiceover")
  const outDir = path.join(REPO_ROOT, "devo/artifacts", OUT_SUBDIR)
  await mkdir(outDir, { recursive: true })

  // Video card cut a few seconds longer than on-screen length for the slow
  // dissolve out (no freeze). `videoDur` is the on-screen length.
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

  // Background contiguous with the video card; `visible` includes holdSec so an
  // extended card keeps its background playing.
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
  let anchor = VIDEO_START
  for (let i = videoIndex - 1; i >= 0; i--) {
    anchor -= visible[i]
    filmStart[i] = anchor
  }
  anchor = videoEnd
  for (let i = videoIndex + 1; i < cards.length; i++) {
    filmStart[i] = anchor
    anchor += visible[i]
  }

  console.log(`Cutting background (usable ${usable}s)…`)
  for (let i = 0; i < cards.length; i++) {
    if (i === videoIndex) continue
    const len = visible[i] + 1
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
