// Pure presenter logic for the Shorts Studio dashboard (phase derivation,
// clip time formatting/parsing, client-side clip validation, stale-output
// detection). Kept free of React so it is unit-testable — mirrors
// smart-crop-presenter.ts.

import { SHORT_CLIP_DURATION } from "@forge/shorts-compositions/schema"
import { buildCanonicalWatchVideoPath } from "@forge/watch-url-policy/routes"
import {
  getShortsActiveStall,
  type ShortsActiveStall,
} from "@/lib/shorts-stale"
import {
  countryIdToCircleFlagUrl,
  resolveLanguageFlagCountryId,
} from "@/features/coverage/language-flags"
import { getShortsReport } from "@/lib/shorts-report"
import type { JobRecord, ShortsJobReport, ShortsPhase } from "@/types/job"

// ---------------------------------------------------------------------------
// Phase presentation
// ---------------------------------------------------------------------------

// Phases during which a workflow is running — the UI polls while in one of
// these and stops on review/terminal phases (plan "UI" bullet).
const ACTIVE_PHASES: ReadonlySet<ShortsPhase> = new Set([
  "queued",
  "preparing",
  "rendering",
  "mux_processing",
])

// Phases from which the editor is shown (matches the draft route's
// DRAFT_EDITABLE_PHASES and the render route's RENDERABLE_PHASES).
const EDITOR_PHASES: ReadonlySet<ShortsPhase> = new Set([
  "ready_for_review",
  "render_failed",
  "completed",
])

export function isActiveShortsPhase(phase: ShortsPhase): boolean {
  return ACTIVE_PHASES.has(phase)
}

// The create route's workflow launch failed before any phase transition:
// the report still shows the initial "queued" intent but the job is failed
// and NOTHING is running (todo 010). The retry route accepts a plain retry
// from this state and relaunches prepare from scratch.
export function isShortsLaunchFailed(
  phase: ShortsPhase,
  jobStatus: JobRecord["status"],
): boolean {
  return phase === "queued" && jobStatus === "failed"
}

export function isEditorShortsPhase(phase: ShortsPhase): boolean {
  return EDITOR_PHASES.has(phase)
}

export function formatShortsPhase(phase: ShortsPhase): string {
  switch (phase) {
    case "queued":
      return "Queued"
    case "preparing":
      return "Preparing"
    case "ready_for_review":
      return "Ready for review"
    case "rendering":
      return "Rendering"
    case "mux_processing":
      return "Mux processing"
    case "completed":
      return "Completed"
    case "prepare_failed":
      return "Prepare failed"
    case "render_failed":
      return "Render failed"
  }
}

export type ShortsPhaseTone = "completed" | "failed" | "running" | "pending"

// Tone feeds the `jobs-progress-summary-${tone}` class family (only
// completed/failed carry colors in globals.css; running/pending fall back to
// the neutral base style — same behavior the smart-crop table has).
export function shortsPhaseTone(phase: ShortsPhase): ShortsPhaseTone {
  switch (phase) {
    case "completed":
      return "completed"
    case "prepare_failed":
    case "render_failed":
      return "failed"
    case "preparing":
    case "rendering":
    case "mux_processing":
      return "running"
    case "queued":
    case "ready_for_review":
      return "pending"
  }
}

// Worker annotation literals → operator copy. Unknown annotations are
// humanized (forward compatibility with new worker annotations).
export function formatShortsAnnotation(
  annotation: string | null,
): string | null {
  if (annotation === null) return null
  switch (annotation) {
    case "transcription_skipped_no_audio":
      return "Captions skipped: no audio"
    case "transcription_unsupported_language":
      return "Captions skipped: unsupported language"
    default:
      return annotation.replaceAll("_", " ")
  }
}

// Stale-output banner contract (plan decision 4): the draft has moved past
// the last rendered draft version. Before any render exists there is nothing
// to be stale against.
export function isShortsDraftStale(
  report: Pick<
    ShortsJobReport,
    "draftVersion" | "lastRenderedDraftVersion"
  > | null,
): boolean {
  if (!report || report.lastRenderedDraftVersion === null) {
    return false
  }
  return report.draftVersion > report.lastRenderedDraftVersion
}

