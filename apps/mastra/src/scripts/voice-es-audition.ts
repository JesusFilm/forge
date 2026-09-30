/**
 * Audition Spanish female voices for the reflection (owner, 2026-09-30).
 * One short passage from the Prodigal reflection, in Spanish, per voice.
 *
 *   pnpm exec tsx --env-file=.env.local src/scripts/voice-es-audition.ts --out=<dir> [--only=<id>]
 */
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"

import { generateElevenVoiceover } from "../services/devotional/elevenlabs-voiceover"

const arg = (n: string) =>
  process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1]
const out = arg("out") ?? "."

const TEXT = [
  "Imagina al hijo mayor volviendo del campo. Le duele la espalda. Tiene las manos sucias. Y la casa está llena de música y de baile.",
  "Nadie vino a avisarle. Tiene que preguntarle a un siervo qué está pasando. Se detiene en la puerta.",
  "Muchos de los que hemos servido durante años sabemos exactamente lo que siente.",
].join("\n\n")

// Public ElevenLabs library voices: calm, warm, mature narrators, neutral or
// Latin American Spanish (the male Spanish voice is Latin American too).
const VOICES: { name: string; id: string }[] = [
  { name: "1-Luisa-calm-evocative", id: "V6isiXLBuRuM7uwHOVBA" },
  { name: "2-Regina-mature-calm", id: "eBthAb30UYbt2nojGXeA" },
  { name: "3-Tatiana-Martin-neutral", id: "2rigMbVWLdqtBSCahJFX" },
  { name: "4-Pilar-Duran-latam", id: "x6LHvMgpXmty838MUqHh" },
  { name: "5-Isabella-warm-calm", id: "p18tR9wFA5Ng9WhfWI0o" },
  { name: "6-Karolina-warm-deep", id: "Wuv1s5YTNCjL9mFJTqo4" },
  { name: "7-Luisa-storyteller", id: "efcRUax7uSa9kpBwtDPe" },
]

async function main() {
  await mkdir(out, { recursive: true })
  const only = arg("only")
  for (const v of VOICES.filter((x) => !only || x.id === only)) {
    const r = await generateElevenVoiceover({
      text: TEXT,
      voice: v.id,
      timeoutMs: 120_000,
    })
    if (!r.ok) {
      console.log(`${v.name}: FAILED ${r.reason} ${r.details ?? ""}`)
      continue
    }
    await writeFile(path.join(out, `${v.name}.mp3`), r.audio.bytes)
    console.log(`${v.name}: ok`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
