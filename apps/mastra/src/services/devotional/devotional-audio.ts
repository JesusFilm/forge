import { readFile } from "node:fs/promises"
import { libraryBed } from "./music-library-store"
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
import { EN_LOCALE, type DevotionalLocale } from "./devotional-locale"
import { occasionFor } from "./devotional-occasions"
import { audioReuseKey } from "./devotional-cache"
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

export type NarrationSegment = {
  id: string
  /** Text sent to TTS (may include a spoken connector, e.g. "Подумай над этим."). */
  text: string
  /** Clean text shown ON-SCREEN (no spoken connector). Defaults to `text`. */
  display?: string
}

export { splitReflection } from "./reflection-split"
import { splitReflection } from "./reflection-split"

/**
 * Spoken connective phrases + spoken date live in the LOCALE (one source of
 * truth; see devotional-locale.ts). These re-exports keep the English wording
 * available under the old names for any callers/tests.
 */
export const spokenDate = (isoDate: string): string | null =>
  EN_LOCALE.spokenDate(isoDate)
export const CONNECTORS = EN_LOCALE.connectors

/**
 * The spoken script, per card, in a fixed natural order, with connective phrases
 * woven in ("Today's devotional…", "Let's watch", "Reflect on this…"). The video
 * CLIP card is not narrated. The reflection is split across several
 * `reflection-N` cards so its text tracks the narration.
 */
/**
 * End a spoken line like a finished thought, so the voice falls and settles
 * instead of trailing off mid-air (owner: the hook + conclusion must sound
 * complete, not cut off). Adds a period only when there is no terminal mark.
 */
function ensureTerminal(s: string): string {
  const t = s.trim()
  return /[.!?…:»)]$/.test(t) ? t : `${t}.`
}

/**
 * Flatten a segment's text into a PLAIN spoken line for TTS (never the displayed
 * text). Deliberately NO `<break>` tags: ElevenLabs draws out the final vowel of
 * the word right before an inline break, which reads as the voice "stretching"
 * every sentence end (owner-reported). Pauses between sentences/sections are
 * added as REAL SILENCE at assembly time instead, which has no such artifact.
 * Here we only collapse newlines/whitespace so the connectors' paragraph breaks
 * don't reach the model as literal newlines.
 */
