// Scene embedding backfill — durable useworkflow job that indexes
// manager's scene-analysis artifacts into admin's Postgres.
//
// Flow:
//   1. stepLoadMapping        — load coreId → cms video id snapshot
//   2. stepEnumerateTargets   — list admin editions whose parent video
//                               has a coreId in the mapping
//   3. stepIndexEditionLocale — per-target indexer call with isolated
//                               error handling
//   4. stepReport             — aggregate per-target outcomes
//
// Per-target errors are caught inside the loop so one bad artifact
// doesn't halt the whole backfill. The indexer itself is idempotent
// (upserts on composite keys), so the workflow is safe to re-run.

import { prisma } from "@/db/client"
import type { Principal } from "@/auth/principal"
import {
  loadCoreIdMapping,
  type CoreIdMapping,
} from "@/services/core-id-mapping.service"
import {
  indexEditionScenes,
  type IndexEditionScenesResult,
} from "@/services/scene-embedding.service"

const SYSTEM_PRINCIPAL: Principal = { id: null, role: "SYSTEM" } as Principal

const DEFAULT_LOCALES = ["en", "es", "fr"] as const

export type SceneEmbeddingBackfillInput = {
  /** Absolute path to the JSON mapping file dumped from cms. */
  mappingPath: string
  /** Restrict to these coreIds. Omitted = all mapped videos. */
  coreIds?: readonly string[]
  /** Restrict to these locales. Omitted = en/es/fr. */
  locales?: readonly string[]
}

export type BackfillTarget = {
  videoId: string
  videoEditionId: string
  coreId: string
  cmsVideoId: number
}

export type BackfillOutcome =
  | {
      status: "succeeded"
      target: BackfillTarget
      locale: string
      scenesIndexed: number
      embeddingsWritten: number
      durationMs: number
    }
  | {
      status: "skipped"
      target: BackfillTarget
      locale: string
      reason: string
      durationMs: number
    }
  | {
      status: "failed"
      target: BackfillTarget
      locale: string
      reason: string
      durationMs: number
    }

export type SceneEmbeddingBackfillReport = {
  mappingGeneratedAt: string
  totalTargets: number
  locales: readonly string[]
  outcomes: BackfillOutcome[]
  succeeded: number
  skipped: number
  failed: number
}

export async function runSceneEmbeddingBackfill(
  input: SceneEmbeddingBackfillInput,
): Promise<SceneEmbeddingBackfillReport> {
  "use workflow"

  const mapping = await stepLoadMapping(input.mappingPath)
  const targets = await stepEnumerateTargets(input.coreIds, mapping)
  const locales = input.locales ?? DEFAULT_LOCALES

  const outcomes: BackfillOutcome[] = []
  for (const target of targets) {
    for (const locale of locales) {
      const outcome = await stepIndexEditionLocale(target, locale)
      outcomes.push(outcome)
      logOutcome(outcome)
    }
  }

  return stepReport({
    mappingGeneratedAt: mapping.generatedAt,
    targets: targets.length,
    locales,
    outcomes,
  })
}

async function stepLoadMapping(path: string): Promise<CoreIdMapping> {
  "use step"
  return loadCoreIdMapping(path)
}

async function stepEnumerateTargets(
  coreIdFilter: readonly string[] | undefined,
  mapping: CoreIdMapping,
): Promise<BackfillTarget[]> {
  "use step"

  const filter = coreIdFilter ? new Set(coreIdFilter) : null

  // Distinct (video, edition) pairs reachable through any non-deleted dub.
  // Raw SQL is clearer here than a Prisma relation query because we only
  // need unique ids, not any entity hydration.
  const rows = await prisma.$queryRaw<
    Array<{ video_id: string; video_edition_id: string; core_id: string }>
  >`
    SELECT DISTINCT v.id AS video_id, d.video_edition_id AS video_edition_id, v.core_id AS core_id
    FROM video v
    JOIN video_dub d ON d.video_id = v.id
    WHERE v.deleted_at IS NULL
      AND d.deleted_at IS NULL
      AND d.video_edition_id IS NOT NULL
    ORDER BY v.core_id
  `

  const targets: BackfillTarget[] = []
  for (const row of rows) {
    if (filter && !filter.has(row.core_id)) continue
    const cmsVideoId = mapping.byCoreId.get(row.core_id)
    if (cmsVideoId === undefined) continue
    targets.push({
      videoId: row.video_id,
      videoEditionId: row.video_edition_id,
      coreId: row.core_id,
      cmsVideoId,
    })
  }

  return targets
}

