#!/usr/bin/env node
/**
 * Transcript-driven snippet detector + trimmer.
 *
 * Transcribes a clip's audio locally with whisper.cpp (timestamps), then finds
 * the passage that best matches a concept (e.g. "the birth of Jesus") and trims
 * a window around it. This is the reliable way to locate "where X is described"
 * in a clip — it reads what the narrator actually SAYS, with real timecodes.
 *
 * Matching is semantic when OPENROUTER_API_KEY is set (handles paraphrase like
 * "she wrapped him in cloths and laid him in a manger"), with a deterministic
 * keyword fallback otherwise.
 *
 * Usage (from the repo root):
 *   node apps/shorts-worker/scripts/detect-and-trim-snippet.mjs \
 *     --in="/path/to/clip.mp4" \
 *     --concept="the birth of Jesus" \
 *     --out=devo/artifacts/video/nativity.mp4 \
 *     [--max=15] [--pad=1.5] [--model=base.en]
 *
 * First run installs whisper.cpp + downloads the model into .cache/whisper.
 */
import { spawn } from "node:child_process"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

import {
  downloadWhisperModel,
  installWhisperCpp,
  toCaptions,
  transcribe,
} from "@remotion/install-whisper-cpp"

import { env } from "../src/config/env.ts"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, "../../..")
const WHISPER_VERSION = "1.7.4"
const WHISPER_DIR = path.join(REPO_ROOT, ".cache", "whisper")
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
// Nativity keyword fallback (used when no LLM key is set).
const BIRTH_KEYWORDS = [
  "born",
  "birth",
  "manger",
  "swaddling",
  "wrapped him",
  "cloths",
  "bethlehem",
  "no room",
  "inn",
  "savior",
  "firstborn",
  "child is born",
]

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}
function abs(p) {
  return path.isAbsolute(p) ? p : path.join(REPO_ROOT, p)
}

function run(bin, args) {
  return new Promise((resolve, reject) => {
    const c = spawn(bin, args)
    let stdout = ""
    let stderr = ""
    c.stdout.on("data", (d) => (stdout += d))
    c.stderr.on("data", (d) => (stderr += d))
    c.on("error", reject)
    c.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }))
  })
}

async function probeDuration(file) {
  const { stdout } = await run("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=nw=1:nk=1",
    file,
  ])
  const v = Number.parseFloat(stdout.trim())
  return Number.isFinite(v) ? v : null
}

/** Group token-level captions into ~sentence lines with start/end seconds. */
function toLines(captions) {
  const lines = []
  let cur = null
  for (const c of captions) {
    const text = (c.text ?? "").trim()
    if (!text) continue
    if (!cur) cur = { startMs: c.startMs, endMs: c.endMs, text }
    else {
      cur.text += text.startsWith("'") ? text : ` ${text}`
      cur.endMs = c.endMs
    }
    if (/[.!?]$/.test(text) || cur.text.length > 160) {
      lines.push(cur)
      cur = null
    }
  }
  if (cur) lines.push(cur)
  return lines.map((l) => ({
    startSec: l.startMs / 1000,
    endSec: l.endMs / 1000,
    text: l.text.replace(/\s+/g, " ").trim(),
  }))
}

function keywordPick(lines) {
  let best = null
  for (const l of lines) {
    const lower = l.text.toLowerCase()
    const score = BIRTH_KEYWORDS.filter((k) => lower.includes(k)).length
    if (score > 0 && (!best || score > best.score)) best = { ...l, score }
  }
  return best ? { startSec: best.startSec, endSec: best.endSec } : null
}