export function flattenSpokenText(text: string): string {
  return text
    .replace(/\s*\n+\s*/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
}

/** Short breath between sentences; longer beat between sections (paragraphs). */
const SENTENCE_GAP_SEC = 0.28
const PARAGRAPH_GAP_SEC = 0.6

/**
 * Split a segment's spoken text into SENTENCE units, each with the silence to
 * follow it: a short breath between sentences, a longer beat at a paragraph
 * break, and none after the last unit. Each unit is TTS'd separately so the
 * pause is real silence (no `<break>` vowel-stretching).
 */
export function splitSpokenUnits(
  text: string,
  finalRamp = false,
): {
  units: string[]
  gaps: number[]
} {
  const paras = text.split(/\n{2,}/)
  const units: string[] = []
  const gaps: number[] = []
  paras.forEach((para, pi) => {
    // Trailing closing quotes belong to the sentence they end. Leaving them
    // out started the NEXT unit with a lone quote mark, and ElevenLabs read
    // that stray character as a filler ("umm") before the line.
    const sentences = (para.match(/[^.!?…]+[.!?…]*['’"”]*/g) ?? [para])
      .map((s) => flattenSpokenText(s))
      .filter(Boolean)
    sentences.forEach((s, si) => {
      units.push(s)
      const lastSentence = si === sentences.length - 1
      const lastPara = pi === paras.length - 1
      gaps.push(
        lastSentence ? (lastPara ? 0 : PARAGRAPH_GAP_SEC) : SENTENCE_GAP_SEC,
      )
    })
  })
  // "Settling" ending (owner): the last few words of the WHOLE devotional get
  // progressively longer breaths between them, so it lands as finished. The
  // trailing words are TTS'd separately and rejoined with a growing gap.
  if (finalRamp && units.length > 0) {
    const last = units.pop()!
    gaps.pop()
    const words = last.split(/\s+/)
    if (words.length >= 5) {
      const head = words.slice(0, -3).join(" ")
      const [w1, w2, w3] = words.slice(-3)
      units.push(head, w1, w2, w3)
      gaps.push(0.12, 0.2, 0.3, 0) // gently growing — subtle, not draggy
    } else {
      units.push(last)
      gaps.push(0)
    }
  }
  return { units, gaps }
}

export function buildNarrationSegments(
  d: GeneratedDevotional,
  locale: DevotionalLocale = EN_LOCALE,
  /** Fixed-date occasions ("Today is also World Humanitarian Day") belong to
   *  the daily site edition. A social cut is watched whenever someone finds
   *  it, so naming today's holiday dates the video exactly the way a date
   *  does. */
  opts: { suppressOccasion?: boolean; settleLine?: string } = {},
): NarrationSegment[] {
  const c = locale.connectors
  const segments: NarrationSegment[] = []
  if (d.title.trim()) {
    segments.push({
      id: "cover",
      // Terminal punctuation so the hook lands as a complete sentence.
      text: c.cover(
        ensureTerminal(d.title),
        d.sequence,
        locale.spokenDate(d.date),
        opts.suppressOccasion ? null : occasionFor(d.date, locale.lang),
        opts.settleLine ?? null,
      ),
    })
  }
  const ref = d.scripture.reference.trim()
  const verse = d.scripture.text.trim()
  if (verse) {
    // Spoken reference has numbers spelled out ("глава девятнадцать, стих
    // десять"); the on-screen citation keeps the digits ("От Луки 19:10").
    segments.push({
      id: "scripture",
      text: c.scripture(locale.spokenReference(ref), verse),
    })
  }
  splitReflection(d.reflection.text.trim()).forEach((chunk, i) => {
    // The reflection-open connector opens the first reflection card only. It is
    // SPOKEN, never shown — the on-screen `display` is the clean chunk.
    const text = i === 0 ? c.reflectionOpen(chunk) : chunk
    segments.push({ id: `reflection-${i + 1}`, text, display: chunk })
  })
  if (d.conclusion.trim()) {
    segments.push({
      id: "conclusion",
      // The takeaway lands as a complete, weighty line (see voiceSettingsFor).
      text: c.conclusion(ensureTerminal(d.conclusion)),
    })
  }
  // Question + invitation-to-pray share ONE card, narrated together.
  const q = d.question.trim()
  const pr = d.prayer.trim()
  if (q || pr) segments.push({ id: "questions", text: c.questions(q, pr) })
  return segments
}

/**
 * The cover: the date is matter-of-fact, but the hook must land like the
 * OPENING LINE of a story, not an offhand aside (owner). A little more warmth
 * and expression than a flat read, without the default's over-emoting.
 */
const COVER_VOICE_SETTINGS: ElevenVoiceSettings = {
  stability: 0.45,
  similarity_boost: 0.85,
  style: 0.3,
  use_speaker_boost: true,
}

/**
 * The closing takeaway AND the closing question+prayer: a steadier, more
 * deliberate delivery so each lands with weight and settles as a finished
 * thought instead of rushing on or trailing off mid-air (owner: the takeaway,
 * and especially the prayer, must sound complete, not cut off). Higher
 * stability = less sing-song, more measured; no stylistic exaggeration.
 */
const WEIGHTY_VOICE_SETTINGS: ElevenVoiceSettings = {
  stability: 0.78,
  similarity_boost: 0.9,
  style: 0.0,
  use_speaker_boost: true,
}

/**
 * Clean, even delivery for the Russian voice. The expressive default (high
 * `style`) makes ElevenLabs draw out word endings — owner-reported "stretching".
 * Low `style` + higher `stability` reads plainly and evenly, like a default
 * 11labs read, and steadies the phrasing (no spurious mid-clause pauses). The
 * close is a touch steadier still so the prayer lands as a finished thought.
 */
const RU_BASE_VOICE_SETTINGS: ElevenVoiceSettings = {
  stability: 0.55,
  similarity_boost: 0.85,
  style: 0.0,
  use_speaker_boost: true,
}
const RU_CLOSE_VOICE_SETTINGS: ElevenVoiceSettings = {
  stability: 0.65,
  similarity_boost: 0.9,
  style: 0.0,
  use_speaker_boost: true,
}

/** Per-segment voice settings; undefined → the service's emotive default. */
function voiceSettingsFor(
  id: string,
  voice: string,
): ElevenVoiceSettings | undefined {
  // Russian voice: plain, even read (no stylistic vowel-stretching).
  if (voice === "russian") {
    return id === "conclusion" || id === "questions"
      ? RU_CLOSE_VOICE_SETTINGS
      : RU_BASE_VOICE_SETTINGS
  }
  if (id === "cover") return COVER_VOICE_SETTINGS
  if (id === "conclusion" || id === "questions") return WEIGHTY_VOICE_SETTINGS
  return undefined
}

export type ProducedSegment = {
  id: string
  /** Clean ON-SCREEN text (no spoken connector). */
  text: string
  audio: VoiceoverAudio
}

/** WHY a segment was skipped, so a caller can tell "try again in a minute" from
 *  "this will never succeed until the account is topped up". */
export type SegmentFailure = {
  id: string
  reason: string
  /** True only for genuinely transient causes (rate limit, 5xx, network). A
   *  quota-exhausted or auth failure is false and must not drive a retry. */
  retryable: boolean
}

export type ProducedDevotionalAudio = {
  voice: DevotionalVoiceName
  segments: ProducedSegment[]
  music: { mood: MusicMood; audio: MusicAudio } | null
  /** Segment ids (or "music") that were skipped (config missing / failed). */
  skipped: string[]
  /** Segment ids reused verbatim from cache — no TTS credits spent on them. */
  reused: string[]
  /** Per-segment failure detail behind `skipped`. `skipped` alone cannot tell a
   *  caller whether retrying is worth anything, which is what a recovery pass
   *  has to decide before spending more credits. */
  failures: SegmentFailure[]
}

export type ProduceDevotionalAudioDeps = {
  voiceover?: typeof generateElevenVoiceover
  /**
   * Already-synthesised narration, keyed by `audioReuseKey` — any segment whose
   * words and role match is taken from here instead of being re-synthesised.
   * The whole-devotional cache is all-or-nothing, so without this a
   * one-sentence edit re-voiced every card and drained the TTS quota.
   */
  reusable?: Map<string, ProducedSegment>
  music?: typeof generateMusic
  /** Injectable for tests; defaults to reading devo/assets/music. */
  libraryBed?: typeof libraryBed
  /** Leave today's fixed-date occasion out of the spoken cover. */
  suppressOccasion?: boolean
  /** Replace the rotated settle line on the cover for this run. */
  settleLine?: string
  /** Use THIS mp3 as the bed, instead of the library or the paid generator.
   *  For matching an existing video whose own track was never saved: the only
   *  copy is mixed into its audio, and the one stretch without narration is a
   *  few seconds of the outro. */
  musicFile?: string
  /** Music bed length in ms (looped to cover the video at render time). */
  musicLengthMs?: number
  /**
   * Prepare a line for TTS (spell numbers, mark stress) — applied to the
   * narration ONLY, never to the stored/displayed text. Best-effort; identity
   * when absent. See speakify-tts.ts.
   */
  speakify?: (text: string) => Promise<string>
  /**
   * Join MP3 units with a PER-GAP silence (ffmpeg). When provided, a segment is
   * split into SENTENCES (and paragraph breaks), each TTS'd separately and
   * rejoined with real silence — a short breath between sentences and a longer
   * one between sections — so the voice doesn't rush sentence-to-sentence,
   * WITHOUT the vowel-stretching of `<break>` tags. When absent, the segment is
   * a single flattened TTS call (no internal pauses) — keeps pure tests ffmpeg-free.
   */
  joinVarGaps?: (
    chunks: Uint8Array[],
    gapsAfter: number[],
  ) => Promise<Uint8Array>
  /**
   * Slow a segment's audio (pitch-preserved) and optionally add a tail of
   * silence. Used to read certain cards more slowly (owner): the SCRIPTURE and
   * the LAST reflection card a touch slower, and the CLOSING slower + padded so
   * it doesn't end abruptly. Best-effort; when absent, no pacing is applied.
   */
  pace?: (
    bytes: Uint8Array,
    tempo: number,
    tailSec: number,
  ) => Promise<Uint8Array>
}

/**
 * TTS retry budget. ElevenLabs 429s are routine here: one render fires ~20
 * segments (each split into per-sentence units) back to back. Without a retry
 * a rate-limited unit permanently loses its whole segment.
 */
const TTS_MAX_RETRIES = 3
const TTS_BACKOFF_MS = 1_500

export async function produceDevotionalAudio(
  devotional: GeneratedDevotional,
  deps: ProduceDevotionalAudioDeps = {},
  locale: DevotionalLocale = EN_LOCALE,
): Promise<ProducedDevotionalAudio> {
  const voiceover = deps.voiceover ?? generateElevenVoiceover
  const music = deps.music ?? generateMusic

  const segments: ProducedSegment[] = []
  const skipped: string[] = []
  /** Segments reused verbatim from cache (no TTS spend). */
  const reused: string[] = []
  /** Why each skipped segment failed — drives whether a recovery pass is worth
   *  spending credits on. */
  const failures: SegmentFailure[] = []

  // Cards read a touch slower (owner): scripture and the LAST reflection card.
  const segs = buildNarrationSegments(devotional, locale, {
    suppressOccasion: deps.suppressOccasion ?? false,
    ...(deps.settleLine ? { settleLine: deps.settleLine } : {}),
  })
  const lastReflectionId = [...segs]
    .reverse()
    .find((s) => /^reflection-\d+$/.test(s.id))?.id
  const LAST_REFLECTION_TEMPO = 0.92

  for (const seg of segs) {
    const voiceSettings = voiceSettingsFor(seg.id, devotional.voice)
    // Speakify the TTS input only; keep seg.text (clean) for on-screen display.
    const prepared = deps.speakify ? await deps.speakify(seg.text) : seg.text
    // With `joinVarGaps`, TTS each SENTENCE separately and rejoin with real
    // silence (short between sentences, longer at paragraph breaks). Otherwise a
    // single flattened call (tests / no-ffmpeg).
    // No word-level ritardando (chopping the last words TTS'd unnaturally); the
    // clean last sentence + a short closing tail gives a finished feel.
    const { units, gaps } = deps.joinVarGaps
      ? splitSpokenUnits(prepared)
      : { units: [flattenSpokenText(prepared)], gaps: [] }

    const isLastSegment = seg.id === segs[segs.length - 1]?.id

    // REUSE cached narration whose words are identical. Without this, editing
    // one sentence re-synthesised every segment and exhausted the TTS quota.
    if (deps.reusable) {
      const reflIds = segs.filter((x) => /^reflection-\d+$/.test(x.id))
      const role = /^reflection-\d+$/.test(seg.id)
        ? seg.id === reflIds[0]?.id
          ? "reflection-first"
          : seg.id === reflIds[reflIds.length - 1]?.id
            ? "reflection-last"
            : "reflection-mid"
        : seg.id
      const hit = deps.reusable.get(
        audioReuseKey(role, seg.display ?? seg.text, devotional.voice),
      )
      if (hit) {
        segments.push({
          id: seg.id,
          text: seg.display ?? seg.text,
          audio: hit.audio,
        })
        reused.push(seg.id)
        continue
      }
    }

    const audios: VoiceoverAudio[] = []
    let failed = false
    let failure: SegmentFailure | null = null
    for (let ui = 0; ui < units.length; ui++) {
      const speak = () =>
        voiceover({
          text: units[ui],
          voice: devotional.voice,
          ...(voiceSettings ? { voiceSettings } : {}),
        })
      // ACTUALLY retry retryable failures. `voiceover` already classifies
      // 429 / 5xx as `retryable: true`, but that flag was computed and then
      // ignored — one rate-limited unit silently killed its whole segment.
      // A render asks for ~20 segments back-to-back, so 429s are routine: 15
      // of 21 segments were lost this way in one run, including the conclusion
      // and the question/prayer card, and the video still shipped.
      let r = await speak()
      for (let t = 0; !r.ok && r.retryable && t < TTS_MAX_RETRIES; t++) {
        // Exponential backoff — an immediate retry just hits the same limit.
        await new Promise((res) => setTimeout(res, TTS_BACKOFF_MS * 2 ** t))
        r = await speak()
      }
      if (!r.ok) {
        failed = true
        failure = {
          id: seg.id,
          reason: r.reason,
          // `retryable` after the loop above means the retries were already
          // spent — so this records whether a LATER attempt (a recovery pass
          // minutes from now) could plausibly differ, not whether to loop again.
          retryable: r.retryable,
        }
        break
      }
      // A short final phrase lands slower so it reads as a finished thought.
      // Only SHORT phrases: slowing the cover hook made the voice read the title
      // as a question, and slowing the long verse made it sound syllabic — so
      // those are left at natural speed. We land "Давайте посмотрим" (scripture
      // lead-in) and the very last line of the devotional (both short).
      let b = r.audio.bytes
      const lastIdx = units.length - 1
      let finalityTempo: number | null = null
      if (seg.id === "cover" && units[ui].includes("поразмышляем"))
        finalityTempo = 0.92 // "Давай поразмышляем над Божьим Словом" lands
      else if (seg.id === "scripture" && ui === lastIdx) finalityTempo = 0.92
      else if (isLastSegment && ui === lastIdx) finalityTempo = 0.9
      if (finalityTempo != null && deps.pace) {
        b = await deps.pace(b, finalityTempo, 0)
      }
      audios.push({ ...r.audio, bytes: b })
    }
    if (failed || audios.length === 0) {
      skipped.push(seg.id)
      failures.push(
        failure ?? {
          id: seg.id,
          reason: "no_audio_produced",
          retryable: false,
        },
      )
      continue
    }
    const audio: VoiceoverAudio =
      audios.length === 1 || !deps.joinVarGaps
        ? audios[0]
        : {
            format: "mp3",
            bytes: await deps.joinVarGaps(
              audios.map((a) => a.bytes),
              gaps,
            ),
            voiceId: audios[0].voiceId,
            model: audios[0].model,
            characterCount: audios.reduce((s, a) => s + a.characterCount, 0),
          }
    // The last reflection card reads a touch slower. (Scripture is NOT slowed
    // as a whole — slowing the long verse made it sound syllabic; it reads at
    // natural speed, with only "Давайте посмотрим" landing above.)
    let bytes = audio.bytes
    if (deps.pace && seg.id === lastReflectionId) {
      bytes = await deps.pace(bytes, LAST_REFLECTION_TEMPO, 0)
    }
    // Store the CLEAN on-screen text (spoken connector stays audio-only).
    segments.push({
      id: seg.id,
      text: seg.display ?? seg.text,
      audio: { ...audio, bytes },
    })
  }

  // Tail of silence after the close so it settles (the final sentence itself is
  // already slowed above for the intonational landing; no extra whole-segment
  // slowdown, to avoid dragging).
  if (deps.pace && segments.length > 0) {
    const last = segments[segments.length - 1]
    last.audio = {
      ...last.audio,
      bytes: await deps.pace(last.audio.bytes, 1.0, 0.7),
    }
  }

  // LIBRARY FIRST. The 20-track library was generated once precisely so a
  // music credit is not spent per render; going straight to generateMusic
  // bought a fresh bed every single time while those tracks sat on disk.
  // Generation stays as the fallback for a mood the library cannot serve.
  let musicOut: ProducedDevotionalAudio["music"] = null
  // An explicit file wins over both: it is how a new cut is matched to an
  // existing video whose own bed was never saved anywhere but inside its mix.
  const fromFile = deps.musicFile
    ? await readFile(deps.musicFile).catch(() => null)
    : null
  const fromLibrary = fromFile
    ? null
    : await (deps.libraryBed ?? libraryBed)(
        devotional.mood,
        devotional.sequence,
      )
  if (fromFile) {
    musicOut = {
      mood: devotional.mood,
      audio: {
        format: "mp3",
        bytes: fromFile,
        prompt: `file:${deps.musicFile}`,
        model: "file",
        lengthMs: 0,
      },
    }
  } else if (fromLibrary) {
    musicOut = {
      mood: fromLibrary.mood,
      audio: {
        format: "mp3",
        bytes: fromLibrary.bytes,
        // Provenance for a library track is the file it came from; the original
        // generation prompt lives in the library manifest, not here.
        prompt: `library:${fromLibrary.file}`,
        model: "library",
        lengthMs: 0,
      },
    }
  } else {
    const m = await music({
      mood: devotional.mood,
      ...(deps.musicLengthMs != null ? { lengthMs: deps.musicLengthMs } : {}),
    })
    if (m.ok) musicOut = { mood: devotional.mood, audio: m.audio }
    else {
      skipped.push("music")
      failures.push({ id: "music", reason: m.reason, retryable: m.retryable })
    }
  }

  return {
    voice: devotional.voice,
    segments,
    music: musicOut,
    skipped,
    reused,
    failures,
  }
}
