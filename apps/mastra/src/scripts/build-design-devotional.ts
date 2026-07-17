#!/usr/bin/env tsx
/**
 * Author the "design" devotional — the exact 7-card content from the Cards-by-
 * Style design — into a self-contained manifest for the Remotion renderer:
 * synthesizes per-card narration (Azure), copies the background + video-card
 * clips, and writes manifest.json referencing them all by local name.
 *
 * Usage (repo root):  pnpm --filter @forge/mastra tsx apps/mastra/src/scripts/build-design-devotional.ts
 * Then render per style with apps/shorts-worker/scripts/render-devotional-video.mjs --manifest=...
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

// The design devotional — exact content from Cards by Style.
type AuthorCard = {
  kind: string
  spoken?: string // narration; omit for the video card (plays its own audio)
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

const P1 =
  "On this morning we celebrate the most extraordinary mystery of our faith: God stepped into human history — not as a distant ruler, but as a vulnerable infant."
const P2 =
  "The Word who spoke galaxies into being chose to become flesh: to feel hunger and cold, to grow and learn, to dwell among us."
const P3 =
  "When we look at the manger, we see God's clearest statement of how much we are loved."
const FOCUS =
  "He didn't send a message or a law. He sent Himself. The infinite became an infant so we could be held by the God who made us."
const Q1 = "Where do you most need God to feel near today?"
const Q2 = "What would change if you truly believed you are that loved?"
const PRAYER =
  "Take a moment — tell God where you need Him close. Thank Him for coming near, and ask Him to help you carry that nearness to someone today."

const CARDS: AuthorCard[] = [
  {
    kind: "cover",
    spoken: "What if God came close enough to be held?",
    fields: {
      title: "What if God came close enough to be held?",
      highlight: "held",
    },
  },
  {
    kind: "scripture",
    spoken:
      "And the Word became flesh and dwelt among us, and we have seen his glory. John 1:14.",
    fields: {
      verse:
        "And the Word became flesh and dwelt among us, and we have seen his glory.",
      citation: "John 1:14 · NASB",
      highlight: "became flesh",
    },
  },
  { kind: "video", fields: {} }, // narration = the clip's own audio
  {
    kind: "reflection-full",
    // Pause before the highlighted closing lands.
    spoken: `${P1} ${P2} ${P3} [[break:900]] He came near.`,
    fields: { paragraphs: [P1, P2, P3], closing: "He came near." },
  },
  {
    kind: "reflection-focus",
    // Let the highlighted phrase breathe on both sides.
    spoken:
      "He didn't send a message or a law. [[break:600]] He sent Himself. [[break:700]] The infinite became an infant so we could be held by the God who made us.",
    fields: { text: FOCUS, highlight: "He sent Himself." },
  },
  {
    kind: "conclusion",
    spoken: "Grace and truth, [[break:500]] wrapped in swaddling cloths.",
    fields: {
      text: "Grace and truth, wrapped in swaddling cloths.",
      highlight: "Grace and truth",
    },
  },
  {
    kind: "questions",
    // Long pauses before each question and after it's read, then before prayer.
    spoken: `Sit with this. [[break:1100]] ${Q1} [[break:1400]] ${Q2} [[break:1400]] Let's pray. [[break:800]] ${PRAYER}`,
    fields: { questions: [Q1, Q2], prayer: PRAYER },
  },
]

const VIDEO_CARD_SRC = "/Users/mac/Desktop/Devos/Birth of Jesus - detected.mp4"
// Full source film + where the video-card snippet sits inside it (found by
// frame-matching the snippet against the film, sampled at 1fps). The
// background flows as ONE continuous take through the film: cover/scripture
// pull the footage leading UP TO the snippet, the reflection cards pull the
// footage AFTER it — so nothing repeats card-to-card.
const FILM_SRC = "/Users/mac/Desktop/Devos/Birth of Jesus.mp4"
const SNIPPET_START = 247.5
// Soft instrumental bed. A ~105s calm, secular, public-domain segment
// (currently Chopin's Nocturne Op.9 No.2 from archive.org, PD — no attribution).
// Copied beside the manifest and referenced as `musicFile`. An automated
// pipeline can refresh this by querying archive.org for CC0/PD calm audio —
// CRUCIAL: filter OUT items tagged with any religious/spiritual practice
// (meditation, yoga, yogic, pranayama, zen, chakra, reiki, mantra, spiritual,
// worship, hymn, prayer, buddhist, hindu, etc.) so the music stays neutral.
const MUSIC_SRC = path.join(REPO_ROOT, "devo/assets/ambient-calm.m4a")
// Calm, mature female narration (Azure) — the shared devotional voice.
const VOICE = process.env.DEVO_VOICE ?? "en-US-CoraMultilingualNeural"
const PITCH = process.env.DEVO_PITCH ?? "-7%"
const RATE = process.env.DEVO_RATE ?? "-8%"
// Mirror of the composition's timing (timing.ts ÷ 30fps): how long each card is
// actually on screen, so the per-card film windows line up end-to-end.
const TAIL_SEC = 0.4 // CARD_TAIL_FRAMES
const INTRO_SEC = 0.8 // INTRO_HOLD_FRAMES (first card only)
const OUTRO_SEC = 8.0 // OUTRO_HOLD_FRAMES (last card only)

function cutSegment(
  src: string,
  startSec: number,
  lenSec: number,
  outPath: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const c = spawn(
      "ffmpeg",
      [
        "-y",
        "-ss",
        startSec.toFixed(3),
        "-i",
        src,
        "-t",
        lenSec.toFixed(3),
        "-an",
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
        outPath,
      ],
      { stdio: "ignore" },
    )
    c.on("error", reject)
    c.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg cut failed (${code})`)),
    )
  })
}

async function main(): Promise<void> {
  const { generateVoiceover } = await import("../services/devotional/voiceover")

  const outDir = path.join(REPO_ROOT, "devo/artifacts/design")
  await mkdir(outDir, { recursive: true })

  // Video-card clip (the detected snippet) — plays clear, with its own audio.
  await copyFile(VIDEO_CARD_SRC, path.join(outDir, "videocard.mp4"))
  const videoDur =
    (await probeDuration(path.join(outDir, "videocard.mp4"))) ?? 12

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
      console.log(`  ${i} video: ${videoDur.toFixed(1)}s (clip audio)`)
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

  // Continuous background: walk the film outward from the video-card snippet.
  // How long each card is on screen (drives its film-window length):
  const lastIndex = cards.length - 1
  const videoIndex = cards.findIndex((c) => c.kind === "video")
  // `visible` includes holdSec so an extended card keeps its background PLAYING.
  const visible = cards.map(
    (c, i) =>
      (c.durationSec as number) +
      ((c.holdSec as number) ?? 0) +
      TAIL_SEC +
      (i === 0 ? INTRO_SEC : 0) +
      (i === lastIndex ? OUTRO_SEC : 0),
  )
  const filmStart = new Array<number>(cards.length).fill(0)
  // BEFORE the video card: walk backward so scripture ends exactly at the
  // snippet start and the cover leads into the scripture.
  let anchor = SNIPPET_START
  for (let i = videoIndex - 1; i >= 0; i--) {
    filmStart[i] = anchor - visible[i]
    anchor = filmStart[i]
  }
  // AFTER the video card: walk forward from the snippet's end.
  anchor = SNIPPET_START + videoDur
  for (let i = videoIndex + 1; i < cards.length; i++) {
    filmStart[i] = anchor
    anchor += visible[i]
  }

  const filmDur = (await probeDuration(FILM_SRC)) ?? 0
  const usable = filmDur || 600
  console.log(`Cutting continuous background from the film (${filmDur}s)…`)
  for (let i = 0; i < cards.length; i++) {
    if (i === videoIndex) continue
    const len = visible[i] + 1 // +1s buffer for the crossfade tail
    // Wrap into [0, usable): footage before 0 / past the end reuses any snippet.
    let start = ((filmStart[i] % usable) + usable) % usable
    if (start + len > usable) start = Math.max(0, usable - len)
    const bgFile = `bg-${i}.mp4`
    await cutSegment(FILM_SRC, start, len, path.join(outDir, bgFile))
    cards[i].bgFile = bgFile
    console.log(
      `  ${i} ${cards[i].kind}: film ${start.toFixed(1)}–${(start + len).toFixed(1)}s`,
    )
  }

  // Music bed (best-effort — skip if the track is missing).
  let musicFile: string | undefined
  try {
    await copyFile(MUSIC_SRC, path.join(outDir, "music.m4a"))
    musicFile = "music.m4a"
    console.log(`  music: music.m4a`)
  } catch {
    console.warn(`  ! music track not found at ${MUSIC_SRC} — skipping bed`)
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
    `\n✅ manifest: ${path.join(outDir, "manifest.json")}  (${total.toFixed(1)}s)`,
  )
  console.log(
    `\nRender (per style):\n  node apps/shorts-worker/scripts/render-devotional-video.mjs --manifest=devo/artifacts/design/manifest.json --style=grain --out=devo/artifacts/video/design-grain.mp4`,
  )
}

main().catch((e) => {
  console.error("author failed:", e)
  process.exitCode = 1
})
