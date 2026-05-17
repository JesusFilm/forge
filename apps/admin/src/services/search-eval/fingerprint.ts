/**
 * Content fingerprint reader.
 *
 * The eval harness compares a current run against a saved baseline.
 * If admin's indexed content has changed between baseline-time and
 * now, the same code can produce different search results — and that
 * registers as a code regression. The fingerprint captures (count,
 * max(updated_at)) for the three indexed-content tables so the
 * runner can warn when they've drifted.
 *
 * Single combined query — one round-trip vs three. Reads the three
 * tables that drive admin's hybrid search:
 *   - `video_scene_locale` (R1, fed by sceneEmbeddingBackfill)
 *   - `video_transcript_chunk` (R2, fed by transcriptEmbeddingBackfill)
 *   - `experience_locale` (admin-native; fed by the experienceEmbedding
 *      workflow on publish/update, and by the
 *      experienceEmbeddingBackfill workflow for bulk reruns. Only
 *      PUBLISHED rows are search-visible so we gate on
 *      status='published').
 *
 * All three tables expose an `embedding` column that is NULL until
 * the relevant workflow runs against that row, so we gate every count
 * on `embedding IS NOT NULL` — that's the only state the search
 * service can see.
 */

import type { PrismaClient } from "@prisma/client"

import type { DriftResult, Fingerprint } from "./types"

type CombinedFingerprintRow = {
  scene_count: bigint | number
  scene_max_updated_at: Date | null
  transcript_count: bigint | number
  transcript_max_updated_at: Date | null
  experience_count: bigint | number
  experience_max_updated_at: Date | null
}

function toNumberCount(value: bigint | number): number {
  return typeof value === "bigint" ? Number(value) : value
}

function toIsoOrNull(value: Date | null | undefined): string | null {
  return value == null ? null : value.toISOString()
}

/**
 * Read a single fingerprint object describing the current state of
 * admin's indexed content. Single round-trip via prisma.$queryRaw
 * against three sub-selects.
 *
 * Resilient to empty tables: counts come back as `0` and
 * `maxUpdatedAt` as `null`. The search service treats locales with
 * no indexed rows as legitimate empty-result responses, so the
 * harness's drift-detection should treat empty-vs-empty as not-drifted.
 */
export async function readFingerprint(
  prisma: PrismaClient,
): Promise<Fingerprint> {
  const [row] = await prisma.$queryRaw<CombinedFingerprintRow[]>`
    SELECT
      (SELECT COUNT(*) FROM video_scene_locale WHERE embedding IS NOT NULL)         AS scene_count,
      (SELECT MAX(updated_at) FROM video_scene_locale WHERE embedding IS NOT NULL)  AS scene_max_updated_at,
      (SELECT COUNT(*) FROM video_transcript_chunk WHERE embedding IS NOT NULL)     AS transcript_count,
      (SELECT MAX(updated_at) FROM video_transcript_chunk WHERE embedding IS NOT NULL) AS transcript_max_updated_at,
      (SELECT COUNT(*) FROM experience_locale WHERE embedding IS NOT NULL AND status = 'published') AS experience_count,
      (SELECT MAX(updated_at) FROM experience_locale WHERE embedding IS NOT NULL AND status = 'published') AS experience_max_updated_at
  `

  if (row == null) {
    // Defensive — Postgres always returns a single row for a
    // sub-select-only SELECT, but stub `$queryRaw` impls in tests can
    // produce an empty array. Don't crash the runner over a missing
    // shape; surface zeros + null timestamps as the safe default.
    return {
      sceneEmbeddings: { count: 0, maxUpdatedAt: null },
      transcriptEmbeddings: { count: 0, maxUpdatedAt: null },
      experiences: { count: 0, maxUpdatedAt: null },
    }
  }

  return {
    sceneEmbeddings: {
      count: toNumberCount(row.scene_count),
      maxUpdatedAt: toIsoOrNull(row.scene_max_updated_at),
    },
    transcriptEmbeddings: {
      count: toNumberCount(row.transcript_count),
      maxUpdatedAt: toIsoOrNull(row.transcript_max_updated_at),
    },
    experiences: {
      count: toNumberCount(row.experience_count),
      maxUpdatedAt: toIsoOrNull(row.experience_max_updated_at),
    },
  }
}

