import { execFile } from "node:child_process"
import { readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { promisify } from "node:util"

import type {
  GenerateVoiceoverInput,
  VoiceoverResult,
} from "./elevenlabs-voiceover"

const execFileAsync = promisify(execFile)

/**
 * A `voiceover` drop-in that never calls ElevenLabs.
 *
 * Built so a devotional can be rendered through the REAL pipeline — subtitle
 * alignment, dead-air removal, the 1.12x speed-up, background assembly, cover
 * defaults — with zero narration spend, to review layout and card splitting
 * before paying for a voice. The render still costs the same wall-clock time;
 * only the TTS bill is removed.
 *
 * The duration is an ESTIMATE from word count, at `wordsPerSecond`. That rate
 * was measured on ONE real voice (98ujrzs7rxAMEsaC4EpW, ch19-seq102: 2.51
 * words/sec) — not on the voice this devotional actually uses, since no cached
 * narration exists yet to measure it from. Trust the layout this produces;
 * do not trust the pacing.
 */
export function createSilentVoiceover(
  wordsPerSecond: number,
): (input?: GenerateVoiceoverInput) => Promise<VoiceoverResult> {
  return async (input: GenerateVoiceoverInput = {}) => {
    const text = (input.text ?? "").trim()
    if (!text) {
      return {
        ok: false,
        reason: "invalid_input",
        retryable: false,
        details: "silent preview received empty text",
      }
    }
    const words = text.split(/\s+/).filter(Boolean).length
    // A floor so a two-word card isn't given an unreadably short beat.
    const sec = Math.max(1.6, words / wordsPerSecond)
    const bytes = await renderSilentMp3(sec)
    return {
      ok: true,
      audio: {
        format: "mp3",
        bytes,
        voiceId: "silent-preview",
        model: "silent-preview",
        characterCount: text.length,
        // The audio cache refuses anything carrying this. Without it a silent
        // preview poisons the cache for the real render.
        synthetic: true,
      },
    }
  }
}

async function renderSilentMp3(seconds: number): Promise<Uint8Array> {
  const file = path.join(
    tmpdir(),
    `silent-preview-${process.pid}-${Math.random().toString(36).slice(2)}.mp3`,
  )
  try {
    await execFileAsync("ffmpeg", [
      "-y",
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "anullsrc=r=44100:cl=mono",
      "-t",
      String(seconds),
      "-c:a",
      "libmp3lame",
      file,
    ])
    return await readFile(file)
  } finally {
    await rm(file, { force: true })
  }
}
