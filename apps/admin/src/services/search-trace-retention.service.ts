import {
  Prisma,
  SearchEvalCandidatePromotionStatus,
  SeoExperimentStatus,
  SeoLessonStatus,
  WorkflowRunStatus,
  type PrismaClient,
} from "@prisma/client"
import { env } from "@/config/env"

export const SEARCH_TRACE_RETENTION_WORKFLOW_KEY = "search-trace-retention"
export const SEARCH_TRACE_RETENTION_SCHEDULER_WORKFLOW_KEY =
  "search-trace-retention-scheduler"
export const SEARCH_TRACE_RETENTION_HEALTH_WINDOW_MS = 36 * 60 * 60 * 1000
export const SEO_AUDIT_REDACTION_YEARS = 7

const SEO_AUDIT_REDACTION = { retention: "redacted" }
const SEO_TERMINAL_EXPERIMENT_STATUSES = [
  SeoExperimentStatus.BENEFICIAL,
  SeoExperimentStatus.NEUTRAL,
  SeoExperimentStatus.HARMFUL,
  SeoExperimentStatus.INCONCLUSIVE,
  SeoExperimentStatus.ROLLBACK_PROPOSED,
]

function sevenYearsBefore(now: Date): Date {
  const redactionBefore = new Date(now)
  redactionBefore.setUTCFullYear(
    redactionBefore.getUTCFullYear() - SEO_AUDIT_REDACTION_YEARS,
  )
  return redactionBefore
}

function terminalExperimentRetentionFilter() {
  return {
    OR: [
      { experiment: { is: null } },
      {
        experiment: {
          is: {
            legalHold: false,
            status: { in: SEO_TERMINAL_EXPERIMENT_STATUSES },
          },
        },
      },
    ],
  }
}

export type SearchTracePurgeResult = {
  purgedCount: number
  purgedRawTraceCount: number
  purgedGeneratedCandidateCount: number
  purgedWatchSearchEventCount: number
  purgedQueryEmbeddingCacheCount: number
  purgedSeoEvidenceObservationCount: number
  purgedSeoTicketOutboxAttemptCount: number
  purgedSeoApprovalNonceCount: number
  purgedSeoWorkloadAssertionCount: number
  purgedSeoLessonCount: number
  redactedSeoProposalVersionCount: number
  redactedSeoDecisionCount: number
  redactedSeoExperimentCount: number
  purgedBefore: string
  redactedBefore: string
}

export type SearchTraceRetentionHealth = {
  healthy: boolean
  reason: "not-production" | "scheduler-active" | "recent-purge" | "missing"
  latestPurgeAt: string | null
  activeSchedulerRunId: string | null
}

function toIsoOrNull(value: Date | null | undefined): string | null {
  return value == null ? null : value.toISOString()
}

export function isSearchTraceRetentionSchedulerFresh(
  scheduler: { updatedAt?: Date | null; createdAt?: Date | null },
  now: Date = new Date(),
): boolean {
  const heartbeatAt = scheduler.updatedAt ?? scheduler.createdAt ?? null
  if (heartbeatAt == null) return false
  const ageMs = now.getTime() - heartbeatAt.getTime()
  return ageMs >= 0 && ageMs <= SEARCH_TRACE_RETENTION_HEALTH_WINDOW_MS
}

