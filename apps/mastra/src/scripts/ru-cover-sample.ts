/**
 * One-off: synthesize the Russian cover phrase in a few voices so the owner can
 * HEAR how it reads (wording + how the TTS says the date numeral). Throwaway.
 *
 *   pnpm --filter @forge/mastra exec tsx --env-file=.env.local \
 *     src/scripts/ru-cover-sample.ts
 */
import { mkdir, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"

import { RU_LOCALE } from "../services/devotional/devotional-locale"
import {
  DEVOTIONAL_VOICES,
  generateElevenVoiceover,
} from "../services/devotional/elevenlabs-voiceover"

// ~15s reflection-style passage (Zacchaeus / grace) to judge each voice on
// longer flowing Russian, with the normal emotive delivery.
const SAMPLE =
  "Иисус увидел Закхея на дереве и назвал его по имени. Он не стал ждать, " +
  "пока тот исправится. Бог всегда первым делает шаг к тебе. И сегодня Он " +
  "ищет тебя — не за твои заслуги, а потому что любит. Позволь Ему найти тебя."

async function main() {
  console.log("TEXT:", SAMPLE, "\n")

  const outDir = path.join(homedir(), "Desktop", "devotional-video", "ru-samples")
  await mkdir(outDir, { recursive: true })

  for (const voice of Object.keys(DEVOTIONAL_VOICES)) {
    const r = await generateElevenVoiceover({ text: SAMPLE, voice })
    if (r.ok) {
      await writeFile(path.join(outDir, `voice-${voice}.mp3`), r.audio.bytes)
      console.log(`✓ ${voice}`)
    } else {
      console.log(`✗ ${voice}: ${r.reason}`)
    }
  }
  console.log(`\n→ ${outDir}`)
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
