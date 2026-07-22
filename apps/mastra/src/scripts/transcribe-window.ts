/**
 * Window-picker helper: transcribe a JESUS-film chapter AROUND its curated
 * video-card window so the start/end can be set on real SENTENCE boundaries
 * (owner rule: the clip must not start/end mid-sentence). Downloads the film
 * from the Arclight public API, transcribes the window region with whisper.cpp,
 * and prints each line with its FILM timestamp plus a flag for how cleanly the
 * current window edges land.
 *
 *   pnpm --filter @forge/mastra exec tsx src/scripts/transcribe-window.ts --chapter=19
 */
import { spawn } from "node:child_process"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { passageForChapter } from "../services/devotional/jesus-film-passages"
import { repoRoot } from "../services/devotional/repo-root"

function arg(name: string, fallback?: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}

function sh(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const c = spawn(cmd, args, { stdio: ["ignore", "ignore", "inherit"] })
    c.on("error", reject)
    c.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} exit ${code}`)),
    )
  })
}

function capture(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const c = spawn(cmd, args)
    let out = ""
    c.stdout.on("data", (d) => (out += d.toString()))
    c.on("error", reject)
    // Reject on a nonzero exit so a whisper-cli that dies partway (OOM, missing
    // model) surfaces as an error instead of a silently-truncated transcript.
    c.on("close", (code) =>
      code === 0 ? resolve(out) : reject(new Error(`${cmd} exit ${code}`)),
    )
  })
}

async function arclightUrl(id: string): Promise<string> {
  const res = await fetch(
    `https://api.arclight.org/v2/media-components/${id}/languages/529?platform=web`,
  )
  const json = (await res.json()) as {
    downloadUrls?: { high?: { url?: string }; low?: { url?: string } }
  }
  const url = json.downloadUrls?.high?.url ?? json.downloadUrls?.low?.url
  if (!url) throw new Error(`no download url for ${id}`)
  return url
}

/** Parse whisper-cli "[hh:mm:ss.mmm --> ...] text" lines → {start, text}. */
function parseWhisper(raw: string): Array<{ start: number; text: string }> {
  const out: Array<{ start: number; text: string }> = []
  for (const line of raw.split("\n")) {
    const m = line.match(/\[(\d\d):(\d\d):(\d\d)\.(\d\d\d)\s*-->.*?\]\s*(.*)/)
    if (!m) continue
    const start =
      Number(m[1]) * 3600 +
      Number(m[2]) * 60 +
      Number(m[3]) +
      Number(m[4]) / 1000
    out.push({ start, text: m[5].trim() })
  }
  return out
}

async function main() {
  const chapter = Number(arg("chapter", "19"))
  const win = passageForChapter(chapter)
  if (!win) throw new Error(`no passage mapping for chapter ${chapter}`)
  const id = `1_jf61${String(chapter).padStart(2, "0")}-0-0`
  const start = win.clipStartSec ?? 0
  const len = win.clipLengthSec ?? 40
  // Transcribe a padded region around the window so we can see the sentence
  // just before the start and just after the end.
  const from = Math.max(0, start - 5)
  const span = len + 12

  const root = repoRoot()
  const whisper = path.join(root, ".cache/whisper/build/bin/whisper-cli")
  const model = path.join(root, ".cache/whisper/models/ggml-base.en.bin")

  const stage = await mkdtemp(path.join(tmpdir(), "transcribe-"))
  try {
    const film = path.join(stage, "full.mp4")
    const wav = path.join(stage, "clip.wav")
    console.log(`ch${chapter} (${id}) — downloading…`)
    await sh("curl", ["-sL", "-o", film, await arclightUrl(id)])
    await sh("ffmpeg", [
      "-y",
      "-loglevel",
      "error",
      "-ss",
      String(from),
      "-t",
      String(span),
      "-i",
      film,
      "-ar",
      "16000",
      "-ac",
      "1",
      wav,
    ])
    const raw = await capture(whisper, ["-m", model, "-f", wav, "-l", "en"])
    const lines = parseWhisper(raw).map((l) => ({
      fileSec: +(from + l.start).toFixed(2),
      text: l.text,
    }))

    const report = [
      `chapter ${chapter}  ${win.reference}`,
      `current window: start ${start}s, length ${len}s (end ${start + len}s)`,
      ``,
      ...lines.map(
        (l) =>
          `${String(l.fileSec).padStart(7)}s ${l.fileSec >= start && l.fileSec < start + len ? "│" : " "} ${l.text}`,
      ),
    ].join("\n")
    const outDir = path.join(root, "devo", "transcripts")
    await sh("mkdir", ["-p", outDir])
    await writeFile(path.join(outDir, `ch${chapter}.txt`), report + "\n")
    console.log(report)
    console.log(`\n→ devo/transcripts/ch${chapter}.txt`)
  } finally {
    // Clean up the downloaded film on the failure path too (main's catch calls
    // process.exit without cleanup otherwise).
    await rm(stage, { recursive: true, force: true }).catch(() => {})
  }
}

main().catch((e) => {
  console.error("transcribe-window failed:", e instanceof Error ? e.message : e)
  process.exit(1)
})
