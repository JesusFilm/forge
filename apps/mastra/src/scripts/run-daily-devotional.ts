#!/usr/bin/env tsx
/**
 * Local end-to-end runner for the daily-devotional pipeline.
 *
 * Runs the full workflow (hook → scripture → video → write → safety → voiceover
 * → persist) against your local config and prints where the JSON report and the
 * narration MP3 landed, so you can read and listen to a real result without any
 * deploy.
 *
 * Usage (from the repo root):
 *   pnpm --filter @forge/mastra devo:run
 *   pnpm --filter @forge/mastra devo:run -- --date=2026-12-25
 *   pnpm --filter @forge/mastra devo:run -- --no-persist
 *
 * Config (apps/mastra/.env.local — auto-loaded by this script):
 *   OPENROUTER_API_KEY   required — the hook/scripture/writer/safety LLM calls
 *   AZURE_SPEECH_KEY     optional — set it to get narration audio (else skipped)
 *   AZURE_SPEECH_REGION  optional — e.g. eastus
 *   FIRECRAWL_API_KEY    optional — set it to get a live world-news hook
 *                        (without it the hook falls back to holiday/question)
 *
 * No admin access is needed: the video step degrades to "none" without the
 * admin search config, so the rest of the pipeline still runs.
 */
import { readFileSync } from "node:fs"
import path from "node:path"

// --- env bootstrap ---------------------------------------------------------
// config/env validates process.env at import time, so populate it FIRST, before
// any import that pulls in the env module. A tiny .env parser keeps this script
// dependency-free.

const SCRIPT_DIR = path.dirname(new URL(import.meta.url).pathname)
const MASTRA_DIR = path.resolve(SCRIPT_DIR, "../..")
const REPO_ROOT = path.resolve(MASTRA_DIR, "../..")

