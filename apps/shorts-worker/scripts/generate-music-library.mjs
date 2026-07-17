#!/usr/bin/env node
/**
 * Generate the devotional ambient music library ONCE (~20 tracks) via the
 * ElevenLabs Music API, and write a manifest the pipeline reads to pick a
 * mood-matched bed. Reusing this library avoids a music credit on every run.
 *
 * Output: devo/assets/music/<mood>-<n>.mp3 + devo/assets/music/manifest.json
 *
 * Run (reads the key from apps/mastra/.env.local):
 *   node --env-file=apps/mastra/.env.local apps/shorts-worker/scripts/generate-music-library.mjs
 *
 * Idempotent-ish: skips a track whose mp3 already exists (so a re-run only fills
 * gaps / resumes after a failure) unless --force is passed.
 */
import { mkdir, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, "../../..")
const OUT_DIR = path.join(REPO_ROOT, "devo/assets/music")
const API = "https://api.elevenlabs.io"
const KEY = process.env.ELEVENLABS_API_KEY
const FORCE = process.argv.includes("--force")

const TRACKS_PER_MOOD = 5
const LENGTH_MS = 30_000

// Ambient / calm / simple base prompts, one per mood. Small per-track variation
// suffixes keep the five tracks of a mood distinct without changing character.
const MOODS = {
  peace:
    "Ambient calm pad. Soft, sustained warm tones. Gentle, minimal, spacious. No melody line, no drums, no percussion, no vocals. Peaceful, meditative, still.",
  hope: "Ambient warm pad, quietly hopeful. Soft sustained tones with a gentle lift. Minimal and spacious. No melody line, no drums, no percussion, no vocals. Tender and uplifting.",
  lament:
    "Ambient somber pad. Soft, low sustained tones, slow and reflective. Minimal and spacious. No melody line, no drums, no percussion, no vocals. Tender, aching, prayerful.",
  awe: "Ambient reverent pad. Soft sustained tones with quiet depth and space. Minimal. No melody line, no drums, no percussion, no vocals. Still, holy, expansive.",
}
const VARIATIONS = [
  "Warm analog texture.",
  "Airy, distant, with gentle space.",
  "Very soft, low in the mix.",
  "Slightly brighter, glassy tones.",
  "Deep and rounded, felt more than heard.",
]

async function exists(p) {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}

async function generateTrack(mood, prompt, dest) {
  // NB: the Music API rejects `seed` when a `prompt` is given ("`seed` cannot
  // be used with `prompt`"). Variety comes from the per-track prompt variation
  // (and generation is non-deterministic), so no seed is passed.
  const r = await fetch(`${API}/v1/music?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt,
      music_length_ms: LENGTH_MS,
      force_instrumental: true,
    }),
  })
  if (!r.ok) {
    throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`)
  }
  const bytes = new Uint8Array(await r.arrayBuffer())
  if (bytes.byteLength === 0) throw new Error("empty audio")
  await writeFile(dest, bytes)
  return bytes.byteLength
}

async function main() {
  if (!KEY) {
    console.error("ELEVENLABS_API_KEY not set (use --env-file=apps/mastra/.env.local)")
    process.exit(1)
  }
  await mkdir(OUT_DIR, { recursive: true })
  const tracks = []
  let made = 0
  let skipped = 0

  for (const [mood, base] of Object.entries(MOODS)) {
    for (let n = 1; n <= TRACKS_PER_MOOD; n++) {
      const file = `${mood}-${n}.mp3`
      const dest = path.join(OUT_DIR, file)
      const prompt = `${base} ${VARIATIONS[(n - 1) % VARIATIONS.length]}`
      tracks.push({ file, mood, prompt, lengthMs: LENGTH_MS })
      if (!FORCE && (await exists(dest))) {
        skipped++
        console.log(`  ↷ skip ${file} (exists)`)
        continue
      }
      try {
        const size = await generateTrack(mood, prompt, dest)
        made++
        console.log(`  ✓ ${file}  (${(size / 1024).toFixed(0)} KB)`)
      } catch (e) {
        console.error(`  ✗ ${file}: ${e instanceof Error ? e.message : e}`)
      }
    }
  }

  const manifest = { version: 1, tracks }
  await writeFile(
    path.join(OUT_DIR, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
    "utf8",
  )
  console.log(
    `\n✅ library: ${made} generated, ${skipped} skipped, ${tracks.length} in manifest → ${path.relative(REPO_ROOT, OUT_DIR)}`,
  )
}

main().catch((e) => {
  console.error("music library generation failed:", e instanceof Error ? e.message : e)
  process.exitCode = 1
})
