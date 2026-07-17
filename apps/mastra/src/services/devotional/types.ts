/**
 * Shared domain types for the daily devotional generator.
 *
 * One `daily-devotional` workflow composes a strict pipeline of services
 * (hook -> scripture -> video -> writer -> safety gate -> publish). These types
 * are the seams those services pass across. See
 * docs/plans/2026-06-17-002-feat-daily-devotional-generator-plan.md.
 */

export const MAX_DEVOTIONAL_TEXT_LENGTH = 4000
export const MAX_DEVOTIONAL_SHORT_TEXT = 512
export const MAX_DEVOTIONAL_URL = 1024
export const MAX_DEVOTIONAL_QUESTIONS = 6
export const MAX_DEVOTIONAL_REASONS = 12

/** Why this devotional matters today. Priority: news, then holiday, then question. */
export type HookType = "news" | "holiday" | "question"

export type Hook = {
  type: HookType
  title: string
  summary: string
  /** Source URL for a news hook; null for holiday/question hooks. */
  sourceUrl: string | null
}

export type ScriptureRef = {
  /** Human-readable reference, e.g. "John 3:16". */
  reference: string
  /** Short quoted passage proposed by the model. */
  text: string
  translation: string | null
  /**
   * True until a canonical Bible-text source is wired (A5). The report carries
   * this through so we never present an unverified paraphrase as authoritative.
   */
  needsCanonicalSource: boolean
}

export type VideoClip = {
  videoId: string
  title: string
  url: string
  thumbnailUrl: string | null
}

/** How the clip was chosen: real search hit, configured fallback, or none (A8). */
export const VIDEO_MATCH_SOURCES = ["search", "fallback", "none"] as const

export type VideoMatchSource = (typeof VIDEO_MATCH_SOURCES)[number]

/**
 * The ingredients of a devotional. `blockOrder` is the per-day arrangement (a
 * permutation of the present ingredient ids) so rendering varies day to day.
 */
export const DEVOTIONAL_BLOCKS = [
  "hook",
  "scripture",
  "video",
  "reflection",
  "questions",
] as const

export type DevotionalBlock = (typeof DEVOTIONAL_BLOCKS)[number]

export type Devotional = {
  /** YYYY-MM-DD; the per-day idempotency key. */
  date: string
  hook: Hook
  scripture: ScriptureRef
  video: VideoClip | null
  videoMatch: VideoMatchSource
  reflection: string
  questions: string[]
  /**
   * Guided prayer shown on-screen and narrated (video-first flow). Optional so
   * the daily flow, which has no separate prayer, is unaffected. MUST be fed to
   * the safety gate whenever present — it is publishable, doctrine-bearing text.
   */
  prayer?: string
  furtherReading: string | null
  blockOrder: DevotionalBlock[]
}

/**
 * Generated narration audio for a published devotional (Azure Neural TTS).
 * Best-effort: absent (null on the report) when voiceover was skipped or failed.
 */
export type VoiceoverInfo = {
  format: "mp3"
  voice: string
  locale: string
  characterCount: number
  /** Artifact-store-relative path of the persisted MP3 (e.g. `audio/2026-06-23.mp3`). */
  artifactPath: string
}

export type SafetyDimension = "doctrine" | "tone" | "sensitivity"

export type SafetyVerdict = {
  verdict: "pass" | "block"
  /** 0..1 confidence per dimension; higher is safer. */
  scores: Record<SafetyDimension, number>
  reasons: string[]
}

/** Persisted artifact for a single day's run. */
export type DevotionalReport = {
  schemaVersion: "1"
  kind: "daily-devotional"
  reportId: string
  mastraRunId: string
  date: string
  startedAt: string
  finishedAt: string
  /** True only when the safety gate passed AND the site ingest accepted it. */
  published: boolean
  videoMatch: VideoMatchSource
  safety: SafetyVerdict | null
  devotional: Devotional | null
  /** Narration audio metadata; null when voiceover was skipped or failed. */
  voiceover?: VoiceoverInfo | null
}