/**
 * Compare two fingerprints. Drift = any non-zero delta in counts or
 * any change in `maxUpdatedAt`. The returned `details` string is the
 * exact text the console summary surfaces.
 */
export function compareFingerprints(
  baseline: Fingerprint,
  current: Fingerprint,
): DriftResult {
  const sceneDelta =
    current.sceneEmbeddings.count - baseline.sceneEmbeddings.count
  const transcriptDelta =
    current.transcriptEmbeddings.count - baseline.transcriptEmbeddings.count
  const experienceDelta = current.experiences.count - baseline.experiences.count

  const sceneTimeDelta = compareTimes(
    baseline.sceneEmbeddings.maxUpdatedAt,
    current.sceneEmbeddings.maxUpdatedAt,
  )
  const transcriptTimeDelta = compareTimes(
    baseline.transcriptEmbeddings.maxUpdatedAt,
    current.transcriptEmbeddings.maxUpdatedAt,
  )
  const experienceTimeDelta = compareTimes(
    baseline.experiences.maxUpdatedAt,
    current.experiences.maxUpdatedAt,
  )

  const detected =
    sceneDelta !== 0 ||
    transcriptDelta !== 0 ||
    experienceDelta !== 0 ||
    sceneTimeDelta != null ||
    transcriptTimeDelta != null ||
    experienceTimeDelta != null

  if (!detected) {
    return { detected: false, details: "no drift since baseline" }
  }

  const rowParts: string[] = []
  if (sceneDelta !== 0) rowParts.push(`scene${formatDelta(sceneDelta)}`)
  if (transcriptDelta !== 0)
    rowParts.push(`transcript${formatDelta(transcriptDelta)}`)
  if (experienceDelta !== 0)
    rowParts.push(`experience${formatDelta(experienceDelta)}`)

  const timeParts: string[] = []
  const longestTimeDelta = pickLongestTimeDelta(
    sceneTimeDelta,
    transcriptTimeDelta,
    experienceTimeDelta,
  )
  if (longestTimeDelta != null) {
    timeParts.push(
      `latest update ${formatTimeDelta(longestTimeDelta)} after baseline`,
    )
  }

  const rowSegment = rowParts.length > 0 ? `Δrows: ${rowParts.join(", ")}` : ""
  const timeSegment = timeParts.length > 0 ? timeParts.join("; ") : ""
  const details = [rowSegment, timeSegment].filter(Boolean).join("; ")

  return { detected: true, details }
}

function compareTimes(
  baseline: string | null,
  current: string | null,
): number | null {
  // null-vs-null = no drift. null-vs-value or value-vs-null = drift
  // (a table going from empty to populated, or vice versa).
  if (baseline == null && current == null) return null
  if (baseline == null || current == null) return Number.POSITIVE_INFINITY
  const diff = Date.parse(current) - Date.parse(baseline)
  if (!Number.isFinite(diff) || diff === 0) return null
  return diff
}

function pickLongestTimeDelta(...deltas: Array<number | null>): number | null {
  let max: number | null = null
  for (const delta of deltas) {
    if (delta == null) continue
    if (delta === Number.POSITIVE_INFINITY) return delta
    if (max == null || Math.abs(delta) > Math.abs(max)) {
      max = delta
    }
  }
  return max
}

function formatDelta(delta: number): string {
  return delta >= 0 ? `+${delta}` : String(delta)
}

function formatTimeDelta(deltaMs: number): string {
  if (deltaMs === Number.POSITIVE_INFINITY) return "(presence change)"
  const days = Math.round(deltaMs / (1000 * 60 * 60 * 24))
  if (Math.abs(days) >= 1) return `${days >= 0 ? "+" : ""}${days}d`
  const hours = Math.round(deltaMs / (1000 * 60 * 60))
  if (Math.abs(hours) >= 1) return `${hours >= 0 ? "+" : ""}${hours}h`
  const minutes = Math.round(deltaMs / (1000 * 60))
  return `${minutes >= 0 ? "+" : ""}${minutes}m`
}
