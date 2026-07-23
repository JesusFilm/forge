#!/usr/bin/env node
/**
 * Experimental subtitle bot for daily-devotional video cards.
 *
 * Transcribes the video card's OWN audio (the JESUS Film clip's dialogue) with
 * whisper.cpp, groups the segments into clean caption cues, and writes them
 * back into the manifest's video card as a `subtitles` array. The composition
 * (packages/shorts-compositions/src/devotional) renders those cues in the dark
 * band just below the fitted video window.
 *
 * Fully automatable: extract → transcribe → group → inject. No hand-authoring.
 * (A colleague is building first-class subtitle editing; this is the stopgap
 * for experimental renders — presence of `subtitles` on the card is the only
 * opt-in, so other devotionals are untouched.)
 *
 * Usage (from the repo root):
 *   node apps/shorts-worker/scripts/add-video-subtitles.mjs \
 *     --manifest=devo/artifacts/hope/manifest.json
 *
 * Env / flags:
 *   --whisper-dir=  whisper.cpp checkout with build/bin/whisper-cli
 *                   (default: .cache/whisper)
 *   --model=        ggml model path (default: <whisper-dir>/ggml-base.en.bin)
 *   --lang=         whisper language (default: en)
 *   --max-chars=    soft cap before starting a new cue (default: 64)
 *   --max-sec=      soft cap on a single cue's on-screen span (default: 4.5)
 */
import { spawn } from "node:child_process"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, "../../..")

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}
function abs(p) {
  return path.isAbsolute(p) ? p : path.join(REPO_ROOT, p)
}
function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const c = spawn(cmd, args, { stdio: "ignore", ...opts })
    c.on("error", reject)
    c.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`)),
    )
  })
}

/**
 * Merge whisper's natural segments into readable caption cues. Natural
 * segmentation already breaks on phrase boundaries; we only coalesce a short
 * trailing fragment into its predecessor when doing so stays within the char
 * and duration caps AND the predecessor didn't already end a sentence.
 */
function groupCues(segments, { maxChars, maxSec }) {
  const cues = []
  for (const s of segments) {
    const text = (s.text ?? "").trim()
    if (!text) continue
    const startSec = s.offsets.from / 1000
    const endSec = s.offsets.to / 1000
    const prev = cues[cues.length - 1]
    const endsSentence = prev ? /[.!?]["')\]]?$/.test(prev.text) : false
    const merged = prev ? `${prev.text} ${text}` : text
    if (
      prev &&
      !endsSentence &&
      merged.length <= maxChars &&
      endSec - prev.startSec <= maxSec
    ) {
      prev.text = merged
      prev.endSec = endSec
    } else {
      cues.push({ text, startSec, endSec })
    }
  }
  return cues
}

async function main() {
  const manifestPath = abs(
    arg("manifest", "devo/artifacts/design/manifest.json"),
  )
  const whisperDir = abs(arg("whisper-dir", ".cache/whisper"))
  const modelPath = abs(arg("model", path.join(whisperDir, "ggml-base.en.bin")))
  const lang = arg("lang", "en")
  const maxChars = Number(arg("max-chars", "64"))
  const maxSec = Number(arg("max-sec", "4.5"))

  const whisperCli = path.join(whisperDir, "build/bin/whisper-cli")
  for (const [label, p] of [
    ["whisper-cli", whisperCli],
    ["model", modelPath],
  ]) {
    if (!existsSync(p))
      throw new Error(`${label} not found: ${p} (pass --whisper-dir / --model)`)
  }

  const manifest = JSON.parse(await readFile(manifestPath, "utf8"))
  const manifestDir = path.dirname(manifestPath)
  const card = manifest.cards.find((c) => c.kind === "video" && c.videoFile)
  if (!card) throw new Error("manifest has no video card with a videoFile")

  const clipPath = path.join(manifestDir, card.videoFile)
  if (!existsSync(clipPath))
    throw new Error(`video clip not found beside manifest: ${clipPath}`)

  const work = await mkdtemp(path.join(tmpdir(), "devo-subs-"))
  try {
    // 1. Extract 16kHz mono PCM (what whisper.cpp expects).
    const wav = path.join(work, "clip.wav")
    await run("ffmpeg", [
      "-y",
      "-i",
      clipPath,
      "-ar",
      "16000",
      "-ac",
      "1",
      "-c:a",
      "pcm_s16le",
      wav,
    ])

    // 2. Transcribe with natural segmentation (no --max-len: whisper breaks on
    //    pauses, which reads far better than token-count splits).
    const outBase = path.join(work, "clip")
    await run(whisperCli, [
      "-m",
      modelPath,
      "-f",
      wav,
      "-l",
      lang,
      "-oj",
      "-of",
      outBase,
    ])
    const tr = JSON.parse(await readFile(`${outBase}.json`, "utf8"))

    // 3. Group into cues and clamp to the card's on-screen length so no caption
    //    lingers past the visible clip.
    let cues = groupCues(tr.transcription ?? [], { maxChars, maxSec })
    const visibleEnd = card.durationSec ?? Infinity
    cues = cues
      .filter((c) => c.startSec < visibleEnd)
      .map((c) => ({
        text: c.text,
        startSec: Number(c.startSec.toFixed(2)),
        endSec: Number(Math.min(c.endSec, visibleEnd).toFixed(2)),
      }))
      .filter((c) => c.endSec > c.startSec)

    // 4. Write back into the manifest.
    card.subtitles = cues
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

    console.log(
      `📝 ${cues.length} cues → ${path.relative(REPO_ROOT, manifestPath)}`,
    )
    for (const c of cues) {
      console.log(
        `  ${c.startSec.toFixed(2)}–${c.endSec.toFixed(2)}  ${c.text}`,
      )
    }
  } finally {
    await rm(work, { recursive: true, force: true })
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
