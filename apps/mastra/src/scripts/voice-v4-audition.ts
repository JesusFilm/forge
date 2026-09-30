/**
 * Audition the montage opening on Eleven v4 (owner, 2026-09-30): the story
 * voice is right for the reflection but flat for the teaser. Writes one mp3
 * per variant plus the word times ElevenLabs returns, into --out.
 *
 *   pnpm exec tsx --env-file=.env.local src/scripts/voice-v4-audition.ts --out=<dir>
 */
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"

import { getElevenLabsConfig } from "../config/env"
import { generateElevenVoiceover } from "../services/devotional/elevenlabs-voiceover"

const out =
  process.argv.find((a) => a.startsWith("--out="))?.split("=")[1] ?? "."
const LINES = [
  "A faithful son stands outside his father's party.",
  "His brother squandered it all and wears the best robe.",
  "In this devotional, one word in the father's reply about the feast.",
  "The father steps out to him.",
  "Let's watch.",
]
const TAGS = [
  "[low, drawing the listener in]",
  "[a little sharper, a hint of injustice]",
  "[quieter, leaning in]",
  "[gently, warm]",
  "[softly]",
]
const VARIANTS: { name: string; text: string }[] = [
  { name: "B-v4-plain", text: LINES.join("\n\n") },
  {
    name: "C-v4-line-tags",
    text: LINES.map((l, i) => `${TAGS[i]} ${l}`).join("\n\n"),
  },
  {
    name: "D-v4-one-direction",
    text:
      "[a warm film narrator, restrained intensity, never theatrical] " +
      LINES.join("\n\n"),
  },
]

async function main() {
  await mkdir(out, { recursive: true })
  const config = { ...getElevenLabsConfig(), ttsModel: "eleven_v4" }
  for (const v of VARIANTS) {
    const r = await generateElevenVoiceover({
      text: v.text,
      voice: "male-e",
      config,
      withTimestamps: true,
      timeoutMs: 120_000,
    })
    if (!r.ok) {
      console.log(`${v.name}: FAILED ${r.reason} ${r.details ?? ""}`)
      continue
    }
    await writeFile(path.join(out, `${v.name}.mp3`), r.audio.bytes)
    await writeFile(
      path.join(out, `${v.name}.words.json`),
      JSON.stringify(r.audio.words ?? [], null, 1),
    )
    console.log(
      `${v.name}: ok, ${r.audio.words?.length ?? 0} word times, model ${r.audio.model}`,
    )
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
