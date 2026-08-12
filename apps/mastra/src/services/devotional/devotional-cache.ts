import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

import type { ProducedDevotionalAudio } from "./devotional-audio"
import type { MusicMood } from "./elevenlabs-music"
import type { DevotionalLang } from "./devotional-locale"
import type { GeneratedDevotional } from "./generate-devotional"
import { repoRoot } from "./repo-root"

/**
 * Disk cache for a devotional's generated TEXT and AUDIO, keyed by
 * (chapter, sequence) at `devo/cache/ch<N>-seq<M>/`.
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
  lang: DevotionalLang = "en",
): string {
  // English keeps the original path; other languages get a suffixed dir so a
  // localized edition never collides with the English text/audio.
  const suffix = lang === "en" ? "" : `-${lang}`
  return path.join(
    repoRoot(),
    "devo/cache",
    `ch${chapterIndex}-seq${sequence}${suffix}`,
  )
}

export async function loadCachedDevo(
  dir: string,
): Promise<GeneratedDevotional | null> {
  try {
    return JSON.parse(
      await readFile(path.join(dir, "devo.json"), "utf8"),
    ) as GeneratedDevotional
  } catch {
    return null
  }
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
    return { voice, segments, music, skipped: [], reused: [] }
  } catch {
    return null
  }
}

/**
 * Cached narration keyed by WHAT IT SAYS, for per-segment reuse.
 *
 * `loadCachedAudio` is all-or-nothing: any text edit invalidates the whole
 * devotional's audio, so a one-sentence change re-synthesised all ~21
 * segments. That burned an entire ElevenLabs quota in a single afternoon
 * (owner: "why are you re-rendering the narration, use the same one").
 *
 * The key deliberately ignores the segment's INDEX: inserting a sentence
 * early renumbers every `reflection-N` after it, which would invalidate
 * everything under an id-based key even though the words are identical. It
 * does keep the segment's ROLE, because role changes the delivery — the first
 * reflection card carries a spoken connector and the last one is paced
 * slower, so the same words in a different role are genuinely different audio.
 */
export function audioReuseKey(
  role: string,
  displayText: string,
  voice: string,
): string {
  return `${voice}::${role}::${displayText.trim()}`
}

/** Every cached segment, keyed for reuse. Empty map when nothing is cached. */
export async function loadReusableAudio(
  dir: string,
  voice: GeneratedDevotional["voice"],
): Promise<Map<string, ProducedDevotionalAudio["segments"][number]>> {
  const out = new Map<string, ProducedDevotionalAudio["segments"][number]>()
  const cached = await loadCachedAudio(dir, voice)
  if (!cached) return out
  const reflections = cached.segments.filter((s) =>
    /^reflection-\d+$/.test(s.id),
  )
  const firstId = reflections[0]?.id
  const lastId = reflections[reflections.length - 1]?.id
  for (const s of cached.segments) {
    const role = /^reflection-\d+$/.test(s.id)
      ? s.id === firstId
        ? "reflection-first"
        : s.id === lastId
          ? "reflection-last"
          : "reflection-mid"
      : s.id
    out.set(audioReuseKey(role, s.text ?? "", voice), s)
  }
  return out
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
