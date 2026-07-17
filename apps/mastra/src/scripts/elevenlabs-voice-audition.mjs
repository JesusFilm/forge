#!/usr/bin/env node
/**
 * Audition deep / emotive / calm male voices for the devotional narration, and
 * generate one simple ambient music bed. Same line in every voice so they're
 * directly comparable. Files land on the Desktop.
 *
 *   node --env-file=apps/mastra/.env.local apps/mastra/src/scripts/elevenlabs-voice-audition.mjs
 */
import { mkdir, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"

const API = "https://api.elevenlabs.io"
const KEY = process.env.ELEVENLABS_API_KEY
const OUT = path.join(homedir(), "Desktop", "voice-options")

// One emotive, calm devotional line — enough range to hear warmth + depth.
const LINE =
  "When the storm rises and your heart is weary, remember — He is with you in the boat. Be still, and know that He is God."

// Round 2 — three more in the Daniel/Brian lane (deep, calm, mature narrator).
const START_INDEX = 6
const VOICES = [
  { id: "JBFqnCBsd6RMkjVDRZzb", name: "George", note: "mature British, warm — Daniel neighbor" },
  { id: "CwhRBWXzGAHq8TQ4Fs17", name: "Roger", note: "confident middle-aged American — Brian neighbor" },
  { id: "TxGEqnHWrfWFTfGW9XjX", name: "Josh", note: "deep American, steady" },
]

// Calm delivery: higher stability, no stylistic exaggeration.
const VOICE_SETTINGS = {
  stability: 0.55,
  similarity_boost: 0.8,
  style: 0.0,
  use_speaker_boost: true,
}

function die(m) {
  console.error(`\n❌ ${m}`)
  process.exit(1)
}
async function grab(name, res) {
  if (!res.ok) {
    const b = await res.text().catch(() => "")
    die(`${name}: HTTP ${res.status}\n${b.slice(0, 600)}`)
  }
  const bytes = new Uint8Array(await res.arrayBuffer())
  if (!bytes.byteLength) die(`${name}: empty`)
  const file = path.join(OUT, name)
  await writeFile(file, bytes)
  console.log(`  ✓ ${name}  (${(bytes.byteLength / 1024).toFixed(0)} KB)`)
}

async function main() {
  if (!KEY) die("ELEVENLABS_API_KEY not set")
  await mkdir(OUT, { recursive: true })

  console.log("Voices:")
  let i = START_INDEX
  for (const v of VOICES) {
    await grab(
      `voice-${i}-${v.name.toLowerCase()}.mp3`,
      await fetch(`${API}/v1/text-to-speech/${v.id}?output_format=mp3_44100_128`, {
        method: "POST",
        headers: { "xi-api-key": KEY, "Content-Type": "application/json" },
        body: JSON.stringify({
          text: LINE,
          model_id: "eleven_multilingual_v2",
          voice_settings: VOICE_SETTINGS,
        }),
      }),
    )
    i++
  }

  // Music already approved — voices only this round.
  console.log(`\n✅ Done → ${OUT}`)
  console.log(
    VOICES.map((v, n) => `   ${START_INDEX + n}. ${v.name} — ${v.note}`).join("\n"),
  )
}

main().catch((e) => die(e instanceof Error ? e.message : String(e)))
