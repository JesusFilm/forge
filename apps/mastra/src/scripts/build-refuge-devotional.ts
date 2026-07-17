#!/usr/bin/env tsx
/**
 * Author "Taking Refuge in God" (adapted from Our Daily Bread, Psalm 91) into a
 * self-contained manifest: per-card Azure narration (deep, calm Christopher
 * voice) with spoken connector phrases, a continuous background + clear video
 * card cut from the JESUS Film "Jesus Calms the Storm" chapter (Arclight), and
 * a music bed.
 *
 * Run:  node_modules/.bin/tsx apps/mastra/src/scripts/build-refuge-devotional.ts
 * Then: render-devotional-video.mjs --manifest=devo/artifacts/refuge/manifest.json --style=splittone ...
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

// Spoken connectors thread the cards. Cover opens with a catchy statement (NOT a
// question). "Let's watch." rides the tail of the scripture card into the clip.
const CARDS: AuthorCard[] = [
  {
    kind: "cover",
    spoken: "Today's devotional. There's a shelter no storm can reach.",
    fields: {
      title: "There's a shelter no storm can reach.",
      highlight: "shelter",
    },
  },
  {
    kind: "scripture",
    spoken:
      "It begins with God's Word. I will say of the Lord, He is my refuge and my fortress, my God, in whom I trust. Psalm 91, verse 2. [[break:600]] Let's watch.",
    fields: {
      verse:
        "I will say of the Lord, “He is my refuge and my fortress, my God, in whom I trust.”",
      citation: "Psalm 91:2 · NIV",
      highlight: "refuge and my fortress",
    },
  },
  { kind: "video", fields: {} }, // Jesus calms the storm — plays its own audio
  {
    kind: "reflection-focus",
    spoken:
      "Reflect on this. Faith doesn't pretend the storm isn't there. The disciples were right — the water was rising, the danger was real. God meets you in the actual storm, not a pretended calm.",
    fields: {
      title: "The Storm Is Real",
      sectionLabel: "Reflect",
      text: "Faith doesn't pretend the storm isn't there. The water really was rising. God meets you in the actual storm, not a pretended calm.",
      highlight: "the actual storm",
    },
  },
  {
    kind: "reflection-focus",
    spoken:
      "Taking refuge doesn't mean the winds stop the moment you pray. It means you have somewhere unshakable to stand while they blow.",
    fields: {
      title: "Refuge Isn't Escape",
      text: "Taking refuge doesn't mean the winds stop the moment you pray. It means you have somewhere unshakable to stand while they blow.",
      highlight: "somewhere unshakable",
    },
  },
  {
    kind: "reflection-focus",
    spoken:
      "Jesus slept through the storm, but He was never indifferent to it. When your own courage runs out, His has not. He is not asleep to you.",
    fields: {
      title: "He Is Not Asleep to You",
      text: "Jesus slept through the storm — but He was never indifferent. When your own courage runs out, His has not.",
      highlight: "His has not",
    },
  },
  {
    kind: "reflection-focus",
    spoken:
      "Psalm 91 ties rescue to one thing: calling on His name. Refuge is not a place you earn. It's a Person you turn to.",
    fields: {
      title: "Call, and He Answers",
      text: "Psalm 91 ties rescue to one thing: calling on His name. Refuge is not a place you earn — it's a Person you turn to.",
      highlight: "a Person you turn to",
    },
  },
  {
    kind: "reflection-focus",
    spoken:
      "He didn't wrestle the storm to the ground. He spoke, and it went still. That same voice speaks over your chaos: peace.",
    fields: {
      title: "One Word Is Enough",
      text: "He didn't wrestle the storm. He spoke, and it went still. That same voice speaks over your chaos: peace.",
      highlight: "it went still",
    },
  },
  {
    kind: "conclusion",
    spoken: "[[break:500]] The One who calms the storm is already in the boat.",
    fields: {
      text: "The One who calms the storm is already in the boat.",
      highlight: "in the boat",
      holdSec: 3,
    },
  },
  {
    kind: "questions",
    spoken:
      "Sit with this. [[break:1100]] What storm are you facing right now? [[break:1400]] Where have you been sheltering that isn't holding? [[break:1400]] Now, take a moment to pray. [[break:800]] Name the storm you're in, and ask God to be your refuge — the shelter that holds when everything else gives way.",
    fields: {
      questions: [
        "What storm are you facing right now?",
        "Where have you been sheltering that isn't holding?",
      ],
      prayer:
        "Take a moment to pray. Name the storm you're in, and ask God to be your refuge — the shelter that holds when everything else gives way.",
    },
  },
]

// JESUS Film "Jesus Calms the Storm" chapter (Arclight) as the clear video card
// + background. Video card = the disciples' fear → Jesus rebukes the storm →
// calm (~60–106s of the chapter). The dark promo tail is excluded via
// FILM_USABLE_END.
const FILM_SRC = path.join(REPO_ROOT, "devo/assets/jfp-storm.mp4")
const MUSIC_SRC =
  process.env.DEVO_MUSIC ?? path.join(REPO_ROOT, "devo/assets/music/nature.mp3")
const VIDEO_START = 60
const VIDEO_LEN = 46
const FILM_USABLE_END = 110
const TAIL_SEC = 0.4
const INTRO_SEC = 0.8
const OUTRO_SEC = 8.0
// Third voice: deep, calm, older male (chosen from the audition set).
const VOICE = process.env.DEVO_VOICE ?? "en-US-ChristopherNeural"
const PITCH = process.env.DEVO_PITCH ?? "-8%"
const RATE = process.env.DEVO_RATE ?? "-8%"
const OUT_SUBDIR = process.env.DEVO_OUT ?? "refuge"

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
  const musicExt = path.extname(MUSIC_SRC) || ".mp3"
  try {
    await copyFile(MUSIC_SRC, path.join(outDir, `music${musicExt}`))
    musicFile = `music${musicExt}`
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