async function llmPick(concept, lines) {
  const key = env.OPENROUTER_API_KEY
  if (!key) return null
  const transcript = lines
    .map((l) => `[${l.startSec.toFixed(1)}-${l.endSec.toFixed(1)}] ${l.text}`)
    .join("\n")
  const body = {
    model: env.DEVOTIONAL_MODEL || "anthropic/claude-haiku-4-5",
    messages: [
      {
        role: "system",
        content:
          "You locate a passage in a timecoded transcript. Given a concept, " +
          "return the start and end seconds of the contiguous passage that best " +
          'depicts it. Respond ONLY with JSON: {"startSec":number,"endSec":number}.',
      },
      {
        role: "user",
        content: `Concept: ${concept}\n\nTranscript:\n${transcript}`,
      },
    ],
    temperature: 0,
    max_tokens: 100,
  }
  try {
    const res = await globalThis.fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: globalThis.AbortSignal.timeout(60000),
    })
    if (!res.ok) return null
    const json = await res.json()
    const text = json?.choices?.[0]?.message?.content ?? ""
    const m = text.match(/\{[^}]*\}/)
    if (!m) return null
    const parsed = JSON.parse(m[0])
    if (
      typeof parsed.startSec === "number" &&
      typeof parsed.endSec === "number" &&
      parsed.endSec > parsed.startSec
    ) {
      return { startSec: parsed.startSec, endSec: parsed.endSec }
    }
  } catch {
    /* fall through */
  }
  return null
}

async function main() {
  const inPath = abs(arg("in"))
  const concept = arg("concept", "the birth of Jesus")
  const outPath = abs(arg("out", "devo/artifacts/video/snippet.mp4"))
  const maxSec = Number.parseFloat(arg("max", "15"))
  const padSec = Number.parseFloat(arg("pad", "1.5"))
  const model = arg("model", "base.en")

  console.log(`Setting up whisper.cpp (${WHISPER_DIR})…`)
  // Do NOT pre-create WHISPER_DIR — installWhisperCpp manages it and errors if
  // the folder exists without its executable.
  await installWhisperCpp({ version: WHISPER_VERSION, to: WHISPER_DIR })
  await downloadWhisperModel({ model, folder: WHISPER_DIR })

  const work = await mkdtemp(path.join(tmpdir(), "snippet-"))
  try {
    const wav = path.join(work, "audio.wav")
    console.log("Extracting audio…")
    const ext = await run("ffmpeg", [
      "-y",
      "-i",
      inPath,
      "-ar",
      "16000",
      "-ac",
      "1",
      "-c:a",
      "pcm_s16le",
      wav,
    ])
    if (ext.code !== 0) throw new Error(`ffmpeg audio extract failed`)

    console.log("Transcribing (this can take a couple minutes)…")
    const whisperOut = await transcribe({
      inputPath: wav,
      whisperPath: WHISPER_DIR,
      whisperCppVersion: WHISPER_VERSION,
      model,
      modelFolder: WHISPER_DIR,
      tokenLevelTimestamps: true,
      language: "en",
      printOutput: false,
    })
    const { captions } = toCaptions({ whisperCppOutput: whisperOut })
    const lines = toLines(captions)
    console.log(`  ${lines.length} transcript lines`)

    let window = (await llmPick(concept, lines)) ?? keywordPick(lines)
    if (!window) {
      throw new Error(
        `could not locate "${concept}" in the transcript (no keyword/LLM match)`,
      )
    }

    const duration = (await probeDuration(inPath)) ?? window.endSec
    let start = Math.max(0, window.startSec - padSec)
    let end = Math.min(duration, window.endSec + padSec)
    if (end - start > maxSec) end = start + maxSec
    const dur = Math.max(1, end - start)

    // Show the matched passage so it's verifiable.
    console.log(`\nMatched window: ${start.toFixed(1)}s → ${end.toFixed(1)}s`)
    for (const l of lines) {
      if (l.endSec >= window.startSec && l.startSec <= window.endSec) {
        console.log(`  [${l.startSec.toFixed(1)}] ${l.text}`)
      }
    }

    await mkdir(path.dirname(outPath), { recursive: true })
    console.log(`\nTrimming ${dur.toFixed(1)}s → ${outPath}`)
    const trim = await run("ffmpeg", [
      "-y",
      "-ss",
      String(start),
      "-t",
      String(dur),
      "-i",
      inPath,
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "21",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      "160k",
      outPath,
    ])
    if (trim.code !== 0)
      throw new Error(`ffmpeg trim failed: ${trim.stderr.slice(-300)}`)
    console.log(`\n✅ done: ${outPath}`)
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => {})
  }
}

main().catch((err) => {
  console.error("detect failed:", err)
  process.exitCode = 1
})
