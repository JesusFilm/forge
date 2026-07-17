import {
  generateMusic,
  type MusicAudio,
  type MusicMood,
} from "./elevenlabs-music"
import {
  generateElevenVoiceover,
  type DevotionalVoiceName,
  type ElevenVoiceSettings,
  type VoiceoverAudio,
} from "./elevenlabs-voiceover"
import type { GeneratedDevotional } from "./generate-devotional"

/**
 * Produce the AUDIO for a generated devotional: per-card narration in the
 * devotional's rotated voice (ElevenLabs TTS) plus the mood music bed
 * (ElevenLabs Music). Per-card segments (not one blob) so the render step can
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
const SPOKEN_MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
]
const SPOKEN_WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
]

/**
 * "YYYY-MM-DD" → spoken "Thursday, July 16" (weekday, full month, day; the TTS
 * reads the numeral as the ordinal, "the sixteenth"). Owner rule for ALL
 * devotionals: the voice opens with the weekday + date. The weekday is derived
 * from a LOCAL-time date construction (not `new Date(iso)`, which parses as UTC
 * and can land on the wrong day).
 */
export function spokenDate(isoDate: string): string | null {
  const m = isoDate?.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  const month = SPOKEN_MONTHS[Number(m[2]) - 1]
  if (!month) return null
  const weekday =
    SPOKEN_WEEKDAYS[
      new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getDay()
    ]
  if (!weekday) return null
  return `${weekday}, ${month} ${Number(m[3])}`
}

export const CONNECTORS = {
  // Owner rule: the voice opens with the weekday + date, then the hook — worded
  // so "today" isn't said twice: "It's Thursday, July 16. And today's
  // devotional: …" (TTS reads "July 16" as the ordinal, "the sixteenth").
  cover: (hook: string, date?: string | null) =>
    date
      ? `It's ${date}. And today's devotional: ${hook}`
      : `Today's devotional. ${hook}`,
  // "Let's watch" closes the scripture card (over music only) and leads INTO the
  // video — narrating it ON the video card gets buried under the clip's audio.
  scripture: (ref: string, verse: string) =>
    `Here's today's scripture. ${ref ? `${ref}. ` : ""}${verse} Let's watch.`,
  reflectionOpen: (chunk: string) => `Reflect on this. ${chunk}`,
  conclusion: (line: string) => line,
  questions: (question: string, prayer: string) =>
    [`Here's something to sit with.`, question, prayer]
      .filter(Boolean)
      .join("\n\n"),
} as const

/**
 * The spoken script, per card, in a fixed natural order, with connective phrases
 * woven in ("Today's devotional…", "Let's watch", "Reflect on this…"). The video
 * CLIP card is not narrated. The reflection is split across several
 * `reflection-N` cards so its text tracks the narration.
 */
export function buildNarrationSegments(
  d: GeneratedDevotional,
): NarrationSegment[] {
  const segments: NarrationSegment[] = []
  if (d.title.trim()) {
    segments.push({
      id: "cover",
      text: CONNECTORS.cover(d.title.trim(), spokenDate(d.date)),
    })
  }
  const ref = d.scripture.reference.trim()
  const verse = d.scripture.text.trim()
  if (verse) {
    segments.push({ id: "scripture", text: CONNECTORS.scripture(ref, verse) })
  }
  splitReflection(d.reflection.text.trim()).forEach((chunk, i) => {
    // "Reflect on this" opens the first reflection card only.
    const text = i === 0 ? CONNECTORS.reflectionOpen(chunk) : chunk
    segments.push({ id: `reflection-${i + 1}`, text })
  })
  if (d.conclusion.trim()) {
    segments.push({
      id: "conclusion",
      text: CONNECTORS.conclusion(d.conclusion.trim()),
    })
  }
  // Question + invitation-to-pray share ONE card, narrated together.
  const q = d.question.trim()
  const pr = d.prayer.trim()
  if (q || pr)
    segments.push({ id: "questions", text: CONNECTORS.questions(q, pr) })
  return segments
}

/**
 * A plain, even delivery for the opening connector — the expressive default
 * over-emotes short phrases like "Today's devotional." (owner: it should just
 * start the story matter-of-factly). The reflection etc. keep the emotive
 * default.
 */
const PLAIN_VOICE_SETTINGS: ElevenVoiceSettings = {
  stability: 0.7,
  similarity_boost: 0.85,
  style: 0.0,
  use_speaker_boost: true,
}

/** Per-segment voice settings; undefined → the service's emotive default. */
function voiceSettingsFor(id: string): ElevenVoiceSettings | undefined {
  return id === "cover" ? PLAIN_VOICE_SETTINGS : undefined
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
  music?: typeof generateMusic
  /** Music bed length in ms (looped to cover the video at render time). */
  musicLengthMs?: number
}

export async function produceDevotionalAudio(
  devotional: GeneratedDevotional,
  deps: ProduceDevotionalAudioDeps = {},
): Promise<ProducedDevotionalAudio> {
  const voiceover = deps.voiceover ?? generateElevenVoiceover
  const music = deps.music ?? generateMusic

  const segments: ProducedSegment[] = []
  const skipped: string[] = []

  for (const seg of buildNarrationSegments(devotional)) {
    const voiceSettings = voiceSettingsFor(seg.id)
    const r = await voiceover({
      text: seg.text,
      voice: devotional.voice,
      ...(voiceSettings ? { voiceSettings } : {}),
    })
    if (r.ok) segments.push({ id: seg.id, text: seg.text, audio: r.audio })
    else skipped.push(seg.id)
  }

  let musicOut: ProducedDevotionalAudio["music"] = null
  const m = await music({
    mood: devotional.mood,
    ...(deps.musicLengthMs != null ? { lengthMs: deps.musicLengthMs } : {}),
  })
  if (m.ok) musicOut = { mood: devotional.mood, audio: m.audio }
  else skipped.push("music")

  return { voice: devotional.voice, segments, music: musicOut, skipped }
}