// ---------------------------------------------------------------------------
// Clip time formatting / parsing (mm:ss)
// ---------------------------------------------------------------------------

// mm:ss (h:mm:ss above one hour). Fractional seconds are floored — display
// only; the underlying numeric state keeps full precision.
export function formatClipTime(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds))
  const hours = Math.floor(safe / 3600)
  const minutes = Math.floor((safe % 3600) / 60)
  const seconds = safe % 60
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`
}

// Editable-input variant: keeps tenths of a second ("1:05.5") so Set in/out
// captures from the player don't lose sub-second precision on round-trip.
export function formatClipInput(totalSeconds: number): string {
  const safe = Math.max(0, totalSeconds)
  const whole = Math.floor(safe)
  const tenths = Math.round((safe - whole) * 10)
  if (tenths === 0) return formatClipTime(whole)
  if (tenths === 10) return formatClipTime(whole + 1)
  return `${formatClipTime(whole)}.${tenths}`
}

// Accepts "ss", "mm:ss", "h:mm:ss" — with optional fractional seconds on
// the last segment. Returns null for anything else (empty, negatives,
// minutes/seconds >= 60 in positional notation).
export function parseClipTime(value: string): number | null {
  const trimmed = value.trim()
  if (trimmed.length === 0) return null

  const parts = trimmed.split(":")
  if (parts.length > 3) return null

  const numbers: number[] = []
  for (const [index, part] of parts.entries()) {
    const isLast = index === parts.length - 1
    const pattern = isLast ? /^\d+(\.\d+)?$/ : /^\d+$/
    if (!pattern.test(part)) return null
    numbers.push(Number(part))
  }

  if (numbers.length === 1) {
    return numbers[0]
  }

  // Positional segments (all but the leading one) must stay under 60.
  for (const segment of numbers.slice(1)) {
    if (segment >= 60) return null
  }

  return numbers.reduce((total, segment) => total * 60 + segment, 0)
}

export function formatClipRange(clip: {
  startSec: number
  endSec: number
}): string {
  return `${formatClipTime(clip.startSec)}–${formatClipTime(clip.endSec)}`
}

// ---------------------------------------------------------------------------
// Client-side clip validation (mirrors POST /api/shorts/jobs reasons)
// ---------------------------------------------------------------------------

// Matches the create route's CLIP_END_TOLERANCE_SEC: Mux durations are float
// seconds and scrubbers snap to frame boundaries.
export const CLIP_END_TOLERANCE_SEC = 0.5

export type ClipValidationFailure = {
  ok: false
  // Mirrors the server's 422 reason literals so messages stay aligned.
  reason: "clip_too_short" | "clip_too_long" | "clip_out_of_bounds"
  message: string
}

export type ClipValidationResult = { ok: true } | ClipValidationFailure

export function validateClipSelection(input: {
  startSec: number
  endSec: number
  durationSec: number | null
}): ClipValidationResult {
  const { startSec, endSec, durationSec } = input
  const clipDurationSec = endSec - startSec

  if (startSec < 0 || endSec <= startSec) {
    return {
      ok: false,
      reason: "clip_out_of_bounds",
      message: "The out point must come after the in point.",
    }
  }
  if (clipDurationSec < SHORT_CLIP_DURATION.minSec) {
    return {
      ok: false,
      reason: "clip_too_short",
      message: `Shorts must be at least ${SHORT_CLIP_DURATION.minSec} seconds long (currently ${clipDurationSec.toFixed(1)}s).`,
    }
  }
  if (clipDurationSec > SHORT_CLIP_DURATION.maxSec) {
    return {
      ok: false,
      reason: "clip_too_long",
      message: `Shorts can be at most ${SHORT_CLIP_DURATION.maxSec} seconds long (currently ${clipDurationSec.toFixed(1)}s).`,
    }
  }
  if (durationSec !== null && endSec > durationSec + CLIP_END_TOLERANCE_SEC) {
    return {
      ok: false,
      reason: "clip_out_of_bounds",
      message: `The out point ${formatClipTime(endSec)} is beyond the video's duration ${formatClipTime(durationSec)}.`,
    }
  }
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Job summary projection
// ---------------------------------------------------------------------------

