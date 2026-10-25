import { RecommendationPlaybackEventSchema } from "./contracts"
import { z } from "zod"

export const VIEWING_MODE_VERSION = "sound-off-viewing-v1" as const
export const VIEWING_MODE_RANKER_VERSION = "viewing-mode-affinity-v1" as const

export const ViewingModeDecisionSchema = z.object({
  version: z.literal(VIEWING_MODE_RANKER_VERSION),
  soundOffPreference: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),
  qualifiedVideos: z.number().int().min(1).max(128),
  candidate: z
    .object({
      viewers: z.number().int().min(20).max(512),
      qualifiedViewers: z.number().int().min(0).max(512),
      affinity: z.number().min(0).max(1),
    })
    .nullable(),
})
export type ViewingModeDecision = z.infer<typeof ViewingModeDecisionSchema>

type Fact = { kind: string; occurredAt: Date; payload: unknown }
type Range = [number, number]
export type ViewingModeSummary = {
  soundOffMilliseconds: number
  soundOnMilliseconds: number
  soundOffProgressSeconds: number
  soundOnProgressSeconds: number
  soundOffQualified: boolean
  soundOnQualified: boolean
  previewMilliseconds: number
  durationSeconds: number | null
}

function unionLength(ranges: Range[]): number {
  let end = -Infinity
  let total = 0
  for (const [start, stop] of ranges.sort(
    (a, b) => a[0] - b[0] || a[1] - b[1],
  )) {
    total += Math.max(0, stop - Math.max(start, end))
    end = Math.max(end, stop)
  }
  return total
}

/** Versioned behavioral proxy; neither a click nor silence alone qualifies. */
export function summarizeViewingMode(
  facts: readonly Fact[],
  claimedAt: Date,
): ViewingModeSummary {
  const wall = { sound_off: [] as Range[], sound_on: [] as Range[] }
  const progress = { sound_off: [] as Range[], sound_on: [] as Range[] }
  const preview: Range[] = []
  const durations: number[] = []
  let lastEnd = claimedAt.getTime()
  // Deterministic ordering also prevents conflicting modes counting the same
  // wall-clock interval twice. Looping may add real time, never unique progress.
  for (const fact of [...facts].sort(
    (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime(),
  )) {
    if (fact.kind !== "playback_viewing_mode") continue
    const parsed = RecommendationPlaybackEventSchema.safeParse({
      kind: fact.kind,
      payload: fact.payload,
      eventId: "projection",
      occurredAt: fact.occurredAt.toISOString(),
    })
    if (!parsed.success || parsed.data.kind !== "playback_viewing_mode")
      continue
    const value = parsed.data.payload
    const end = fact.occurredAt.getTime()
    const start = Math.max(
      claimedAt.getTime(),
      lastEnd,
      end - value.activeMilliseconds,
    )
    if (end <= start) continue
    const fraction = (end - start) / value.activeMilliseconds
    const from =
      value.toSeconds - (value.toSeconds - value.fromSeconds) * fraction
    const to = Math.min(value.toSeconds, value.durationSeconds ?? 86_400)
    if (to <= from) continue
    wall[value.mode].push([start, end])
    progress[value.mode].push([from, to])
    if (value.preview) preview.push([start, end])
    if (value.durationSeconds != null) durations.push(value.durationSeconds)
    lastEnd = end
  }
  const durationSeconds = durations.length ? Math.max(...durations) : null
  const thresholdSeconds =
    durationSeconds == null
      ? 30
      : Math.min(30, Math.max(5, durationSeconds * 0.25))
  // Even a one-second clip needs sustained visible time. Full unique progress
  // can satisfy the progress requirement for clips shorter than five seconds.
  const thresholdProgressSeconds = Math.min(
    durationSeconds ?? thresholdSeconds,
    thresholdSeconds,
  )
  const soundOffMilliseconds = Math.floor(unionLength(wall.sound_off))
  const soundOnMilliseconds = Math.floor(unionLength(wall.sound_on))
  const soundOffProgressSeconds = unionLength(progress.sound_off)
  const soundOnProgressSeconds = unionLength(progress.sound_on)
  return {
    soundOffMilliseconds,
    soundOnMilliseconds,
    soundOffProgressSeconds,
    soundOnProgressSeconds,
    soundOffQualified:
      soundOffMilliseconds >= thresholdSeconds * 1_000 &&
      soundOffProgressSeconds >= thresholdProgressSeconds,
    soundOnQualified:
      soundOnMilliseconds >= thresholdSeconds * 1_000 &&
      soundOnProgressSeconds >= thresholdProgressSeconds,
    previewMilliseconds: Math.floor(unionLength(preview)),
    durationSeconds,
  }
}

export type ViewingModeAffinity = Readonly<{
  authority: { profileId: string; privacyGeneration: number }
  version: typeof VIEWING_MODE_RANKER_VERSION
  soundOffPreference: number
  confidence: number
  qualifiedVideos: number
  candidates: ReadonlyArray<{
    mediaId: string
    viewers: number
    qualifiedViewers: number
    affinity: number
  }>
}>

/** One vote per distinct video, with identical qualification for either mode. */
export function viewingModePreference(
  rows: readonly (ViewingModeSummary & { mediaId: string })[],
) {
  const seen = new Set<string>()
  let off = 0
  let count = 0
  for (const row of rows) {
    if (
      seen.has(row.mediaId) ||
      (!row.soundOffQualified && !row.soundOnQualified)
    )
      continue
    seen.add(row.mediaId)
    const offTime = row.soundOffQualified ? row.soundOffMilliseconds : 0
    const onTime = row.soundOnQualified ? row.soundOnMilliseconds : 0
    off += offTime / (offTime + onTime)
    count++
  }
  return {
    soundOffPreference: count ? off / count : 0,
    confidence: Math.min(1, count / 3),
    qualifiedVideos: count,
  }
}
