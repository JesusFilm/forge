import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"

import type { ProducedDevotionalAudio } from "./devotional-audio"
import type { MusicMood } from "./elevenlabs-music"
import {
  GeneratedDevotionalSchema,
  type GeneratedDevotional,
} from "./generate-devotional"
import { repoRoot } from "./repo-root"

/**
 * Disk cache for a devotional's generated TEXT and AUDIO, keyed by
 * (date, chapter, sequence) at `devo/cache/<date>-ch<N>-seq<M>/`.
 *
 * Two jobs:
 * 1. Render-only tweaks reuse text+audio instead of regenerating (owner rule:
 *    don't change the wording when only a render setting changed); a TTS glitch
 *    regenerates just the audio; hand-editing devo.json flows into the next run.
 * 2. It is the SERIALIZABLE SEAM between the Mastra sub-workflows: audio bytes
 *    can't cross a workflow step boundary, so Produce writes them here and
 *    Render loads them back by cache dir.
 */

export function cacheDirFor(
  chapterIndex: number,
  sequence: number,
  date: string,
): string {
  return path.join(
    repoRoot(),
    "devo/cache",
    `${date}-ch${chapterIndex}-seq${sequence}`,
  )
}

export async function loadCachedDevo(
  dir: string,
): Promise<GeneratedDevotional | null> {
  try {
    const parsed = GeneratedDevotionalSchema.safeParse(
      JSON.parse(await readFile(path.join(dir, "devo.json"), "utf8")),
    )
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

/** Remove rejected/blocked text and audio so the next run regenerates both. */
export async function clearCachedDevotional(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true })
}

export async function saveCachedDevo(
  dir: string,
  devo: GeneratedDevotional,
): Promise<void> {
  await mkdir(dir, { recursive: true })
  await writeFile(
    path.join(dir, "devo.json"),
    JSON.stringify(devo, null, 2) + "\n",
  )
}

export async function loadCachedAudio(
  dir: string,
  voice: GeneratedDevotional["voice"],
): Promise<ProducedDevotionalAudio | null> {
  try {
    const index = JSON.parse(
      await readFile(path.join(dir, "audio", "index.json"), "utf8"),
    ) as {
      segments: {
        id: string
        text: string
        file: string
        voiceId: string
        model: string
        characterCount: number
      }[]
      music: {
        file: string
        mood: string
        prompt: string
        lengthMs: number
        model: string
      } | null
    }
    const segments = []
    for (const s of index.segments) {
      const bytes = new Uint8Array(
        await readFile(path.join(dir, "audio", s.file)),
      )
      segments.push({
        id: s.id,
        text: s.text,
        audio: {
          format: "mp3" as const,
          bytes,
          voiceId: s.voiceId,
          model: s.model,
          characterCount: s.characterCount,
        },
      })
    }
    let music: ProducedDevotionalAudio["music"] = null
    if (index.music) {
      const bytes = new Uint8Array(
        await readFile(path.join(dir, "audio", index.music.file)),
      )
      music = {
        mood: index.music.mood as MusicMood,
        audio: {
          format: "mp3",
          bytes,
          prompt: index.music.prompt,
          lengthMs: index.music.lengthMs,
          model: index.music.model,
        },
      }
    }
    return { voice, segments, music, skipped: [] }
  } catch {
    return null
  }
}

export async function saveCachedAudio(
  dir: string,
  audio: ProducedDevotionalAudio,
): Promise<void> {
  await mkdir(path.join(dir, "audio"), { recursive: true })
  const segs = []
  for (const s of audio.segments) {
    const file = `${s.id}.mp3`
    await writeFile(path.join(dir, "audio", file), s.audio.bytes)
    segs.push({
      id: s.id,
      text: s.text,
      file,
      voiceId: s.audio.voiceId,
      model: s.audio.model,
      characterCount: s.audio.characterCount,
    })
  }
  let music = null
  if (audio.music) {
    await writeFile(
      path.join(dir, "audio", "music.mp3"),
      audio.music.audio.bytes,
    )
    music = {
      file: "music.mp3",
      mood: audio.music.mood,
      prompt: audio.music.audio.prompt,
      lengthMs: audio.music.audio.lengthMs,
      model: audio.music.audio.model,
    }
  }
  await writeFile(
    path.join(dir, "audio", "index.json"),
    JSON.stringify({ segments: segs, music }, null, 2) + "\n",
  )
}