function loadEnvFile(filePath: string): void {
  let raw: string
  try {
    raw = readFileSync(filePath, "utf8")
  } catch {
    return // file absent — fine
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

// Keep all local artifacts together under devo/ unless overridden.
if (process.env.DEVOTIONAL_ARTIFACT_DIR === undefined) {
  process.env.DEVOTIONAL_ARTIFACT_DIR = path.join(
    REPO_ROOT,
    "devo",
    "artifacts",
  )
}

// --- arg parsing -----------------------------------------------------------

function parseFlag(name: string): string | undefined {
  const flag = `--${name}=`
  const hit = process.argv.find((a) => a.startsWith(flag))
  return hit?.slice(flag.length)
}

const date = parseFlag("date")
const persistArtifact = !process.argv.includes("--no-persist")

// --- run -------------------------------------------------------------------

async function main(): Promise<void> {
  // Dynamic import so the env bootstrap above runs before config/env loads.
  const { runDailyDevotional } =
    await import("../mastra/workflows/daily-devotional")
  const { devotionalArtifactRoot } =
    await import("../services/devotional/artifacts")
  const { createLocalVideoMatcher } =
    await import("../services/devotional/local-video-matcher")

  // Local dev can't reach the admin video-search API, so pick a JESUS chapter
  // from the local 61-chapter catalog instead (unless --admin-video is passed).
  const useLocalVideo = !process.argv.includes("--admin-video")

  // Optionally adapt a SPECIFIC partner devotional (e.g. a Cru page): fetch it
  // and feed it to the writer as grounding so the reflection is adapted from it.
  const partnerUrl = parseFlag("partner-url")

  console.log("Running daily-devotional pipeline locally…")
  console.log(`  date:            ${date ?? "(today)"}`)
  console.log(`  persistArtifact: ${persistArtifact}`)
  console.log(
    `  OPENROUTER_API_KEY: ${process.env.OPENROUTER_API_KEY ? "set" : "MISSING (LLM steps will fail)"}`,
  )
  console.log(
    `  FIRECRAWL_API_KEY:  ${process.env.FIRECRAWL_API_KEY ? "set → live news hook" : "unset → holiday/question hook"}`,
  )
  console.log(
    `  AZURE_SPEECH_KEY:   ${process.env.AZURE_SPEECH_KEY ? "set → voiceover on" : "unset → voiceover skipped"}`,
  )
  console.log(
    `  video source:       ${useLocalVideo ? "local 61-chapter catalog (LLM pick)" : "admin search"}`,
  )

  // deps for the run: local video matcher + optional partner-devotional grounding.
  const deps: Record<string, unknown> = {}
  if (useLocalVideo) deps.matchVideo = createLocalVideoMatcher()

  if (partnerUrl) {
    const { fetchPartnerDevotional, toGroundingSnippet } =
      await import("../services/devotional/partner-devotional")
    const { writeDevotional } =
      await import("../services/devotional/devotional-writer")
    const fetched = await fetchPartnerDevotional({ url: partnerUrl })
    if (fetched.ok) {
      const host = new URL(partnerUrl).hostname.replace(/^www\./, "")
      const snippet = toGroundingSnippet(fetched.devotional)
      console.log(
        `  partner source:     adapting "${fetched.devotional.title ?? partnerUrl}" (${host})`,
      )
      deps.writeDevotional = (opts: Parameters<typeof writeDevotional>[0]) =>
        writeDevotional({
          ...opts,
          partnerDomains: [host],
          grounding: async () => [snippet],
        })
    } else {
      console.log(
        `  partner source:     FAILED to fetch (${fetched.reason}) — continuing without it`,
      )
    }
  }
  console.log("")

  const result = await runDailyDevotional(
    { ...(date ? { date } : {}), persistArtifact },
    deps,
  )

  console.log("─".repeat(60))
  if (!result.ok) {
    console.error(
      `FAILED: ${result.reason}` +
        (result.stage ? ` (stage: ${result.stage})` : ""),
    )
    if (result.details) console.error(`  details: ${result.details}`)
    process.exitCode = 1
    return
  }

  const d = result.devotional
  console.log(`✅ devotional for ${result.date}`)
  console.log(`  hook (${d.hook.type}): ${d.hook.title}`)
  console.log(`    ${d.hook.summary}`)
  if (d.hook.sourceUrl) console.log(`    source: ${d.hook.sourceUrl}`)
  console.log(`  scripture: ${d.scripture.reference} — “${d.scripture.text}”`)
  console.log(
    `  video match: ${result.videoMatch}` +
      (d.video ? ` → ${d.video.title} (${d.video.url})` : ""),
  )
  console.log(`  reflection: ${d.reflection}`)
  if (d.questions.length)
    console.log(
      `  questions:\n${d.questions.map((q) => `    • ${q}`).join("\n")}`,
    )
  console.log(`  block order: ${d.blockOrder.join(" → ")}`)
  console.log(
    `  safety: ${result.safety.verdict} (doctrine ${result.safety.scores.doctrine}, tone ${result.safety.scores.tone}, sensitivity ${result.safety.scores.sensitivity})`,
  )
  console.log(`  published: ${result.published}`)
  console.log("")

  const root = devotionalArtifactRoot()
  if (result.artifactPath) {
    console.log(`📄 report JSON: ${result.artifactPath}`)
  }
  const audioAbs = result.voiceoverPath
    ? path.join(root, result.voiceoverPath)
    : undefined
  if (audioAbs) {
    console.log(`🔊 narration MP3: ${audioAbs}`)
    console.log(`   play it:  open "${audioAbs}"   (macOS)`)
  } else {
    console.log(
      "🔇 no narration MP3 (voiceover skipped or failed — see AZURE_SPEECH_KEY)",
    )
  }

  // --assemble: stitch the cards + narration into an actual MP4.
  if (process.argv.includes("--assemble")) {
    const { assembleDevotionalVideo } =
      await import("../services/devotional/video-assembler")
    const bgVideo = parseFlag("bg-video")
    const outPath = path.join(root, "video", `${result.date}.mp4`)
    console.log("\n🎬 assembling video…")
    try {
      const video = await assembleDevotionalVideo({
        devotional: d,
        ...(audioAbs ? { audioPath: audioAbs } : {}),
        ...(bgVideo ? { backgroundVideoPath: bgVideo } : {}),
        outPath,
      })
      console.log(
        `🎬 video [${video.mode}]: ${video.path}  (${video.cardCount} cards, ${video.durationSec.toFixed(1)}s)`,
      )
      console.log(`   play it:  open "${video.path}"   (macOS)`)
      if (video.storyboardPath) {
        console.log(
          `🃏 cards (this ffmpeg can't burn text): ${video.storyboardPath}`,
        )
        console.log(`   view it:  open "${video.storyboardPath}"   (macOS)`)
      }
    } catch (error) {
      console.error(
        `🎬 assembly failed: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
}

main().catch((error) => {
  console.error("Unexpected error:", error)
  process.exitCode = 1
})
