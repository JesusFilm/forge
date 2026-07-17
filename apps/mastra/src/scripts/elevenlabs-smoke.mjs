#!/usr/bin/env node
/**
 * ElevenLabs smoke test — proves the API key + its two permissions work before
 * we build the real voiceover/music steps on top of it.
 *
 *   1. Text to Speech  → ~1 sentence of narration  (voiceover permission)
 *   2. Music Generation → ~10s instrumental bed      (music permission)
 *
 * Both files land on your Desktop so you can play them.
 *
 * Run (reads the key from apps/mastra/.env.local):
 *   node --env-file=apps/mastra/.env.local apps/mastra/src/scripts/elevenlabs-smoke.mjs
 */
import { mkdir, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"

const API = "https://api.elevenlabs.io"
const KEY = process.env.ELEVENLABS_API_KEY
const OUT_DIR = path.join(homedir(), "Desktop", "elevenlabs-smoke")

// A calm ElevenLabs stock voice ("George") — fine for a smoke test; we pick the
// real devotional voice later.
const VOICE_ID = "JBFqnCBsd6RMkjVDRZzb"

function die(msg) {
  console.error(`\n❌ ${msg}`)
  process.exit(1)
}

async function save(name, res) {
  if (!res.ok) {
    const body = await res.text().catch(() => "")
    die(`${name} failed: HTTP ${res.status}\n${body.slice(0, 800)}`)
  }
  const bytes = new Uint8Array(await res.arrayBuffer())
  if (bytes.byteLength === 0) die(`${name}: empty response`)
  const file = path.join(OUT_DIR, name)
  await writeFile(file, bytes)
  console.log(`  ✓ ${name}  (${(bytes.byteLength / 1024).toFixed(0)} KB)  → ${file}`)
}

async function main() {
  if (!KEY) {
    die(
      "ELEVENLABS_API_KEY is not set.\n" +
        "Add it to apps/mastra/.env.local and run with --env-file=apps/mastra/.env.local",
    )
  }
  await mkdir(OUT_DIR, { recursive: true })

  console.log("① Text to Speech …")
  await save(
    "01-voiceover.mp3",
    await fetch(
      `${API}/v1/text-to-speech/${VOICE_ID}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: { "xi-api-key": KEY, "Content-Type": "application/json" },
        body: JSON.stringify({
          text: "Be still, and know that I am God. This is a test of the daily devotional voice.",
          model_id: "eleven_multilingual_v2",
        }),
      },
    ),
  )

  console.log("② Music Generation …")
  await save(
    "02-music.mp3",
    await fetch(`${API}/v1/music?output_format=mp3_44100_128`, {
      method: "POST",
      headers: { "xi-api-key": KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt:
          "Calm, warm, cinematic worship instrumental. Soft piano and gentle strings, slow and reflective, no drums, no vocals. Peaceful and hopeful.",
        music_length_ms: 10_000,
        force_instrumental: true,
      }),
    }),
  )

  console.log(`\n✅ Both endpoints work. Files in: ${OUT_DIR}`)
}

main().catch((e) => die(e instanceof Error ? e.message : String(e)))
