import {
  Prisma,
  RecommendationAuditKind,
  WorkflowRunStatus,
} from "@prisma/client"
import { start } from "workflow/api"
import { prisma } from "@/db/client"
import {
  attachWorkflowRuntimeRunId,
  createWorkflowRunLog,
  markWorkflowRunFailed,
  markWorkflowRunRuntimeStarted,
  markWorkflowRunStarted,
} from "@/services/workflow-run-log.service"
import { createRecommendationOutcomeService } from "../outcome.service"
import { createRecommendationIntegrityService } from "../integrity.service"
import { dispatchRecommendationProfileFeedback } from "../profiles/job"
import {
  runRecommendationEpisodeFinalization,
  runRecommendationEpisodeFinalizationRecovery,
} from "@/workflows/recommendationEpisodeFinalization"

export type RecommendationEpisodeFinalizationReason =
  | "episode-opened"
  | "fact-advanced"
  | "terminal-fact"
  | "timeout"
  | "recovery"

export type RecommendationEpisodeFinalizationInput = {
  episodeId: string
  generation: number
  reason: RecommendationEpisodeFinalizationReason
  notBefore?: string
  ledgerRunId?: string
}

export type RecommendationEpisodeFinalizationDispatch = {
  episodeId: string
  generation: number
  reason: RecommendationEpisodeFinalizationReason
  notBefore: Date
}

export type RecommendationFinalizationWake = (
  input: RecommendationEpisodeFinalizationDispatch,
) => Promise<unknown>

const WORKFLOW_KEY = "recommendation-episode-finalization"
export const RECOVERY_WORKFLOW_KEY =
  "recommendation-episode-finalization-recovery"
const RECOVERY_RUNNER_LOCK_ID = 368_000_003
const RECOVERY_RUNNER_FRESH_MS = 15 * 60 * 1_000
const RECOVERY_INTERVAL_MS = 60 * 1_000
// Episode wakes cannot legitimately remain queued beyond the six-hour hard
// horizon. Keeping this predicate on the existing workflowKey+createdAt index
// avoids scanning the entire workflow ledger for every recovery page.
const ACTIVE_WAKE_LOOKBACK_MS = 7 * 60 * 60 * 1_000
const MAX_RECOVERY_PAGES = 10

type ActiveFinalizationRun = {
  id: string
  subjectId: string | null
  details: Prisma.JsonValue
}

function finalizationReason(details: Prisma.JsonValue): string | null {
  if (!details || typeof details !== "object" || Array.isArray(details)) {
    return null
  }
  const reason = (details as Prisma.JsonObject).reason
  return typeof reason === "string" ? reason : null
}

async function findRecentActiveFinalizationRuns(input: {
  episodeIds: string[]
  now: Date
  excludeLedgerRunId?: string
}): Promise<ActiveFinalizationRun[]> {
  if (input.episodeIds.length === 0) return []
  return prisma.workflowRun.findMany({
    where: {
      workflowKey: WORKFLOW_KEY,
      subjectId: { in: input.episodeIds },
      status: {
        in: [WorkflowRunStatus.QUEUED, WorkflowRunStatus.RUNNING],
      },
      createdAt: {
        gte: new Date(input.now.getTime() - ACTIVE_WAKE_LOOKBACK_MS),
      },
      ...(input.excludeLedgerRunId
        ? { id: { not: input.excludeLedgerRunId } }
        : {}),
    },
    select: { id: true, subjectId: true, details: true },
  })
}

export async function dispatchRecommendationEpisodeFinalization(
  input: RecommendationEpisodeFinalizationDispatch,
) {
  const ledger = await createWorkflowRunLog({
    workflowKey: WORKFLOW_KEY,
    workflowName: "Recommendation Episode Finalization",
    trigger: "system",
    subjectType: "recommendation-playback-episode",
    subjectId: input.episodeId,
    summary: "Recommendation episode finalization queued.",
    details: {
      episodeId: input.episodeId,
      generation: input.generation,
      reason: input.reason,
      notBefore: input.notBefore.toISOString(),
    },
  })
  let runtime: Awaited<ReturnType<typeof start>>
  try {
    runtime = await start(runRecommendationEpisodeFinalization, [
      {
        episodeId: input.episodeId,
        generation: input.generation,
        reason: input.reason,
        notBefore: input.notBefore.toISOString(),
        ledgerRunId: ledger.id,
      },
    ])
  } catch (error) {
    await markWorkflowRunFailed(ledger.id, error).catch(() => {})
    const episode = await prisma.recommendationPlaybackEpisode
      .findUnique({
        where: { id: input.episodeId },
        include: { request: true },
      })
      .catch(() => null)
    if (episode && episode.generation === input.generation) {
      await prisma.recommendationEvidenceAudit
        .create({
          data: {
            requestId: episode.requestId,
            kind: RecommendationAuditKind.WRITE_FAILURE,
            reasonCode: "episode_finalization_dispatch_failed",
            detail: {
              episodeId: episode.id,
              generation: episode.generation,
            },
            expiresAt: episode.request.expiresAt,
          },
        })
        .catch(() => {})
    }
    throw error
  }
  await attachWorkflowRuntimeRunId(ledger.id, runtime.runId).catch(() => {
    console.warn(
      "Recommendation finalization started before its runtime identity could be recorded; workflow self-reconciliation will retry.",
    )
  })
  return {
    queued: true as const,
    runId: runtime.runId,
    ledgerRunId: ledger.id,
  }
}

