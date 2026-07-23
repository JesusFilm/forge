/**
 * Integration smoke for the real service functions (not mocked) — proves the
 * env config + generateElevenVoiceover + generateMusic wire up against the live
 * ElevenLabs API. Writes both files to the Desktop.
 *
 *   pnpm --filter @forge/mastra exec tsx --env-file=.env.local \
 *     src/scripts/elevenlabs-service-smoke.ts
 */
import { writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"

import { generateMusic } from "../services/devotional/elevenlabs-music"
import { generateElevenVoiceover } from "../services/devotional/elevenlabs-voiceover"

const OUT = path.join(homedir(), "Desktop", "voice-options")

async function main() {
  const vo = await generateElevenVoiceover({
    text: "Be still, and know that I am God. This narration came through the real service function.",
    voice: "male-d",
  })
  if (!vo.ok)
    throw new Error(`voiceover failed: ${vo.reason} ${vo.details ?? ""}`)
  await writeFile(path.join(OUT, "service-voiceover.mp3"), vo.audio.bytes)
  console.log(
    `✓ voiceover  ${vo.audio.characterCount} chars, voice ${vo.audio.voiceId}`,
  )

  const music = await generateMusic({ mood: "peace", lengthMs: 12_000 })
  if (!music.ok)
    throw new Error(`music failed: ${music.reason} ${music.details ?? ""}`)
  await writeFile(path.join(OUT, "service-music.mp3"), music.audio.bytes)
  console.log(
    `✓ music      ${music.audio.lengthMs}ms, "${music.audio.prompt.slice(0, 40)}…"`,
  )

  console.log(`\n✅ real services work → ${OUT}`)
}

main().catch((e) => {
  console.error("❌", e instanceof Error ? e.message : e)
  process.exit(1)
})