export type ShortsJobSummary = {
  assetId: string
  sourceMuxAssetId: string
  sourceCoreId?: string
  sourceSlug: string | null
  sourceVideoTitle: string | null
  title: string
  languageBcp47: string | null
  languageLabel: string
  languageShortLabel: string
  languageFlagUrl: string
  clip: { startSec: number; endSec: number }
  clipRangeLabel: string
  phase: ShortsPhase
  phaseLabel: string
  phaseTone: ShortsPhaseTone
  /** Phase "queued" + job status "failed": the create launch never ran. */
  isLaunchFailed: boolean
  activeStall: ShortsActiveStall | null
  annotationLabel: string | null
  isStale: boolean
  report: ShortsJobReport | null
}

// SYNC: mirrors WATCH_AUDIO_LANGUAGE_SLUG_BY_LOCALE in
// apps/admin/src/app/dashboard/experiences/experience-editor.tsx and
// PUBLIC_WATCH_AUDIO_LANGUAGE_SLUG_BY_UI_LOCALE in apps/web/src/lib/locale.ts.
const WATCH_AUDIO_LANGUAGE_SLUG_BY_LOCALE: Readonly<Record<string, string>> = {
  en: "english",
  es: "spanish-castilian",
  fr: "french",
  pt: "portuguese-brazil",
  de: "german-standard",
  ar: "arabic-modern-standard",
  id: "indonesian-isa",
  ja: "japanese",
  ko: "korean",
  ms: "malay",
  ne: "nepali",
  ru: "russian",
  th: "thai",
  tl: "tagalog",
  tr: "turkish",
  vi: "vietnamese",
  zh: "mandarin-china",
  "zh-hans": "chinese-simplified",
  "zh-hant": "chinese-traditional",
}

function watchLanguageSlugForLocale(locale: string | null): string | null {
  const normalized = locale?.trim().replaceAll("_", "-").toLowerCase()
  if (!normalized) return null

  return (
    WATCH_AUDIO_LANGUAGE_SLUG_BY_LOCALE[normalized] ??
    WATCH_AUDIO_LANGUAGE_SLUG_BY_LOCALE[normalized.split("-")[0] ?? ""] ??
    null
  )
}

function cleanWatchOrigin(value: string): string | null {
  try {
    const url = new URL(value)
    if (url.protocol !== "http:" && url.protocol !== "https:") return null
    return url.origin
  } catch {
    return null
  }
}

export function buildSourceWatchHref(
  summary: Pick<ShortsJobSummary, "sourceSlug" | "languageBcp47">,
  watchOrigin = process.env.NEXT_PUBLIC_WATCH_URL ??
    "https://www.jesusfilm.org",
): string | null {
  const sourceSlug = summary.sourceSlug?.trim()
  if (!sourceSlug) return null

  const origin = cleanWatchOrigin(watchOrigin)
  if (!origin) return null

  const languageSlug = watchLanguageSlugForLocale(summary.languageBcp47)
  if (!languageSlug) return null

  return `${origin}/watch${buildCanonicalWatchVideoPath(
    encodeURIComponent(sourceSlug),
    languageSlug,
  )}`
}

function formatLanguageShortLabel(language: {
  bcp47: string | null
  whisper: string | null
}): string {
  const rawCode = (language.bcp47 ?? language.whisper)?.trim()
  if (!rawCode) return "UNK"

  const [languageCode, regionCode] = rawCode.replaceAll("_", "-").split("-")
  if (!languageCode) return "UNK"
  if (regionCode && /^[a-zA-Z]{2}$/.test(regionCode)) {
    return `${languageCode.slice(0, 3)}-${regionCode}`.toUpperCase()
  }

  return languageCode.slice(0, 3).toUpperCase()
}

