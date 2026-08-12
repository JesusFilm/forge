/**
 * Fast AUDIO-ONLY preview: build the full devotional narration as one MP3, with
 * short breaths between sections — no video render. For iterating on voice,
 * stress, numbers, and pacing without paying the ~10-min Remotion render.
 *
 *   pnpm --filter @forge/mastra exec tsx --env-file=.env.local \
 *     src/scripts/devo-audio-track.ts --chapter=33 --seq=0 --lang=ru
 *   ... --lang=en --voice=Z0LYziOapEfZ5m8J3wTl   # override the narration voice
 *
 * Produces audio FRESH, then SAVES it to the render cache so a subsequent
 * `render-one-devotional` (without --regenerate-audio) reuses the EXACT take you
 * approve here — the video's narration is byte-identical to this preview. Run it
 * while no video render is in flight (it writes the shared audio cache).
 */
import { spawn } from "node:child_process"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { homedir, tmpdir } from "node:os"
import path from "node:path"

import { getDevotionalModel } from "../config/env"
import {
  cacheDirFor,
  loadCachedDevo,
  saveCachedAudio,
  saveCachedDevo,
} from "../services/devotional/devotional-cache"
import { produceDevotionalAudio } from "../services/devotional/devotional-audio"
import { joinAudioVarGaps, slowAndPad } from "../services/devotional/audio-concat"
import { localeFor, type DevotionalLang } from "../services/devotional/devotional-locale"
import {
  generateDevotional,
  type GeneratedDevotional,
} from "../services/devotional/generate-devotional"
import { localizeDevotional } from "../services/devotional/localize-devotional"
import { createDevotionalLlm } from "../services/devotional/llm"
import { applyStressOverrides } from "../services/devotional/speakify-tts"

function arg(name: string, fallback?: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}

const GAP_SEC = 0.6
/** Silence appended AFTER the last segment so the closing prayer settles and
 *  doesn't sound cut off at the very end (owner). */
const TAIL_SEC = 1.2

async function makeSilence(tmp: string, name: string, sec: number): Promise<string> {
  const f = path.join(tmp, name)
  await run("ffmpeg", [
    "-y", "-f", "lavfi", "-i", `anullsrc=r=44100:cl=stereo`,
    "-t", String(sec), "-c:a", "libmp3lame", "-b:a", "192k", f,
  ])
  return f
}

/** Concatenate segment MP3s (normalized) with a short silence between each, and
 *  a longer tail of silence after the last one. */
async function concatWithGaps(files: string[], out: string): Promise<void> {
  const tmp = await mkdtemp(path.join(tmpdir(), "devo-track-"))
  try {
    const sil = await makeSilence(tmp, "sil.mp3", GAP_SEC)
    const tail = await makeSilence(tmp, "tail.mp3", TAIL_SEC)
    // Interleave: seg, sil, seg, sil, …, seg, tail
    const inputs: string[] = []
    files.forEach((f, i) => {
      inputs.push(f)
      if (i < files.length - 1) inputs.push(sil)
    })
    inputs.push(tail)
    const args: string[] = ["-y"]
    inputs.forEach((f) => args.push("-i", f))
    // Normalize each input to 44.1k stereo, then concat.
    const pre = inputs
      .map((_, i) => `[${i}:a]aformat=sample_rates=44100:channel_layouts=stereo[a${i}]`)
      .join(";")
    const chain = inputs.map((_, i) => `[a${i}]`).join("")
    args.push(
      "-filter_complex", `${pre};${chain}concat=n=${inputs.length}:v=0:a=1[out]`,
      "-map", "[out]", "-c:a", "libmp3lame", "-b:a", "192k", out,
    )
    await run("ffmpeg", args)
  } finally {
    await rm(tmp, { recursive: true, force: true }).catch(() => {})
  }
}

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const c = spawn(cmd, args, { stdio: ["ignore", "ignore", "inherit"] })
    c.on("error", reject)
    c.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} exit ${code}`)),
    )
  })
}

async function main() {
  const chapterIndex = Number(arg("chapter", "33"))
  const sequence = Number(arg("seq", "0"))
  const lang = arg("lang", "ru") as DevotionalLang
  const voiceOverride = arg("voice")
  const locale = localeFor(lang)
  const llm = createDevotionalLlm({ model: getDevotionalModel() })

  // Reuse cached text (no re-translate); localize for non-English.
  const enDir = cacheDirFor(chapterIndex, sequence)
  let devo: GeneratedDevotional | null = await loadCachedDevo(enDir)
  if (!devo) {
    devo = await generateDevotional({
      chapterIndex,
      sequence,
      date: new Date().toISOString().slice(0, 10),
      llm,
    })
    await saveCachedDevo(enDir, devo)
  }
  if (lang !== "en") {
    const dir = cacheDirFor(chapterIndex, sequence, lang)
    devo = (await loadCachedDevo(dir)) ?? (await localizeDevotional({ devotional: devo, locale, llm }))
  }

  // Voice: explicit override → locale voice → the devotional's own voice.
  const voice = (voiceOverride ??
    (locale.voice === "rotate" ? devo.voice : locale.voice)) as GeneratedDevotional["voice"]
  devo = { ...devo, voice }
  console.log(`voice: ${voice} | lang: ${lang}`)

  const audio = await produceDevotionalAudio(
    devo,
    {
      speakify: (t) =>
        Promise.resolve(applyStressOverrides(t, locale.stressOverrides ?? [])),
      joinVarGaps: joinAudioVarGaps,
      pace: slowAndPad,
    },
    locale,
  )
  if (!audio.segments.length) {
    throw new Error(`no audio produced (skipped: ${audio.skipped.join(", ")})`)
  }

  // Save THIS take to the render cache so the video reuses the EXACT audio you
  // approve here (no regeneration → no different TTS take). Same dir the render
  // reads from. Run this while no video render is in flight.
  const audioDir =
    lang === "en" ? enDir : cacheDirFor(chapterIndex, sequence, lang)
  await saveCachedAudio(audioDir, audio)
  console.log(`cached audio → ${audioDir}`)

  // Stage segment MP3s in narration order, concat with breaths.
  const tmp = await mkdtemp(path.join(tmpdir(), "devo-segs-"))
  try {
    const files: string[] = []
    for (let i = 0; i < audio.segments.length; i++) {
      const f = path.join(tmp, `${String(i).padStart(2, "0")}.mp3`)
      await writeFile(f, audio.segments[i].audio.bytes)
      files.push(f)
    }
    const outDir = path.join(homedir(), "Desktop", "Devos", "devotional-video", "audio-tracks")
    await mkdir(outDir, { recursive: true })
    const out = path.join(outDir, `ch${chapterIndex}-seq${sequence}-${lang}.mp3`)
    await concatWithGaps(files, out)
    console.log(`\n🔊 ${out}`)
    console.log(`   segments: ${audio.segments.map((s) => s.id).join(" → ")}`)
  } finally {
    await rm(tmp, { recursive: true, force: true }).catch(() => {})
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack : e)
  process.exit(1)
})
