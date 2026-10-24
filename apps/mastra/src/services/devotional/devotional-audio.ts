import type { MusicAudio, MusicMood, MusicResult } from "./elevenlabs-music"
import {
  generateElevenVoiceover,
  type DevotionalVoiceName,
  type ElevenVoiceSettings,
  type VoiceoverAudio,
} from "./elevenlabs-voiceover"
import type { GeneratedDevotional } from "./generate-devotional"
import type { NarrationPolicy } from "./authored-data"

/**
 * Produce the AUDIO for a generated devotional: per-card narration in the
 * devotional's rotated voice (ElevenLabs TTS) plus the mood music bed
 * (the pre-generated music library). Per-card segments (not one blob) so the render step can
 * time each card to its own narration.
 *
 * Best-effort, mirroring the underlying services: a missing ELEVENLABS_API_KEY
 * (or a per-segment failure) is recorded in `skipped` rather than throwing, so
 * the pipeline degrades to a music-only / silent render instead of failing.
 * Generation only — persisting the bytes is the caller's job.
 */

export type NarrationSegment = { id: string; text: string }

export { splitReflection } from "./reflection-split"
import { splitReflection } from "./reflection-split"

/**
 * Spoken connective phrases that tie the sections together so the voiceover
 * flows as one piece (a RULE for all devotionals), not disjointed clips. Tweak
 * wording here.
 */
function requireNarration(policy?: NarrationPolicy): NarrationPolicy {
  if (!policy) {
    throw new Error(
      "/inputs/render/narration.json: narration configuration is required",
    )
  }
  return policy
}

function interpolate(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{([a-zA-Z]+)\}\}/g, (token, key: string) =>
    Object.hasOwn(values, key) ? values[key]! : token,
  )
}

/**
 * "YYYY-MM-DD" → spoken "Thursday, July 16" (weekday, full month, day; the TTS
 * reads the numeral as the ordinal, "the sixteenth"). Owner rule for ALL
 * devotionals: the voice opens with the weekday + date. The weekday is derived
 * from a LOCAL-time date construction (not `new Date(iso)`, which parses as UTC
 * and can land on the wrong day).
 */
export function spokenDate(
  isoDate: string,
  narration?: NarrationPolicy,
): string | null {
  const policy = requireNarration(narration)
  const m = isoDate?.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  const month = policy.months[Number(m[2]) - 1]
  if (!month) return null
  const weekday =
    policy.weekdays[
      new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getDay()
    ]
  if (!weekday) return null
  return `${weekday}, ${month} ${Number(m[3])}`
}

/**
 * The spoken script, per card, in a fixed natural order, with connective phrases
 * woven in ("Today's devotional…", "Let's watch", "Reflect on this…"). The video
 * CLIP card is not narrated. The reflection is split across several
 * `reflection-N` cards so its text tracks the narration.
 */
export function buildNarrationSegments(
  d: GeneratedDevotional,
  narration?: NarrationPolicy,
): NarrationSegment[] {
  const policy = requireNarration(narration)
  const segments: NarrationSegment[] = []
  if (d.title.trim()) {
    segments.push({
      id: "cover",
      text: interpolate(
        spokenDate(d.date, policy)
          ? policy.templates.coverWithDate
          : policy.templates.coverWithoutDate,
        {
          date: spokenDate(d.date, policy) ?? "",
          hook: d.title.trim(),
        },
      ),
    })
  }
  const ref = d.scripture.reference.trim()
  const verse = d.scripture.text.trim()
  if (verse) {
    segments.push({
      id: "scripture",
      text: interpolate(policy.templates.scripture, {
        reference: ref ? `${ref}. ` : "",
        verse,
      }),
    })
  }
  splitReflection(d.reflection.text.trim()).forEach((chunk, i) => {
    // "Reflect on this" opens the first reflection card only.
    const text =
      i === 0 ? interpolate(policy.templates.reflectionOpen, { chunk }) : chunk
    segments.push({ id: `reflection-${i + 1}`, text })
  })
  if (d.conclusion.trim()) {
    segments.push({
      id: "conclusion",
      text: d.conclusion.trim(),
    })
  }
  // Question + invitation-to-pray share ONE card, narrated together.
  const q = d.question.trim()
  const pr = d.prayer.trim()
  if (q || pr)
    segments.push({
      id: "questions",
      text: [policy.templates.questionsLead, q, pr]
        .filter(Boolean)
        .join("\n\n"),
    })
  return segments
}

/**
 * A plain, even delivery for the opening connector — the expressive default
 * over-emotes short phrases like "Today's devotional." (owner: it should just
 * start the story matter-of-factly). The reflection etc. keep the emotive
 * default.
 */
/** Per-segment voice settings; undefined → the service's emotive default. */
function voiceSettingsFor(
  id: string,
  policy: NarrationPolicy,
  defaults: ElevenVoiceSettings,
): ElevenVoiceSettings {
  return id === "cover" ? policy.coverVoiceSettings : defaults
}

export type ProducedSegment = {
  id: string
  text: string
  audio: VoiceoverAudio
}

export type ProducedDevotionalAudio = {
  voice: DevotionalVoiceName
  segments: ProducedSegment[]
  music: { mood: MusicMood; audio: MusicAudio } | null
  /** Segment ids (or "music") that were skipped (config missing / failed). */
  skipped: string[]
}

export type ProduceDevotionalAudioDeps = {
  voiceover?: typeof generateElevenVoiceover
  music?: (input: {
    mood: MusicMood
    sequence: number
    lengthMs?: number
  }) => Promise<MusicResult>
  /** Music bed length in ms (looped to cover the video at render time). */
  musicLengthMs?: number
  narration?: NarrationPolicy
  voiceProfiles?: Readonly<Record<string, string>>
  voiceSettings?: ElevenVoiceSettings
}

export async function produceDevotionalAudio(
  devotional: GeneratedDevotional,
  deps: ProduceDevotionalAudioDeps = {},
): Promise<ProducedDevotionalAudio> {
  const voiceover = deps.voiceover ?? generateElevenVoiceover
  if (!deps.music) {
    throw new Error(
      "/inputs/music: Workspace-backed music provider is required",
    )
  }
  const music = deps.music

  const segments: ProducedSegment[] = []
  const skipped: string[] = []
  const narration = requireNarration(deps.narration)
  if (!deps.voiceProfiles || !deps.voiceSettings) {
    throw new Error(
      "/inputs/voices/profiles.json: voice profiles and settings are required",
    )
  }

  for (const seg of buildNarrationSegments(devotional, narration)) {
    const voiceSettings = voiceSettingsFor(
      seg.id,
      narration,
      deps.voiceSettings,
    )
    const r = await voiceover({
      text: seg.text,
      voice: devotional.voice,
      voiceProfiles: deps.voiceProfiles,
      voiceSettings,
    })
    if (r.ok) segments.push({ id: seg.id, text: seg.text, audio: r.audio })
    else skipped.push(seg.id)
  }

  let musicOut: ProducedDevotionalAudio["music"] = null
  const m = await music({
    mood: devotional.mood,
    sequence: devotional.sequence,
    ...(deps.musicLengthMs != null ? { lengthMs: deps.musicLengthMs } : {}),
  })
  if (m.ok) musicOut = { mood: devotional.mood, audio: m.audio }
  else skipped.push("music")

  return { voice: devotional.voice, segments, music: musicOut, skipped }
}
