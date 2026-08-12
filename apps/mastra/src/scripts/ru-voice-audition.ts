/**
 * Quick auditions on the Russian voice — voice comparison OR stress-mark test.
 * Hardcoded voice id + phrases (TTS-only key is fine). Throwaway helper.
 *
 *   pnpm --filter @forge/mastra exec tsx --env-file=.env.local \
 *     src/scripts/ru-voice-audition.ts
 */
import { mkdir, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"

import { generateElevenVoiceover } from "../services/devotional/elevenlabs-voiceover"

const VOICE = "g1jpii0iyvtRs8fqXsd1"

// Stress-mark test: same sentence, one plain, one with a combining acute accent
// (U+0301) on the correct vowel of "стоит" → "стои́т" (stands, not costs).
const PHRASES: Array<[string, string]> = [
  [
    "stress-plain",
    "Он ищет потерянных. Он не стоит в стороне и не ждёт, а приходит и ищет.",
  ],
  [
    "stress-marked",
    "Он ищет потерянных. Он не стои́т в стороне и не ждёт, а приходит и ищет.",
  ],
]

async function main() {
  const outDir = path.join(
    homedir(),
    "Desktop",
    "devotional-video",
    "ru-voice-options",
  )
  await mkdir(outDir, { recursive: true })
  for (const [name, text] of PHRASES) {
    const r = await generateElevenVoiceover({ text, voice: VOICE })
    if (r.ok) {
      await writeFile(path.join(outDir, `${name}.mp3`), r.audio.bytes)
      console.log(`✓ ${name}`)
    } else {
      console.log(`✗ ${name}: ${r.reason}`)
    }
  }
  console.log(`\n→ ${outDir}`)
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
