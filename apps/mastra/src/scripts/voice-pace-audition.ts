#!/usr/bin/env tsx
/**
 * Voice pace and energy audition for the owner (2026-09-30): the same two
 * passages of a real devotional in the reflection voice and the notes voice,
 * at a few settings, plus pairs played back to back to compare their pace.
 *
 *   pnpm --filter @forge/mastra exec tsx --env-file=.env.local \
 *     src/scripts/voice-pace-audition.ts --out=<dir>
 */
import { spawnSync } from "node:child_process"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"

import {
  generateElevenVoiceover,
  type ElevenVoiceSettings,
} from "../services/devotional/elevenlabs-voiceover"

const arg = (n: string) =>
  process.argv
    .find((a) => a.startsWith(`--${n}=`))
    ?.split("=")
    .slice(1)
    .join("=")

const FEMALE =
  "Picture the older son coming in from the field. His back aches. His hands are dirty. And the house is full of music and dancing. Nobody came to tell him. He has to ask a servant what is going on."
const MALE =
  "Look at where the younger son had ended up. Feeding pigs. For a Jewish listener, swine were regarded as the most unclean and the most abhorred of all animals. This boy had fallen about as far from his father's house as a son could fall."

const base = { similarity_boost: 0.85, use_speaker_boost: true }
const VARIANTS: {
  name: string
  voice: string
  text: string
  s: ElevenVoiceSettings
}[] = [
  {
    name: "F1_current",
    voice: "female-d",
    text: FEMALE,
    s: { ...base, stability: 0.25, style: 0.6, speed: 1.1 },
  },
  {
    name: "F2_faster",
    voice: "female-d",
    text: FEMALE,
    s: { ...base, stability: 0.25, style: 0.6, speed: 1.15 },
  },
  {
    name: "F3_faster_livelier",
    voice: "female-d",
    text: FEMALE,
    s: { ...base, stability: 0.18, style: 0.8, speed: 1.15 },
  },
  {
    name: "F4_fastest_livelier",
    voice: "female-d",
    text: FEMALE,
    s: { ...base, stability: 0.18, style: 0.8, speed: 1.2 },
  },
  {
    name: "M1_current",
    voice: "male-e",
    text: MALE,
    s: { ...base, stability: 0.25, style: 0.6, speed: 1.1 },
  },
  {
    name: "M2_faster",
    voice: "male-e",
    text: MALE,
    s: { ...base, stability: 0.25, style: 0.6, speed: 1.15 },
  },
  {
    name: "M3_faster_livelier",
    voice: "male-e",
    text: MALE,
    s: { ...base, stability: 0.18, style: 0.8, speed: 1.15 },
  },
]

async function main() {
  const out = arg("out")
  if (!out) throw new Error("--out=<dir> is required")
  await mkdir(out, { recursive: true })
  for (const v of VARIANTS) {
    const r = await generateElevenVoiceover({
      text: v.text,
      voice: v.voice,
      voiceSettings: v.s,
    })
    if (!r.ok) throw new Error(`${v.name}: ${r.reason} ${r.details ?? ""}`)
    await writeFile(path.join(out, `${v.name}.mp3`), r.audio.bytes)
    console.log(`wrote ${v.name}.mp3`)
  }
  // Pairs: reflection voice then notes voice, as they meet in the video.
  for (const [f, m] of [
    ["F1_current", "M1_current"],
    ["F3_faster_livelier", "M2_faster"],
    ["F4_fastest_livelier", "M3_faster_livelier"],
  ]) {
    const name = `PAIR_${f.split("_")[0]}+${m.split("_")[0]}.mp3`
    spawnSync("ffmpeg", [
      "-loglevel",
      "error",
      "-y",
      "-i",
      path.join(out, `${f}.mp3`),
      "-f",
      "lavfi",
      "-t",
      "0.7",
      "-i",
      "anullsrc=r=44100:cl=mono",
      "-i",
      path.join(out, `${m}.mp3`),
      "-filter_complex",
      "[0][1][2]concat=n=3:v=0:a=1",
      path.join(out, name),
    ])
    console.log(`wrote ${name}`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