function formatLanguageLabel(language: {
  bcp47: string | null
  whisper: string | null
}): string {
  const rawCode = (language.bcp47 ?? language.whisper)?.trim()
  if (!rawCode) return "Language unknown"

  try {
    const displayName = new Intl.DisplayNames(["en"], { type: "language" }).of(
      rawCode,
    )
    return displayName ? `${displayName} (${rawCode})` : rawCode
  } catch {
    return rawCode
  }
}

function getLanguageFlagUrl(language: {
  bcp47: string | null
  whisper: string | null
}): string {
  const countryId = resolveLanguageFlagCountryId({
    bcp47: language.bcp47,
    iso3: language.whisper,
    countryIds: [],
    countrySpeakers: {},
  })

  return countryIdToCircleFlagUrl(countryId)
}

export function getShortsJobSummary(
  job: JobRecord,
  options: { now?: Date } = {},
): ShortsJobSummary | null {
  const shorts = job.options.shorts
  if (!shorts) {
    return null
  }

  const report = getShortsReport(job.artifacts)
  // The report is the phase source of truth (plan decision 2) — workflows
  // own every transition including the failure phases. One status-based
  // exception: "queued" + job status "failed" means the create route's
  // launch itself failed, so the label/tone must read as a failure, not as
  // a workflow that is about to run.
  const phase = report?.phase ?? "queued"
  const isLaunchFailed = isShortsLaunchFailed(phase, job.status)
  const activeStall =
    isLaunchFailed || job.status === "failed"
      ? null
      : getShortsActiveStall(job, report, options.now)
  const sourceVideoTitle =
    job.sourceMediaTitle?.trim() || shorts.sourceTitle || null

  return {
    assetId: shorts.assetId,
    sourceMuxAssetId: shorts.sourceMuxAssetId,
    sourceCoreId: shorts.sourceCoreId,
    sourceSlug: shorts.sourceSlug ?? null,
    sourceVideoTitle,
    title: shorts.sourceTitle ?? sourceVideoTitle ?? shorts.assetId,
    languageBcp47: shorts.language.bcp47,
    languageLabel: formatLanguageLabel(shorts.language),
    languageShortLabel: formatLanguageShortLabel(shorts.language),
    languageFlagUrl: getLanguageFlagUrl(shorts.language),
    clip: shorts.clip,
    clipRangeLabel: formatClipRange(shorts.clip),
    phase,
    phaseLabel: isLaunchFailed
      ? "Launch failed"
      : activeStall
        ? activeStall.label
        : formatShortsPhase(phase),
    phaseTone:
      isLaunchFailed || activeStall ? "failed" : shortsPhaseTone(phase),
    isLaunchFailed,
    activeStall,
    annotationLabel: formatShortsAnnotation(report?.annotation ?? null),
    isStale: isShortsDraftStale(report),
    report,
  }
}

// Download is offered ONLY when the phase is completed (plan "UI" bullet) —
// not merely when an output record exists (a re-render may be replacing it).
export function canDownloadShortsOutput(
  summary: Pick<ShortsJobSummary, "phase">,
): boolean {
  return summary.phase === "completed"
}

export function buildShortsMediaHref(
  jobId: string,
  artifact: "clip" | "output",
): string {
  return `/api/shorts/jobs/${encodeURIComponent(jobId)}/media/${artifact}`
}

// Clone flow (plan decision 3): bounds are immutable after prepare; fixing
// them = a new short pre-filled from this one. Requires a coreId — the
// picker resolves sources by coreId.
export function buildShortsCloneHref(
  summary: Pick<ShortsJobSummary, "sourceCoreId" | "clip">,
): string | null {
  if (!summary.sourceCoreId) {
    return null
  }
  const params = new URLSearchParams({
    coreId: summary.sourceCoreId,
    start: String(summary.clip.startSec),
    end: String(summary.clip.endSec),
  })
  return `/dashboard/shorts/new?${params.toString()}`
}