export async function purgeExpiredSearchTraces(
  prisma: PrismaClient,
  now: Date = new Date(),
): Promise<SearchTracePurgeResult> {
  const redactionBefore = sevenYearsBefore(now)
  const terminalExperiment = {
    legalHold: false,
    status: { in: SEO_TERMINAL_EXPERIMENT_STATUSES },
  }
  const terminalProposalVersion = terminalExperimentRetentionFilter()
  const rawTraceResult = await prisma.searchTrace.deleteMany({
    where: {
      rawExpiresAt: {
        lte: now,
      },
    },
  })
  const generatedCandidateResult = await prisma.searchEvalCandidate.deleteMany({
    where: {
      retentionExpiresAt: {
        lte: now,
      },
      promotionStatus: {
        not: SearchEvalCandidatePromotionStatus.PROMOTED,
      },
    },
  })
  const watchSearchEventResult = await prisma.watchSearchEvent.deleteMany({
    where: {
      expiresAt: {
        lte: now,
      },
    },
  })
  const queryEmbeddingCacheResult = await prisma.queryEmbeddingCache.deleteMany(
    {
      where: {
        expiresAt: {
          lte: now,
        },
      },
    },
  )
  const seoEvidenceObservationResult =
    await prisma.seoEvidenceObservation.deleteMany({
      where: {
        expiresAt: { lte: now },
        run: {
          proposalVersions: {
            every: terminalProposalVersion,
          },
        },
      },
    })
  const seoTicketOutboxAttemptResult =
    await prisma.seoTicketOutboxAttempt.deleteMany({
      where: {
        expiresAt: { lte: now },
        outbox: {
          proposalVersion: terminalProposalVersion,
        },
      },
    })
  const seoApprovalNonceResult = await prisma.seoApprovalNonce.deleteMany({
    where: {
      expiresAt: { lte: now },
      proposalVersion: terminalProposalVersion,
    },
  })
  const seoWorkloadAssertionResult =
    await prisma.seoWorkloadAssertion.deleteMany({
      where: { expiresAt: { lte: now } },
    })
  const seoLessonResult = await prisma.seoLesson.deleteMany({
    where: {
      status: { in: [SeoLessonStatus.SUPERSEDED, SeoLessonStatus.RETIRED] },
      experiment: { is: terminalExperiment },
    },
  })
  const seoProposalVersionRedactionResult =
    await prisma.seoProposalVersion.updateMany({
      where: {
        createdAt: { lte: redactionBefore },
        ...terminalProposalVersion,
        preChangeSnapshot: { not: SEO_AUDIT_REDACTION },
      },
      data: {
        payload: SEO_AUDIT_REDACTION,
        preChangeSnapshot: SEO_AUDIT_REDACTION,
        treatmentSnapshot: SEO_AUDIT_REDACTION,
        editorialDiff: Prisma.JsonNull,
        engineeringBrief: Prisma.JsonNull,
        evidence: [],
        caveats: [],
      },
    })
  const seoDecisionRedactionResult = await prisma.seoDecision.updateMany({
    where: {
      decidedAt: { lte: redactionBefore },
      actorId: { not: "[redacted]" },
      proposalVersion: terminalProposalVersion,
    },
    data: {
      actorId: "[redacted]",
      reason: null,
      confounders: [],
    },
  })
  const seoExperimentRedactionResult = await prisma.seoExperiment.updateMany({
    where: {
      createdAt: { lte: redactionBefore },
      ...terminalExperiment,
      preChangeSnapshot: { not: SEO_AUDIT_REDACTION },
    },
    data: {
      preChangeSnapshot: SEO_AUDIT_REDACTION,
      treatmentSnapshot: SEO_AUDIT_REDACTION,
      confounders: [],
    },
  })

  return {
    purgedCount:
      rawTraceResult.count +
      generatedCandidateResult.count +
      watchSearchEventResult.count +
      queryEmbeddingCacheResult.count +
      seoEvidenceObservationResult.count +
      seoTicketOutboxAttemptResult.count +
      seoApprovalNonceResult.count +
      seoWorkloadAssertionResult.count +
      seoLessonResult.count +
      seoProposalVersionRedactionResult.count +
      seoDecisionRedactionResult.count +
      seoExperimentRedactionResult.count,
    purgedRawTraceCount: rawTraceResult.count,
    purgedGeneratedCandidateCount: generatedCandidateResult.count,
    purgedWatchSearchEventCount: watchSearchEventResult.count,
    purgedQueryEmbeddingCacheCount: queryEmbeddingCacheResult.count,
    purgedSeoEvidenceObservationCount: seoEvidenceObservationResult.count,
    purgedSeoTicketOutboxAttemptCount: seoTicketOutboxAttemptResult.count,
    purgedSeoApprovalNonceCount: seoApprovalNonceResult.count,
    purgedSeoWorkloadAssertionCount: seoWorkloadAssertionResult.count,
    purgedSeoLessonCount: seoLessonResult.count,
    redactedSeoProposalVersionCount: seoProposalVersionRedactionResult.count,
    redactedSeoDecisionCount: seoDecisionRedactionResult.count,
    redactedSeoExperimentCount: seoExperimentRedactionResult.count,
    purgedBefore: now.toISOString(),
    redactedBefore: redactionBefore.toISOString(),
  }
}

export async function readSearchTraceRetentionHealth(
  prisma: PrismaClient,
  now: Date = new Date(),
): Promise<SearchTraceRetentionHealth> {
  if (env.NODE_ENV !== "production") {
    return {
      healthy: true,
      reason: "not-production",
      latestPurgeAt: null,
      activeSchedulerRunId: null,
    }
  }

  const activeScheduler = await prisma.workflowRun.findFirst({
    where: {
      workflowKey: SEARCH_TRACE_RETENTION_SCHEDULER_WORKFLOW_KEY,
      status: {
        in: [WorkflowRunStatus.QUEUED, WorkflowRunStatus.RUNNING],
      },
    },
    orderBy: { updatedAt: "desc" },
  })

  if (
    activeScheduler &&
    isSearchTraceRetentionSchedulerFresh(activeScheduler, now)
  ) {
    return {
      healthy: true,
      reason: "scheduler-active",
      latestPurgeAt: null,
      activeSchedulerRunId: activeScheduler.id,
    }
  }

  const latestPurge = await prisma.workflowRun.findFirst({
    where: {
      workflowKey: SEARCH_TRACE_RETENTION_WORKFLOW_KEY,
      status: WorkflowRunStatus.SUCCEEDED,
    },
    orderBy: { finishedAt: "desc" },
  })
  const latestPurgeAt =
    latestPurge?.finishedAt ?? latestPurge?.updatedAt ?? null
  const latestPurgeAgeMs =
    latestPurgeAt == null
      ? Number.POSITIVE_INFINITY
      : now.getTime() - latestPurgeAt.getTime()

  if (latestPurgeAgeMs <= SEARCH_TRACE_RETENTION_HEALTH_WINDOW_MS) {
    return {
      healthy: true,
      reason: "recent-purge",
      latestPurgeAt: toIsoOrNull(latestPurgeAt),
      activeSchedulerRunId: null,
    }
  }

  return {
    healthy: false,
    reason: "missing",
    latestPurgeAt: toIsoOrNull(latestPurgeAt),
    activeSchedulerRunId: null,
  }
}