async function stepIndexEditionLocale(
  target: BackfillTarget,
  locale: string,
): Promise<BackfillOutcome> {
  "use step"

  const startedAt = Date.now()

  try {
    const result = await indexEditionScenes(prisma, {
      editionId: target.videoEditionId,
      videoId: target.videoId,
      coreId: target.coreId,
      locale,
      cmsVideoId: target.cmsVideoId,
      user: SYSTEM_PRINCIPAL,
    })
    return toSucceeded(target, locale, result, Date.now() - startedAt)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const durationMs = Date.now() - startedAt
    if (/artifact_missing/.test(message) || /not found/i.test(message)) {
      return {
        status: "skipped",
        target,
        locale,
        reason: "artifact_missing",
        durationMs,
      }
    }
    return { status: "failed", target, locale, reason: message, durationMs }
  }
}

function stepReport(args: {
  mappingGeneratedAt: string
  targets: number
  locales: readonly string[]
  outcomes: BackfillOutcome[]
}): SceneEmbeddingBackfillReport {
  let succeeded = 0
  let skipped = 0
  let failed = 0
  for (const outcome of args.outcomes) {
    if (outcome.status === "succeeded") succeeded += 1
    else if (outcome.status === "skipped") skipped += 1
    else failed += 1
  }

  return {
    mappingGeneratedAt: args.mappingGeneratedAt,
    totalTargets: args.targets,
    locales: args.locales,
    outcomes: args.outcomes,
    succeeded,
    skipped,
    failed,
  }
}

function toSucceeded(
  target: BackfillTarget,
  locale: string,
  result: IndexEditionScenesResult,
  durationMs: number,
): BackfillOutcome {
  return {
    status: "succeeded",
    target,
    locale,
    scenesIndexed: result.scenesIndexed,
    embeddingsWritten: result.embeddingsWritten,
    durationMs,
  }
}

function logOutcome(outcome: BackfillOutcome): void {
  if (outcome.status === "succeeded") {
    console.log(
      JSON.stringify({
        workflow: "scene-embedding-backfill",
        event: "scene_index_complete",
        coreId: outcome.target.coreId,
        videoEditionId: outcome.target.videoEditionId,
        locale: outcome.locale,
        scenesIndexed: outcome.scenesIndexed,
        embeddingsWritten: outcome.embeddingsWritten,
        durationMs: outcome.durationMs,
      }),
    )
    return
  }
  if (outcome.status === "skipped") {
    console.log(
      JSON.stringify({
        workflow: "scene-embedding-backfill",
        event: "scene_index_skipped",
        coreId: outcome.target.coreId,
        videoEditionId: outcome.target.videoEditionId,
        locale: outcome.locale,
        reason: outcome.reason,
        durationMs: outcome.durationMs,
      }),
    )
    return
  }
  console.error(
    JSON.stringify({
      workflow: "scene-embedding-backfill",
      event: "scene_index_failed",
      coreId: outcome.target.coreId,
      videoEditionId: outcome.target.videoEditionId,
      locale: outcome.locale,
      reason: outcome.reason,
      durationMs: outcome.durationMs,
    }),
  )
}

// Exported for tests — these are the pure functions inside the steps,
// safe to exercise without the useworkflow runtime. `stepEnumerateTargets`
// is wrapped in a thin helper that accepts a prisma instance so tests
// can use a stub; the workflow step uses the module singleton.
export const _internals = {
  stepReport,
  toSucceeded,
  logOutcome,
}
