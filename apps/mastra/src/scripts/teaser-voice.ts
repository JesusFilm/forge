/**
 * Narrate the teaser's prose lines with ElevenLabs (word timestamps on), and
 * write them beside a lines.json the teaser render script stages into
 * Remotion. Voice defaults to the one the Sinful Woman devotional (ch14) used.
 *
 *   tsx --env-file=apps/mastra/.env.local src/scripts/teaser-voice.ts \
 *     --out=devo/assets/teaser/good-samaritan [--voice=<id>]
 */
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { spawnSync } from "node:child_process"

import {
  generateElevenVoiceover,
  type ElevenVoiceSettings,
} from "../services/devotional/elevenlabs-voiceover"

/**
 * Calmer than DEFAULT_VOICE_SETTINGS (owner: the default reading of these
 * short standalone lines came across aggressive). Higher `stability` damps
 * the dramatic swings ElevenLabs adds when it has no surrounding narration to
 * pace against; lower `style` pulls back the exaggerated inflection — same
 * voice, quieter delivery.
 */
const CALM_VOICE_SETTINGS: ElevenVoiceSettings = {
  stability: 0.58,
  similarity_boost: 0.85,
  style: 0.12,
  use_speaker_boost: true,
}

const arg = (n: string, d: string) =>
  process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d

const LINES: { id: string; text: string }[] = [
  { id: "busy", text: "We’re busy." },
  { id: "enough", text: "We already have enough to deal with." },
  { id: "needs", text: "And then someone needs us." },
  {
    id: "question",
    text: "What if the interruption is exactly what God is asking us to notice?",
  },
  // CTA is intentionally NOT narrated or word-revealed (owner ask) — it just
  // appears as plain text (see PlainLine in Teaser.tsx). Left out of LINES so
  // teaser-voice.ts never synthesizes it.
]

const outDir = path.resolve(arg("out", "devo/assets/teaser/good-samaritan"))
const voice = arg("voice", "98ujrzs7rxAMEsaC4EpW") // ch14 Sinful Woman narrator
await mkdir(outDir, { recursive: true })

function durationSec(file: string): number {
  const r = spawnSync("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=nw=1:nk=1",
    file,
  ])
  return Number.parseFloat(r.stdout.toString().trim())
}

const manifest = []
for (const line of LINES) {
  const r = await generateElevenVoiceover({
    text: line.text,
    voice,
    voiceSettings: CALM_VOICE_SETTINGS,
    withTimestamps: true,
  })
  if (!r.ok)
    throw new Error(
      `${line.id}: ${r.reason} ${"details" in r ? r.details : ""}`,
    )
  const file = `${line.id}.mp3`
  await writeFile(path.join(outDir, file), r.audio.bytes)
  const dur = durationSec(path.join(outDir, file))
  manifest.push({
    id: line.id,
    text: line.text,
    file,
    durationSec: dur,
    words: r.audio.words ?? [],
  })
  console.log(
    `${line.id.padEnd(9)} ${dur.toFixed(2)}s  ${r.audio.words?.length ?? 0} words  ${r.audio.words?.map((w) => `${w.word}@${w.startSec.toFixed(2)}`).join(" ") ?? "(no alignment)"}`,
  )
}
await writeFile(
  path.join(outDir, "lines.json"),
  JSON.stringify({ voice, lines: manifest }, null, 2),
)
console.log(`\n📄 ${path.join(outDir, "lines.json")}`)