export function scheduleRecommendationEpisodeFinalization(
  dispatch: RecommendationFinalizationWake | undefined,
  input: RecommendationEpisodeFinalizationDispatch,
): void {
  if (!dispatch) return
  void dispatch(input).catch(() => {
    // The episode row is the recovery ledger, so request paths never wait for
    // workflow attachment and startup recovery can reclaim a missed wake.
  })
}

export async function runRecommendationEpisodeFinalizationJob(
  input: RecommendationEpisodeFinalizationInput,
) {
  if (input.ledgerRunId) await markWorkflowRunStarted(input.ledgerRunId)
  try {
    const reason = input.reason === "episode-opened" ? "timeout" : input.reason
    const result = await createRecommendationOutcomeService(prisma).finalize({
      episodeId: input.episodeId,
      generation: input.generation,
      reason,
    })
    if (
      (result.status === "published" || result.status === "existing") &&
      result.activeOutcomeId
    ) {
      await classifyAndDispatchProfileOutcome(result.activeOutcomeId).catch(
        () => {
          // Finalized outcome truth is replayable. Profile projection failure
          // must not change finalization or the player's serving path.
        },
      )
    }
    if (input.ledgerRunId) {
      const succeeded =
        result.status === "published" || result.status === "existing"
      await prisma.workflowRun.update({
        where: { id: input.ledgerRunId },
        data: {
          status: succeeded
            ? WorkflowRunStatus.SUCCEEDED
            : WorkflowRunStatus.SKIPPED,
          summary: succeeded
            ? "Recommendation episode outcome is published."
            : `Recommendation episode finalization fenced: ${result.reason}.`,
          finishedAt: new Date(),
          details: {
            episodeId: input.episodeId,
            generation: input.generation,
            result: result.status,
            ...(result.status === "published" || result.status === "existing"
              ? {
                  revision: result.revision,
                  factWatermark: result.factWatermark,
                }
              : { reason: result.reason }),
          },
        },
      })
    }
    if (
      result.status === "fenced" &&
      result.reason === "not_ready" &&
      reason === "timeout"
    ) {
      const episode = await prisma.recommendationPlaybackEpisode.findUnique({
        where: { id: input.episodeId },
        select: {
          generation: true,
          activeUntil: true,
          request: { select: { expiresAt: true } },
        },
      })
      const now = new Date()
      if (
        episode?.generation === input.generation &&
        episode.request.expiresAt > now &&
        episode.activeUntil > now
      ) {
        const activeRuns = await findRecentActiveFinalizationRuns({
          episodeIds: [input.episodeId],
          now,
          excludeLedgerRunId: input.ledgerRunId,
        })
        if (activeRuns.length === 0) {
          // A claim can extend activeUntil after the selection-time wake has
          // already been persisted. If the claim-time dispatch was lost, the
          // stale wake durably replaces it here; the global recovery runner is
          // the independent fallback if this attachment also fails.
          await dispatchRecommendationEpisodeFinalization({
            episodeId: input.episodeId,
            generation: input.generation,
            reason: "timeout",
            notBefore: episode.activeUntil,
          })
        }
      }
    }
    return result
  } catch (error) {
    if (input.ledgerRunId) {
      await markWorkflowRunFailed(input.ledgerRunId, error).catch(() => {})
    }
    throw error
  }
}

