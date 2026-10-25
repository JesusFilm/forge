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
export const SEO_RUN_DETAIL_RETENTION_DAYS = 29

const SEO_RUN_DETAIL_RETENTION_BATCH_SIZE = 100
export const SEO_RUN_DETAIL_RETENTION_MS =
  SEO_RUN_DETAIL_RETENTION_DAYS * 24 * 60 * 60 * 1000
const SEO_TERMINAL_RUN_STATUSES = ["COMPLETED", "PARTIAL", "FAILED"] as const

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
  compactedSeoRunReportCount: number
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

function jsonRecord(value: unknown): Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

export function sanitizeSeoProviderCoverage(
  value: unknown,
): Record<string, "available" | "partial" | "unavailable"> {
  return Object.fromEntries(
    Object.entries(jsonRecord(value))
      .slice(0, 20)
      .map(([provider, status]) => [
        provider.slice(0, 100),
        status === "available" || status === "partial" ? status : "unavailable",
      ]),
  )
}

function compactSeoProposalRefs(
  report: Prisma.JsonValue,
  proposalVersions: readonly {
    proposalId: string
    version: number
    payloadDigest: string
    runId: string
  }[],
) {
  const digest = /^[a-f0-9]{64}$/
  const refs = Array.isArray(jsonRecord(report).proposalRefs)
    ? (jsonRecord(report).proposalRefs as unknown[])
    : []
  const safeStoredRefs = refs.flatMap((value) => {
    const ref = jsonRecord(value)
    if (
      typeof ref.proposalId !== "string" ||
      ref.proposalId.length === 0 ||
      ref.proposalId.length > 191 ||
      typeof ref.payloadDigest !== "string" ||
      !digest.test(ref.payloadDigest)
    ) {
      return []
    }
    const version =
      typeof ref.version === "number" &&
      Number.isInteger(ref.version) &&
      ref.version > 0
        ? ref.version
        : null
    const originatingRunId =
      typeof ref.originatingRunId === "string" &&
      ref.originatingRunId.length > 0 &&
      ref.originatingRunId.length <= 191
        ? ref.originatingRunId
        : null
    const disposition =
      ref.disposition === "would_propose" ||
      ref.disposition === "persisted_new" ||
      ref.disposition === "reused_existing"
        ? ref.disposition
        : "would_propose"
    return [
      {
        proposalId: ref.proposalId,
        payloadDigest: ref.payloadDigest,
        disposition,
        version,
        originatingRunId,
      },
    ]
  })
  const canonicalRefs = proposalVersions.map((version) => ({
    proposalId: version.proposalId,
    payloadDigest: version.payloadDigest,
    disposition: "persisted_new" as const,
    version: version.version,
    originatingRunId: version.runId,
  }))
  return Array.from(
    new Map(
      [...safeStoredRefs, ...canonicalRefs].map((ref) => [
        `${ref.proposalId}:${ref.payloadDigest}`,
        ref,
      ]),
    ).values(),
  ).slice(0, 50)
}

function compactSeoRunReport(
  row: {
    id: string
    report: Prisma.JsonValue
    updatedAt: Date
    completedAt: Date | null
    eligibleCount: number
    selectedCount: number
    wouldProposeCount: number
    proposedCount: number
    providerCoverage: Prisma.JsonValue
    suppressedOperations: string[]
    proposalVersions: readonly {
      proposalId: string
      version: number
      payloadDigest: string
      runId: string
    }[]
  },
  now: Date,
): Prisma.InputJsonValue | null {
  if (row.completedAt == null) return null
  const detailExpiresAt = new Date(
    row.completedAt.getTime() + SEO_RUN_DETAIL_RETENTION_MS,
  )
  if (detailExpiresAt > now) return null
  const prior = jsonRecord(row.report)
  if (
    prior.detailState === "detail_expired" ||
    prior.detailState === "detail_suppressed_retention_unhealthy"
  ) {
    return null
  }
  return {
    schemaVersion: 1,
    detailState: "detail_expired",
    selectionPolicyId:
      typeof prior.selectionPolicyId === "string"
        ? prior.selectionPolicyId.slice(0, 191)
        : null,
    eligibleCount: row.eligibleCount,
    selectedCount: row.selectedCount,
    wouldProposeCount: row.wouldProposeCount,
    persistedProposalCount: row.proposedCount,
    providerCoverage: sanitizeSeoProviderCoverage(row.providerCoverage),
    suppressedOperations: row.suppressedOperations.slice(0, 100),
    proposalRefs: compactSeoProposalRefs(row.report, row.proposalVersions),
    detailExpiresAt: detailExpiresAt.toISOString(),
    compactedAt: now.toISOString(),
  }
}

export async function compactExpiredSeoRunReportById(
  prisma: PrismaClient,
  id: string,
  now: Date = new Date(),
): Promise<boolean> {
  const run = await prisma.seoRun.findUnique({
    where: { id },
    include: {
      proposalVersions: {
        select: {
          proposalId: true,
          version: true,
          payloadDigest: true,
          runId: true,
        },
      },
    },
  })
  if (run == null || !SEO_TERMINAL_RUN_STATUSES.includes(run.status as never)) {
    return false
  }
  const compacted = compactSeoRunReport(run, now)
  if (compacted == null) return false
  const result = await prisma.seoRun.updateMany({
    where: {
      id: run.id,
      status: { in: [...SEO_TERMINAL_RUN_STATUSES] },
      completedAt: run.completedAt,
      updatedAt: run.updatedAt,
    },
    data: { report: compacted },
  })
  return result.count === 1
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
  const seoRunDetailBefore = new Date(
    now.getTime() - SEO_RUN_DETAIL_RETENTION_MS,
  )
  const seoRunCandidateIds = await prisma.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`
      SELECT id
      FROM seo_run
      WHERE status::text IN ('completed', 'partial', 'failed')
        AND completed_at <= ${seoRunDetailBefore}
        AND COALESCE(report ->> 'detailState', '') NOT IN (
          'detail_expired',
          'detail_suppressed_retention_unhealthy'
        )
      ORDER BY updated_at ASC, id ASC
      LIMIT ${SEO_RUN_DETAIL_RETENTION_BATCH_SIZE}
    `,
  )
  const seoRuns =
    seoRunCandidateIds.length === 0
      ? []
      : await prisma.seoRun.findMany({
          where: { id: { in: seoRunCandidateIds.map((row) => row.id) } },
          orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
          include: {
            proposalVersions: {
              select: {
                proposalId: true,
                version: true,
                payloadDigest: true,
                runId: true,
              },
            },
          },
        })
  let compactedSeoRunReportCount = 0
  for (const run of seoRuns) {
    const compacted = compactSeoRunReport(run, now)
    if (compacted == null) continue
    const result = await prisma.seoRun.updateMany({
      where: {
        id: run.id,
        status: { in: [...SEO_TERMINAL_RUN_STATUSES] },
        completedAt: run.completedAt,
        updatedAt: run.updatedAt,
      },
      data: { report: compacted },
    })
    compactedSeoRunReportCount += result.count
  }

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
      seoExperimentRedactionResult.count +
      compactedSeoRunReportCount,
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
    compactedSeoRunReportCount,
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
