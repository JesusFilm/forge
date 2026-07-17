#!/usr/bin/env tsx
/**
 * Build a per-card audio manifest for a synced devotional video (Option A).
 *
 * Reads a persisted devotional report, splits it into one spoken segment per
 * card, synthesizes ONE narration snippet per segment (Azure TTS), measures
 * each snippet's exact length, and writes a manifest the Remotion renderer uses
 * to time each card to its own audio — so picture and voice can't drift.
 *
 * Usage (from the repo root):
 *   pnpm --filter @forge/mastra devo:segments -- --date=2026-12-25
 *
 * Output: devo/artifacts/segments/<date>/{seg-N.mp3, manifest.json}
 * Then render with:
 *   node apps/shorts-worker/scripts/render-devotional-video.mjs \
 *     --manifest=devo/artifacts/segments/<date>/manifest.json \
 *     --out=devo/artifacts/video/<date>-synced.mp4
 */
import { spawn } from "node:child_process"
import { readFileSync } from "node:fs"
import { mkdir, writeFile } from "node:fs/promises"
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
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eq = trimmed.indexOf("=")
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (key && process.env[key] === undefined) process.env[key] = value
  }
}

loadEnvFile(path.join(MASTRA_DIR, ".env.local"))
loadEnvFile(path.join(REPO_ROOT, ".env.local"))
if (process.env.DEVOTIONAL_ARTIFACT_DIR === undefined) {
  process.env.DEVOTIONAL_ARTIFACT_DIR = path.join(
    REPO_ROOT,
    "devo",
    "artifacts",
  )
}

function arg(name: string): string | undefined {
  const flag = `--${name}=`
  return process.argv.find((a) => a.startsWith(flag))?.slice(flag.length)
}

function probeDuration(file: string): Promise<number | null> {
  return new Promise((resolve) => {
    const child = spawn("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=nw=1:nk=1",
      file,
    ])
    let out = ""
    child.stdout.on("data", (d) => (out += d.toString()))
    child.on("error", () => resolve(null))
    child.on("close", () => {
      const v = Number.parseFloat(out.trim() || "")
      resolve(Number.isFinite(v) && v > 0 ? v : null)
    })
  })
}

async function main(): Promise<void> {
  const date = arg("date")
  if (!date) throw new Error("missing --date=YYYY-MM-DD")

  const { devotionalArtifactRoot } =
    await import("../services/devotional/artifacts")
  const { buildDevotionalSegments } =
    await import("../services/devotional/video-segments")
  const { generateVoiceover } = await import("../services/devotional/voiceover")

  const root = devotionalArtifactRoot()
  const report = JSON.parse(
    readFileSync(path.join(root, "reports", `${date}.json`), "utf8"),
  )
  const devotional = report.devotional ?? report
  const segments = buildDevotionalSegments(devotional)

  const outDir = path.join(root, "segments", date)
  await mkdir(outDir, { recursive: true })

  console.log(`Synthesizing ${segments.length} per-card snippets for ${date}…`)
  const manifestSegments: Array<{
    kind: string
    lines: string[]
    audioFile: string
    durationSec: number
  }> = []

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]
    const result = await generateVoiceover({ text: seg.spokenText })
    if (!result.ok) {
      throw new Error(
        `voiceover failed for segment ${i} (${seg.kind}): ${result.reason}`,
      )
    }
    const audioFile = `seg-${i}.mp3`
    const filePath = path.join(outDir, audioFile)
    await writeFile(filePath, result.audio.bytes)
    const durationSec = (await probeDuration(filePath)) ?? 3
    console.log(`  ${i} ${seg.kind}: ${durationSec.toFixed(2)}s`)
    manifestSegments.push({
      kind: seg.kind,
      lines: seg.lines,
      audioFile,
      durationSec,
    })
  }

  const manifest = {
    schemaVersion: "1",
    date,
    accentColor: "#E8B65A",
    segments: manifestSegments,
  }
  const manifestPath = path.join(outDir, "manifest.json")
  await writeFile(
    manifestPath,
    JSON.stringify(manifest, null, 2) + "\n",
    "utf8",
  )

  const total = manifestSegments.reduce((s, x) => s + x.durationSec, 0)
  console.log(
    `\n✅ manifest: ${manifestPath}\n   ${manifestSegments.length} cards, ${total.toFixed(1)}s of narration`,
  )
  console.log(
    `\nRender it:\n  node apps/shorts-worker/scripts/render-devotional-video.mjs \\\n    --manifest=${path.relative(REPO_ROOT, manifestPath)} \\\n    --out=devo/artifacts/video/${date}-synced.mp4`,
  )
}

main().catch((error) => {
  console.error("manifest build failed:", error)
  process.exitCode = 1
})