async function classifyAndDispatchProfileOutcome(outcomeId: string) {
  const receipt =
    await createRecommendationIntegrityService(prisma).classifyPlaybackOutcome(
      outcomeId,
    )
  if (
    receipt.state !== "eligible" ||
    !receipt.eligibleScopes.includes("profile")
  ) {
    return
  }
  const outcome = await prisma.recommendationOutcomeRevision.findUnique({
    where: { id: outcomeId },
    select: {
      createdAt: true,
      episode: {
        select: {
          sessionDigest: true,
          request: {
            select: {
              experimentAssignment: {
                select: {
                  profileId: true,
                  privacyGeneration: true,
                  state: true,
                  profile: {
                    select: {
                      state: true,
                      tokenDigest: true,
                      privacyGeneration: true,
                      expiresAt: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  })
  const assignment = outcome?.episode.request.experimentAssignment
  if (
    !outcome ||
    !assignment?.profileId ||
    assignment.privacyGeneration == null ||
    assignment.state !== "ACTIVE" ||
    assignment.profile?.state !== "ACTIVE" ||
    assignment.profile.tokenDigest == null ||
    assignment.profile.privacyGeneration !== assignment.privacyGeneration ||
    assignment.profile.expiresAt <= new Date()
  ) {
    return
  }
  await dispatchRecommendationProfileFeedback({
    sessionDigest: outcome.episode.sessionDigest,
    profileId: assignment.profileId,
    privacyGeneration: assignment.privacyGeneration,
    evidenceWatermark: outcome.createdAt,
  })
}

export async function recoverRecommendationEpisodeFinalizations(
  input: {
    now?: Date
    limit?: number
    maxPages?: number
  } = {},
) {
  const now = input.now ?? new Date()
  const limit = Math.min(100, Math.max(1, input.limit ?? 100))
  const maxPages = Math.min(
    MAX_RECOVERY_PAGES,
    Math.max(1, input.maxPages ?? MAX_RECOVERY_PAGES),
  )
  type RecoveryCandidate = {
    id: string
    generation: number
    activeUntil: Date
    finalizationDueAt: Date
    hasTerminal: boolean
  }
  let cursor: Pick<RecoveryCandidate, "finalizationDueAt" | "id"> | null = null
  let pages = 0
  const totals = { scanned: 0, dispatched: 0, skipped: 0, failed: 0 }

  while (pages < maxPages) {
    const cursorPredicate: Prisma.Sql = cursor
      ? Prisma.sql`AND (episode."finalization_due_at", episode."id") > (${cursor.finalizationDueAt}, ${cursor.id})`
      : Prisma.empty
    const candidates: RecoveryCandidate[] = await prisma.$queryRaw<
      RecoveryCandidate[]
    >(Prisma.sql`
      WITH due AS MATERIALIZED (
        SELECT
          episode."id",
          episode."generation",
          episode."active_until" AS "activeUntil",
          episode."finalization_due_at" AS "finalizationDueAt"
        FROM "recommendation_playback_episode" episode
        WHERE episode."finalization_due_at" <= ${now}
          AND episode."expires_at" > ${now}
          ${cursorPredicate}
        ORDER BY episode."finalization_due_at" ASC, episode."id" ASC
        LIMIT ${limit}
      )
      SELECT
        due."id",
        due."generation",
        due."activeUntil",
        due."finalizationDueAt",
        COALESCE(terminal."hasTerminal", false) AS "hasTerminal"
      FROM due
      LEFT JOIN LATERAL (
        SELECT true AS "hasTerminal"
        FROM "recommendation_playback_fact" terminal_fact
        WHERE terminal_fact."episode_id" = due."id"
          AND terminal_fact."kind" IN ('playback_end', 'playback_error')
        LIMIT 1
      ) terminal ON true
      ORDER BY due."finalizationDueAt" ASC, due."id" ASC
      `)
    if (candidates.length === 0) break
    pages += 1
    totals.scanned += candidates.length

    const ready = candidates.map((episode) => {
      const factReady = episode.hasTerminal
      const timeoutReady = !episode.hasTerminal && episode.activeUntil <= now
      return { episode, factReady, timeoutReady }
    })
    const activeRuns = await findRecentActiveFinalizationRuns({
      episodeIds: ready.map(({ episode }) => episode.id),
      now,
    })
    const activeReasonsBySubject = new Map<string, Set<string | null>>()
    for (const run of activeRuns) {
      if (!run.subjectId) continue
      const reasons = activeReasonsBySubject.get(run.subjectId) ?? new Set()
      reasons.add(finalizationReason(run.details))
      activeReasonsBySubject.set(run.subjectId, reasons)
    }
    const dispatches = ready.flatMap(({ episode, factReady, timeoutReady }) => {
      if (!factReady && !timeoutReady) return []
      const activeReasons = activeReasonsBySubject.get(episode.id)
      if (!factReady && activeReasons && activeReasons.size > 0) {
        return []
      }
      if (
        factReady &&
        [...(activeReasons ?? [])].some(
          (activeReason) =>
            activeReason === "fact-advanced" ||
            activeReason === "terminal-fact" ||
            activeReason === "recovery",
        )
      ) {
        return []
      }
      return [
        {
          episodeId: episode.id,
          generation: episode.generation,
          reason: factReady ? ("recovery" as const) : ("timeout" as const),
          notBefore: now,
        },
      ]
    })

    let pageDispatched = 0
    let pageFailed = 0
    const concurrency = 4
    for (let offset = 0; offset < dispatches.length; offset += concurrency) {
      const settled = await Promise.allSettled(
        dispatches
          .slice(offset, offset + concurrency)
          .map((dispatch) =>
            dispatchRecommendationEpisodeFinalization(dispatch),
          ),
      )
      for (const result of settled) {
        if (result.status === "fulfilled") pageDispatched += 1
        else pageFailed += 1
      }
    }
    totals.dispatched += pageDispatched
    totals.failed += pageFailed
    totals.skipped += candidates.length - pageDispatched - pageFailed

    const last: RecoveryCandidate = candidates.at(-1)!
    cursor = { finalizationDueAt: last.finalizationDueAt, id: last.id }
    if (candidates.length < limit) break
  }

  return totals
}

export function nextRecommendationEpisodeFinalizationRecoveryAt(
  now: Date = new Date(),
): Date {
  return new Date(now.getTime() + RECOVERY_INTERVAL_MS)
}

export async function recordRecommendationEpisodeFinalizationRecoveryHeartbeat(
  ledgerRunId: string | undefined,
  nextRunAt: Date,
  totals: Awaited<ReturnType<typeof recoverRecommendationEpisodeFinalizations>>,
): Promise<void> {
  if (!ledgerRunId) return
  await prisma.workflowRun.update({
    where: { id: ledgerRunId },
    data: {
      status: WorkflowRunStatus.RUNNING,
      summary: `Recommendation finalization recovery sleeping until ${nextRunAt.toISOString()}.`,
      details: {
        nextRunAt: nextRunAt.toISOString(),
        intervalSeconds: RECOVERY_INTERVAL_MS / 1_000,
        lastSweep: totals,
      },
    },
  })
}

export async function markRecommendationEpisodeFinalizationRuntimeStarted(
  ledgerRunId: string | undefined,
  runtimeRunId: string,
): Promise<void> {
  if (!ledgerRunId) return
  await markWorkflowRunRuntimeStarted(ledgerRunId, runtimeRunId)
}

export async function ensureRecommendationEpisodeFinalizationRecovery(): Promise<{
  started: boolean
  runId?: string
  ledgerRunId?: string
}> {
  const reservation = await prisma.$transaction(async (tx) => {
    const lock = await tx.$queryRaw<Array<{ locked: boolean }>>`
      SELECT pg_try_advisory_xact_lock(${RECOVERY_RUNNER_LOCK_ID}) AS locked
    `
    if (!lock[0]?.locked) return { started: false as const }

    const existing = await tx.workflowRun.findFirst({
      where: {
        workflowKey: RECOVERY_WORKFLOW_KEY,
        status: { in: [WorkflowRunStatus.QUEUED, WorkflowRunStatus.RUNNING] },
      },
      orderBy: { updatedAt: "desc" },
    })
    const freshnessCutoff = new Date(Date.now() - RECOVERY_RUNNER_FRESH_MS)
    if (existing && existing.updatedAt >= freshnessCutoff) {
      return { started: false as const, ledgerRunId: existing.id }
    }
    if (existing) {
      await tx.workflowRun.update({
        where: { id: existing.id },
        data: {
          status: WorkflowRunStatus.FAILED,
          finishedAt: new Date(),
          summary:
            "Recommendation finalization recovery runner stale; starting a replacement.",
          error: "recovery_runner_stale",
        },
      })
    }
    const ledger = await createWorkflowRunLog(
      {
        workflowKey: RECOVERY_WORKFLOW_KEY,
        workflowName: "Recommendation Episode Finalization Recovery",
        trigger: "system",
        subjectType: "recommendation-playback-episode",
        subjectId: "recovery-runner",
        summary: "Recommendation finalization recovery runner queued.",
        details: { intervalSeconds: RECOVERY_INTERVAL_MS / 1_000 },
      },
      tx,
    )
    return { started: true as const, ledger }
  })

  if (!reservation.started) return reservation
  const { ledger } = reservation
  let runtime: Awaited<ReturnType<typeof start>>
  try {
    runtime = await start(runRecommendationEpisodeFinalizationRecovery, [
      { ledgerRunId: ledger.id },
    ])
  } catch (error) {
    await markWorkflowRunFailed(ledger.id, error).catch(() => {})
    throw error
  }
  await attachWorkflowRuntimeRunId(ledger.id, runtime.runId).catch(() => {
    console.warn(
      "Recommendation finalization recovery started before its runtime identity could be recorded; workflow self-reconciliation will retry.",
    )
  })
  return { started: true, runId: runtime.runId, ledgerRunId: ledger.id }
}
