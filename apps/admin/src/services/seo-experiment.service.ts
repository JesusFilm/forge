import { createHash, randomUUID } from "node:crypto"
import { isIP } from "node:net"
import {
  Prisma,
  type PrismaClient,
  type SeoDecisionAction,
  type SeoAutomationMode,
  type SeoEvidenceProvider,
  type SeoLessonStatus,
  type SeoProposalLane,
  type SeoRunStatus,
} from "@prisma/client"
import { z } from "zod"
import { buildCanonicalWatchVideoPath } from "@forge/watch-url-policy/routes"
import { hasPermission } from "@/auth/permissions"
import type { Principal } from "@/auth/principal"
import type { VerifiedSeoApprovalAssertion } from "@/auth/seo-approval-assertion"
import type { VerifiedSeoWorkloadAssertion } from "@/auth/seo-service-assertion"
import { env } from "@/config/env"
import { ForbiddenError } from "./errors"
import {
  compactExpiredSeoRunReportById,
  readSearchTraceRetentionHealth,
  sanitizeSeoProviderCoverage,
  SEO_RUN_DETAIL_RETENTION_MS,
} from "./search-trace-retention.service"
import {
  SeoTargetConflictError,
  SeoTargetService,
  SeoTargetStaleError,
  seoContentHash,
  seoExperienceLocaleSnapshot,
  seoVideoLocaleSnapshot,
} from "./seo-target.service"

const SeoAutomationModeInput = z.enum(["off", "dry_run", "live"])
const SeoRunTerminalStatusInput = z.enum(["completed", "partial", "failed"])
const SeoEvidenceProviderInput = z.enum([
  "gsc",
  "ga4",
  "firecrawl",
  "direct_page",
  "grounded_search",
])
const Digest = z.string().regex(/^[a-f0-9]{64}$/)
const BoundedId = z.string().trim().min(1).max(191)
const BoundedText = z.string().trim().min(1).max(10_000)
const JsonValue = z.unknown()
const SeoCoverageValue = z.enum(["available", "partial", "unavailable"])
const SEO_RUN_REPORT_MAX_BYTES = 220 * 1024
const SeoLegacyRunReport = z
  .object({
    eligibleCount: z.number().int().nonnegative().optional(),
    observedCount: z.number().int().nonnegative().optional(),
    selectedCount: z.number().int().nonnegative().optional(),
    wouldProposeCount: z.number().int().nonnegative().optional(),
    persistedProposalCount: z.number().int().nonnegative().optional(),
    providerCoverage: z.record(z.string(), SeoCoverageValue).optional(),
    skippedTargetIds: z.array(z.string().max(200)).max(1_000).optional(),
    suppressedOperations: z.array(z.string().max(191)).max(100).optional(),
  })
  .strict()
const SeoRunQueryDecisionInput = z
  .object({
    observationId: BoundedId,
    targetId: BoundedId,
    locale: z.string().min(1).max(35),
    canonicalUrl: z.string().url().max(2_000),
    query: z.string().max(500),
    clicks: z.number().finite().nonnegative(),
    impressions: z.number().finite().nonnegative(),
    ctr: z.number().finite().nonnegative(),
    position: z.number().finite().nonnegative(),
    score: z.number().finite().nonnegative(),
    selectionOutcome: z.enum(["selected", "not_selected"]),
    reason: z.enum(["selected", "proposal_limit_reached"]),
  })
  .strict()
const SeoRunGscFilterInput = z
  .object({
    dimension: z.enum(["date", "query", "page", "country", "device"]),
    operator: z.enum([
      "equals",
      "notEquals",
      "contains",
      "notContains",
      "includingRegex",
      "excludingRegex",
    ]),
    expression: z.string().max(500),
  })
  .strict()
const SeoRunGscRequestInput = z
  .object({
    propertyId: z.string().min(1).max(500),
    startDate: z.string().date(),
    endDate: z.string().date(),
    dimensions: z.array(z.string().max(50)).max(5),
    searchType: z.literal("web"),
    dataState: z.enum(["final", "all", "hourly_all"]),
    filters: z.array(SeoRunGscFilterInput).max(20),
    omittedFilterCount: z.number().int().nonnegative().default(0),
    timezone: z.string().max(100),
    configuredRowCap: z.number().int().nonnegative(),
    returnedRowCount: z.number().int().nonnegative(),
    pageCount: z.number().int().nonnegative(),
    requestCount: z.number().int().nonnegative(),
    capReached: z.boolean(),
    responseAggregationType: z.string().max(100).nullable(),
    firstIncompleteDate: z.string().date().nullable(),
    status: SeoCoverageValue,
    caveats: z.array(z.string().max(500)).max(20),
    omittedCaveatCount: z.number().int().nonnegative().default(0),
  })
  .strict()
const SeoRunProposalRefInput = z
  .object({
    proposalId: BoundedId,
    payloadDigest: Digest,
    disposition: z.enum(["would_propose", "pending_persistence"]),
  })
  .strict()
const SeoRunReportV1Input = z
  .object({
    schemaVersion: z.literal(1),
    detailState: z.literal("available"),
    selectionPolicyId: z.literal("gsc-low-ctr-v1"),
    generatedAt: z.string().datetime(),
    eligibleCount: z.number().int().nonnegative(),
    observedCount: z.number().int().nonnegative(),
    selectedCount: z.number().int().nonnegative(),
    wouldProposeCount: z.number().int().nonnegative(),
    persistedProposalCount: z.number().int().nonnegative(),
    providerCoverage: z.record(z.string(), SeoCoverageValue),
    skippedTargetIds: z.array(z.string().max(200)).max(1_000),
    omittedSkippedTargetCount: z.number().int().nonnegative().default(0),
    suppressedOperations: z.array(z.string().max(191)).max(100),
    gscRequests: z.array(SeoRunGscRequestInput).max(50),
    omittedGscRequestCount: z.number().int().nonnegative().default(0),
    queryFunnel: z
      .object({
        providerRows: z.number().int().nonnegative(),
        malformedRows: z.number().int().nonnegative(),
        unmatchedTargetRows: z.number().int().nonnegative(),
        belowImpressionThresholdRows: z.number().int().nonnegative(),
        ctrThresholdNotMetRows: z.number().int().nonnegative(),
        rankedRows: z.number().int().nonnegative(),
        selectedQueryRows: z.number().int().nonnegative(),
        rejectedQueryRows: z.number().int().nonnegative(),
      })
      .strict(),
    queryDecisions: z.array(SeoRunQueryDecisionInput).max(100),
    omittedQueryDecisionCount: z.number().int().nonnegative(),
    proposalRefs: z.array(SeoRunProposalRefInput).max(50),
  })
  .strict()
const SeoRunReportInput = z.union([SeoRunReportV1Input, SeoLegacyRunReport])
const ExperimentableEngineeringBrief = z
  .object({
    ticketOnly: z.literal(false),
    deploymentProbe: z
      .object({
        type: z.enum(["page_text_hash", "response_header"]),
        expectedValue: z.string().trim().min(1).max(1_000),
        headerName: z
          .string()
          .regex(/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/)
          .max(191)
          .optional(),
      })
      .passthrough(),
  })
  .passthrough()

export const SeoObservationInput = z
  .object({
    observationKey: BoundedId,
    provider: SeoEvidenceProviderInput,
    schemaVersion: z.number().int().positive().max(100).default(1),
    scope: JsonValue.default({}),
    payload: JsonValue,
    citations: JsonValue.default([]),
    quality: JsonValue.default({}),
    payloadDigest: Digest,
    retrievedAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
  })
  .strict()

export const SeoProposalIngestInput = z
  .object({
    proposalId: BoundedId,
    version: z.number().int().positive(),
    idempotencyKey: BoundedId,
    payloadDigest: Digest,
    semanticConflictKey: z.string().trim().min(1).max(512),
    lane: z.enum(["editorial", "engineering", "rollback"]),
    targetType: z.enum(["VideoLocale", "ExperienceLocale", "Engineering"]),
    targetId: BoundedId.nullable(),
    canonicalUrl: z.string().url().max(2_000),
    locale: z.string().trim().min(1).max(35),
    canonicalIdentityDigest: Digest,
    baseContentHash: Digest.nullable(),
    intent: BoundedText,
    expectedOutcome: BoundedText,
    risk: BoundedText,
    verificationPlan: BoundedText,
    rollbackPlan: BoundedText,
    editorialDiff: JsonValue.nullable().default(null),
    engineeringBrief: JsonValue.nullable().default(null),
    evidence: JsonValue.default([]),
    caveats: z.array(z.string().max(2_000)).max(100).default([]),
    affectedFields: z.array(z.string().max(191)).max(100).default([]),
    payload: JsonValue,
    preChangeSnapshot: JsonValue,
    treatmentSnapshot: JsonValue,
    expiresAt: z.string().datetime(),
  })
  .strict()

export const SeoStartRunInput = z
  .object({
    action: z.literal("start_run"),
    idempotencyKey: BoundedId,
    mode: SeoAutomationModeInput,
    windowStart: z.string().datetime().nullable().optional(),
    windowEnd: z.string().datetime().nullable().optional(),
    targetLimit: z.number().int().min(1).max(5_000).default(1_000),
    leaseSeconds: z.number().int().min(60).max(1_800).default(900),
  })
  .strict()

export const SeoCompleteRunInput = z
  .object({
    action: z.literal("complete_run"),
    runId: BoundedId,
    claimGeneration: z.number().int().positive(),
    claimToken: BoundedId,
    status: SeoRunTerminalStatusInput,
    providerCoverage: JsonValue.default({}),
    report: SeoRunReportInput.default({}),
    eligibleCount: z.number().int().nonnegative().default(0),
    selectedCount: z.number().int().nonnegative().default(0),
    wouldProposeCount: z.number().int().nonnegative().default(0),
    suppressedOperations: z.array(z.string().max(191)).max(100).default([]),
    observations: z.array(SeoObservationInput).max(5_000).default([]),
    proposals: z.array(SeoProposalIngestInput).max(100).default([]),
  })
  .strict()

export const SeoIngestInput = z.discriminatedUnion("action", [
  SeoStartRunInput,
  SeoCompleteRunInput,
])

export const SeoEvaluateInput = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("claim_due"),
      claimId: BoundedId,
      limit: z.number().int().min(1).max(100).default(20),
    })
    .strict(),
  z
    .object({
      action: z.literal("record_result"),
      experimentId: BoundedId,
      claimGeneration: z.number().int().positive(),
      claimToken: BoundedId,
      kind: z.enum(["activation", "interim", "final"]),
      outcome: z.string().trim().min(1).max(191),
      metrics: JsonValue.default({}),
      evidenceDigest: Digest,
      confounders: JsonValue.default([]),
      observedAt: z.string().datetime(),
      observedActivationHash: Digest.nullable().optional(),
      activatedAt: z.string().datetime().nullable().optional(),
    })
    .strict(),
])

export const SeoTicketsInput = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("claim"),
      leaseSeconds: z.number().int().min(30).max(900).default(300),
    })
    .strict(),
  z
    .object({
      action: z.literal("complete"),
      outboxId: BoundedId,
      generation: z.number().int().positive(),
      leaseToken: BoundedId,
      remoteId: BoundedId,
      remoteUrl: z.string().url().max(2_000),
    })
    .strict(),
  z
    .object({
      action: z.literal("retry"),
      outboxId: BoundedId,
      generation: z.number().int().positive(),
      leaseToken: BoundedId,
      errorCode: z.string().trim().min(1).max(191),
      nextAttemptAt: z.string().datetime(),
    })
    .strict(),
  z
    .object({
      action: z.literal("manual_reconcile"),
      outboxId: BoundedId,
      generation: z.number().int().positive(),
      leaseToken: BoundedId,
      errorCode: z.string().trim().min(1).max(191),
      candidates: JsonValue.default([]),
    })
    .strict(),
])

type SeoTransaction = Prisma.TransactionClient

const PROPOSAL_INCLUDE = {
  versions: {
    orderBy: { version: "desc" as const },
    take: 1,
    include: {
      decision: true,
      materialization: true,
      ticketOutbox: {
        include: {
          attempts: { orderBy: { attemptedAt: "desc" as const }, take: 20 },
        },
      },
    },
  },
} satisfies Prisma.SeoProposalInclude

type ProposalWithDetails = Prisma.SeoProposalGetPayload<{
  include: typeof PROPOSAL_INCLUDE
}>

type ExperimentWithProposal = Prisma.SeoExperimentGetPayload<{
  include: { proposalVersion: { include: { proposal: true } } }
}>

type RecordEvaluationInput = Extract<
  z.infer<typeof SeoEvaluateInput>,
  { action: "record_result" }
>

type ProposalEvidenceRow = {
  runId: string
  observationKey: string
  provider: SeoEvidenceProvider
  quality: Prisma.JsonValue
  citations: Prisma.JsonValue
  retrievedAt: Date
}

function assertManagerSeoAccess(user: Principal | null) {
  if (!hasPermission(user, "read:manager-seo")) throw new ForbiddenError()
}

function enumMode(
  value: z.infer<typeof SeoAutomationModeInput>,
): SeoAutomationMode {
  return { off: "OFF", dry_run: "DRY_RUN", live: "LIVE" }[
    value
  ] as SeoAutomationMode
}

function normalizedMode(value: string): SeoAutomationMode {
  const mode = value.toUpperCase()
  if (mode === "LIVE" || mode === "DRY_RUN") return mode
  return "OFF"
}

function leastPermissiveMode(
  requested: SeoAutomationMode,
  persisted: SeoAutomationMode,
): SeoAutomationMode {
  const rank: Record<SeoAutomationMode, number> = {
    OFF: 0,
    DRY_RUN: 1,
    LIVE: 2,
  }
  return rank[requested] <= rank[persisted] ? requested : persisted
}

function enumRunStatus(
  value: z.infer<typeof SeoRunTerminalStatusInput>,
): SeoRunStatus {
  return { completed: "COMPLETED", partial: "PARTIAL", failed: "FAILED" }[
    value
  ] as SeoRunStatus
}

function enumProvider(
  value: z.infer<typeof SeoEvidenceProviderInput>,
): SeoEvidenceProvider {
  return {
    gsc: "GSC",
    ga4: "GA4",
    firecrawl: "FIRECRAWL",
    direct_page: "DIRECT_PAGE",
    grounded_search: "GROUNDED_SEARCH",
  }[value] as SeoEvidenceProvider
}

function enumLane(
  value: "editorial" | "engineering" | "rollback",
): SeoProposalLane {
  return {
    editorial: "EDITORIAL",
    engineering: "ENGINEERING",
    rollback: "ROLLBACK",
  }[value] as SeoProposalLane
}

function enumDecisionAction(value: string): SeoDecisionAction {
  return {
    approve: "APPROVE",
    reject: "REJECT",
    review_lesson: "REVIEW_LESSON",
    reconcile_ticket: "RECONCILE_TICKET",
  }[value] as SeoDecisionAction
}

function inputJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(
    JSON.stringify(redactSeoJson(value)),
  ) as Prisma.InputJsonValue
}

const SECRET_KEY =
  /token|secret|password|authorization|cookie|header|credential|api[_-]?key/i
const CREDENTIAL_VALUE =
  /\b(?:bearer\s+[a-z0-9._~+/=-]{12,}|(?:sk|ghp|github_pat|xox[baprs])-?[a-z0-9_-]{12,}|(?:token|secret|password|api[_-]?key)\s*[:=]\s*[^\s,;]{8,})\b/giu
const EMAIL_VALUE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu
const IP_VALUE = /\b(?:\d{1,3}\.){3}\d{1,3}\b/gu
const IPV6_CANDIDATE =
  /\[[0-9A-Fa-f:.]{2,64}\]|(?<![0-9A-Fa-f:.])[0-9A-Fa-f:.]{2,64}(?![0-9A-Fa-f:.])/gu
const PHONE_VALUE = /(?<!\w)(?:\+?\d[\d ().-]{7,}\d)(?!\w)/gu
const EMBEDDED_URL = /https?:\/\/[^\s<>"']+/giu
const TOKEN_LIKE = /\b[A-Za-z0-9_-]{40,}\b/gu
const SeoIsoDateValue = z.string().date()
const SeoIsoDateTimeValue = z.string().datetime()

function redactIpv6Candidate(value: string): string {
  const bracketed = value.startsWith("[") && value.endsWith("]")
  const candidate = bracketed ? value.slice(1, -1) : value.replace(/\.+$/u, "")
  const suffix = bracketed ? "" : value.slice(candidate.length)
  return isIP(candidate) === 6 ? `[redacted-ip]${suffix}` : value
}

function isSensitiveSeoKey(key: string): boolean {
  if (SECRET_KEY.test(key)) return true
  const words = key
    .replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .split(/[^A-Za-z0-9]+/u)
    .map((word) => word.toLowerCase())
  return words.some((word) => word === "ip" || word === "ipaddress")
}

function redactSeoText(value: string): string {
  const bounded = value.slice(0, 10_000)
  if (
    SeoIsoDateValue.safeParse(bounded).success ||
    SeoIsoDateTimeValue.safeParse(bounded).success
  ) {
    return bounded
  }
  return bounded
    .replace(CREDENTIAL_VALUE, "[redacted]")
    .replace(EMAIL_VALUE, "[redacted-email]")
    .replace(IPV6_CANDIDATE, redactIpv6Candidate)
    .replace(IP_VALUE, "[redacted-ip]")
    .replace(PHONE_VALUE, "[redacted-phone]")
}

function redactSeoQuery(value: string): string {
  return redactSeoText(
    value
      .replace(EMBEDDED_URL, "[redacted-url]")
      .replace(TOKEN_LIKE, "[redacted-token]"),
  ).slice(0, 500)
}

/** Bounded redaction seam shared by every SEO persistence operation. */
export function redactSeoJson(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[depth_limit]"
  if (typeof value === "string") {
    const truncated = redactSeoText(value)
    try {
      const url = new URL(truncated)
      if (url.protocol === "https:" || url.protocol === "http:") {
        url.username = ""
        url.password = ""
        url.search = ""
        url.hash = ""
        return url.toString()
      }
    } catch {
      // Ordinary text, not a URL.
    }
    return truncated
  }
  if (Array.isArray(value)) {
    return value.slice(0, 100).map((item) => redactSeoJson(item, depth + 1))
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 100)
        .map(([key, nested]) => [
          key,
          isSensitiveSeoKey(key)
            ? "[redacted]"
            : redactSeoJson(nested, depth + 1),
        ]),
    )
  }
  return value
}

const SeoRunStoredProposalRef = z
  .object({
    proposalId: BoundedId,
    payloadDigest: Digest,
    disposition: z.enum(["would_propose", "persisted_new", "reused_existing"]),
    version: z.number().int().positive().nullable(),
    originatingRunId: BoundedId.nullable(),
  })
  .strict()
const SeoRunReportV1Stored = SeoRunReportV1Input.omit({
  proposalRefs: true,
}).extend({
  proposalRefs: z.array(SeoRunStoredProposalRef).max(50),
})
const SeoRunCompactReport = z
  .object({
    schemaVersion: z.literal(1),
    detailState: z.enum([
      "detail_expired",
      "detail_suppressed_retention_unhealthy",
    ]),
    selectionPolicyId: z.string().max(191).nullable(),
    eligibleCount: z.number().int().nonnegative(),
    selectedCount: z.number().int().nonnegative(),
    wouldProposeCount: z.number().int().nonnegative(),
    persistedProposalCount: z.number().int().nonnegative(),
    providerCoverage: z.record(z.string(), SeoCoverageValue),
    suppressedOperations: z.array(z.string().max(191)).max(100),
    proposalRefs: z.array(SeoRunStoredProposalRef).max(50),
    detailExpiresAt: z.string().datetime().nullable(),
    compactedAt: z.string().datetime(),
  })
  .strict()
type SeoRunStoredReport = z.infer<typeof SeoRunReportV1Stored>

type PersistedProposalOutcome = {
  proposalId: string
  payloadDigest: string
  disposition: "persisted_new" | "reused_existing"
  version: number
  originatingRunId: string
}

function storedSeoRunReportBytes(report: Prisma.InputJsonValue): number {
  return Buffer.byteLength(JSON.stringify(report), "utf8")
}

function fitStoredSeoRunReport(
  report: SeoRunStoredReport,
): Prisma.InputJsonValue {
  const skippedTargetIds = [...report.skippedTargetIds]
  const bounded: SeoRunStoredReport = {
    ...report,
    skippedTargetIds,
    omittedSkippedTargetCount: report.omittedSkippedTargetCount,
    gscRequests: report.gscRequests.map((request) => ({
      ...request,
      filters: [...request.filters],
      caveats: [...request.caveats],
    })),
    queryDecisions: [...report.queryDecisions],
    proposalRefs: [...report.proposalRefs],
  }
  const serialize = () => {
    const sanitized = inputJson(SeoRunReportV1Stored.parse(bounded))
    return SeoRunReportV1Stored.parse(sanitized) as Prisma.InputJsonValue
  }
  let stored = serialize()
  let storedBytes = storedSeoRunReportBytes(stored)
  const trimCount = (available: number) =>
    Math.min(
      available,
      Math.max(
        1,
        Math.ceil(
          (available * (storedBytes - SEO_RUN_REPORT_MAX_BYTES)) / storedBytes,
        ),
      ),
    )
  while (storedBytes > SEO_RUN_REPORT_MAX_BYTES) {
    if (bounded.skippedTargetIds.length > 0) {
      const count = trimCount(bounded.skippedTargetIds.length)
      bounded.skippedTargetIds.splice(-count, count)
      bounded.omittedSkippedTargetCount += count
    } else {
      const rejectedIndexes = bounded.queryDecisions.flatMap(
        (decision, index) =>
          decision.selectionOutcome === "not_selected" ? [index] : [],
      )
      if (rejectedIndexes.length > 0) {
        const count = trimCount(rejectedIndexes.length)
        for (const index of rejectedIndexes.slice(-count).reverse()) {
          bounded.queryDecisions.splice(index, 1)
        }
        bounded.omittedQueryDecisionCount += count
      } else {
        const caveatCount = bounded.gscRequests.reduce(
          (total, request) => total + request.caveats.length,
          0,
        )
        if (caveatCount > 0) {
          let remaining = trimCount(caveatCount)
          for (
            let index = bounded.gscRequests.length - 1;
            index >= 0 && remaining > 0;
            index -= 1
          ) {
            const request = bounded.gscRequests[index]!
            const count = Math.min(remaining, request.caveats.length)
            request.caveats.splice(-count, count)
            request.omittedCaveatCount += count
            remaining -= count
          }
        } else {
          const filterCount = bounded.gscRequests.reduce(
            (total, request) => total + request.filters.length,
            0,
          )
          if (filterCount > 0) {
            let remaining = trimCount(filterCount)
            for (
              let index = bounded.gscRequests.length - 1;
              index >= 0 && remaining > 0;
              index -= 1
            ) {
              const request = bounded.gscRequests[index]!
              const count = Math.min(remaining, request.filters.length)
              request.filters.splice(-count, count)
              request.omittedFilterCount += count
              remaining -= count
            }
          } else if (bounded.gscRequests.length > 0) {
            const count = trimCount(bounded.gscRequests.length)
            bounded.gscRequests.splice(-count, count)
            bounded.omittedGscRequestCount += count
          } else if (bounded.queryDecisions.length > 0) {
            const count = trimCount(bounded.queryDecisions.length)
            bounded.queryDecisions.splice(-count, count)
            bounded.omittedQueryDecisionCount += count
          } else {
            throw new SeoLedgerConflictError("report_size_limit_exceeded")
          }
        }
      }
    }
    stored = serialize()
    storedBytes = storedSeoRunReportBytes(stored)
  }
  return stored
}

function canonicalSeoRunReport(
  report: z.infer<typeof SeoRunReportInput>,
  mode: SeoAutomationMode,
  proposalOutcomes: readonly PersistedProposalOutcome[],
  retainDetail: boolean,
): Prisma.InputJsonValue {
  const v1 = SeoRunReportV1Input.safeParse(report)
  if (!v1.success) return inputJson(SeoLegacyRunReport.parse(report))
  const outcomeByIdentity = new Map(
    proposalOutcomes.map((outcome) => [
      `${outcome.proposalId}:${outcome.payloadDigest}`,
      outcome,
    ]),
  )
  const proposalRefs = v1.data.proposalRefs.map((reference) => {
    if (mode !== "LIVE") {
      return {
        proposalId: reference.proposalId,
        payloadDigest: reference.payloadDigest,
        disposition: "would_propose" as const,
        version: null,
        originatingRunId: null,
      }
    }
    const outcome = outcomeByIdentity.get(
      `${reference.proposalId}:${reference.payloadDigest}`,
    )
    if (!outcome) {
      throw new SeoLedgerConflictError("report_proposal_reference_missing")
    }
    return outcome
  })
  const normalized = SeoRunReportV1Stored.parse({
    ...v1.data,
    providerCoverage: sanitizeSeoProviderCoverage(v1.data.providerCoverage),
    persistedProposalCount: mode === "LIVE" ? proposalOutcomes.length : 0,
    queryDecisions: v1.data.queryDecisions.map((decision) => ({
      ...decision,
      query: redactSeoQuery(decision.query),
      canonicalUrl: redactSeoJson(decision.canonicalUrl),
    })),
    gscRequests: v1.data.gscRequests.map((request) => ({
      ...request,
      propertyId: redactSeoText(request.propertyId).slice(0, 500),
      filters: request.filters.map((filter) => ({
        ...filter,
        expression: redactSeoQuery(filter.expression),
      })),
      caveats: request.caveats.map((caveat) =>
        redactSeoText(caveat).slice(0, 500),
      ),
    })),
    proposalRefs,
  })
  if (!retainDetail) {
    return inputJson(
      SeoRunCompactReport.parse({
        schemaVersion: 1,
        detailState: "detail_suppressed_retention_unhealthy",
        selectionPolicyId: normalized.selectionPolicyId,
        eligibleCount: normalized.eligibleCount,
        selectedCount: normalized.selectedCount,
        wouldProposeCount: normalized.wouldProposeCount,
        persistedProposalCount: normalized.persistedProposalCount,
        providerCoverage: normalized.providerCoverage,
        suppressedOperations: Array.from(
          new Set([
            ...normalized.suppressedOperations,
            "query_detail_retention_unhealthy",
          ]),
        ),
        proposalRefs: normalized.proposalRefs,
        detailExpiresAt: null,
        compactedAt: normalized.generatedAt,
      }),
    )
  }
  return fitStoredSeoRunReport(normalized)
}

function iso(value: Date | null | undefined) {
  return value?.toISOString() ?? null
}

export function isExperimentableEngineeringBrief(value: unknown): boolean {
  return engineeringExpectedActivationHash(value) !== null
}

function engineeringExpectedActivationHash(value: unknown): string | null {
  const parsed = ExperimentableEngineeringBrief.safeParse(value)
  if (!parsed.success) return null
  const probe = parsed.data.deploymentProbe
  if (probe.type === "page_text_hash") {
    return Digest.safeParse(probe.expectedValue).success
      ? probe.expectedValue
      : null
  }
  if (!probe.headerName) return null
  return createHash("sha256").update(probe.expectedValue).digest("hex")
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : []
}

function evidenceRecord(row: ProposalEvidenceRow) {
  const quality = record(row.quality)
  const caveats = strings(quality.caveats)
  const firstCitation = Array.isArray(row.citations)
    ? record(row.citations[0])
    : {}
  return {
    id: row.observationKey,
    provider: row.provider,
    status: typeof quality.status === "string" ? quality.status : "unavailable",
    summary:
      caveats[0] ??
      `${row.provider} supplied a bounded retained observation for this proposal.`,
    retrievedAt: row.retrievedAt.toISOString(),
    sourceUrl:
      typeof firstCitation.url === "string" ? firstCitation.url : undefined,
    quality:
      quality.complete === true
        ? "complete"
        : quality.truncated === true
          ? "truncated"
          : "partial",
    coverage: caveats.slice(1, 4).join(" ") || undefined,
  }
}

function proposalEvidenceIds(value: Prisma.JsonValue): string[] {
  return strings(value).slice(0, 50)
}

function proposalRecord(
  row: ProposalWithDetails,
  evidenceByKey: ReadonlyMap<string, ProposalEvidenceRow> = new Map(),
  overlapCount = 0,
) {
  const version = row.versions[0]
  if (!version) throw new Error("SEO proposal has no version")
  const embeddedEvidence = Array.isArray(version.evidence)
    ? version.evidence.filter(
        (item) => item && typeof item === "object" && !Array.isArray(item),
      )
    : []
  const resolvedEvidence = proposalEvidenceIds(version.evidence).flatMap(
    (observationKey) => {
      const observation = evidenceByKey.get(
        `${version.runId}:${observationKey}`,
      )
      return observation ? [evidenceRecord(observation)] : []
    },
  )
  return {
    id: row.id,
    version: version.version,
    payloadDigest: version.payloadDigest,
    status: row.status,
    lane: row.lane,
    targetType: row.targetType,
    targetId: row.targetId,
    canonicalUrl: row.canonicalUrl,
    locale: row.locale,
    intent: version.intent,
    expectedOutcome: version.expectedOutcome,
    risk: version.risk,
    verificationPlan: version.verificationPlan,
    rollbackPlan: version.rollbackPlan,
    editorialDiff: version.editorialDiff,
    engineeringBrief: version.engineeringBrief,
    evidence: resolvedEvidence.length > 0 ? resolvedEvidence : embeddedEvidence,
    caveats: version.caveats,
    overlapCount,
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    decision: version.decision
      ? {
          id: version.decision.id,
          action: version.decision.action,
          actorId: version.decision.actorId,
          overlapAcknowledged: version.decision.overlapAcknowledged,
          overlapCount: version.decision.overlapCount,
          reason: version.decision.reason,
          decidedAt: version.decision.decidedAt.toISOString(),
        }
      : null,
    materialization: version.materialization
      ? {
          status: version.materialization.status,
          draftRevisionId: version.materialization.contentRevisionId,
          editorPath: version.materialization.editorPath,
          ticketOutboxId: version.ticketOutbox?.id ?? null,
        }
      : null,
  }
}

export type ManagerSeoProposalRecord = ReturnType<typeof proposalRecord>

type SeoRunCursor = { startedAt: string; id: string }
type SeoRunReportAvailability =
  | "running"
  | "available"
  | "legacy_unavailable"
  | "malformed"
  | "unsupported_version"
  | "detail_expired"
  | "detail_suppressed_retention_unhealthy"
type SeoRunSummaryRow = {
  id: string
  mode: SeoAutomationMode
  status: SeoRunStatus
  startedAt: Date
  completedAt: Date | null
  eligibleCount: number
  selectedCount: number
  wouldProposeCount: number
  proposedCount: number
  materializationCount: number
  ticketCount: number
  experimentCount: number
  suppressedOperations: string[]
  providerCoverage: Prisma.JsonValue
  executionFenceGeneration: number
}
type SeoRunSummaryProjectionRow = SeoRunSummaryRow & {
  reportJsonType: string | null
  reportSchemaVersion: string | null
  reportDetailState: string | null
  reportV1ShapeCompatible: boolean
  reportLegacyCompatible: boolean
}

function encodeSeoRunCursor(cursor: SeoRunCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url")
}

function decodeSeoRunCursor(
  value: string | null | undefined,
): SeoRunCursor | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"))
    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof parsed.startedAt !== "string" ||
      !Number.isFinite(new Date(parsed.startedAt).getTime()) ||
      typeof parsed.id !== "string" ||
      parsed.id.length === 0 ||
      parsed.id.length > 191
    ) {
      throw new Error("invalid")
    }
    return { startedAt: parsed.startedAt, id: parsed.id }
  } catch {
    throw new SeoLedgerConflictError("run_cursor_invalid")
  }
}

function seoRunReportAvailability(
  report: Prisma.JsonValue,
  completedAt: Date | null,
  now: Date,
): SeoRunReportAvailability {
  if (!completedAt) return "running"
  const value = record(report)
  if (value.detailState === "detail_suppressed_retention_unhealthy") {
    return "detail_suppressed_retention_unhealthy"
  }
  if (value.detailState === "detail_expired") return "detail_expired"
  if (typeof value.schemaVersion === "number" && value.schemaVersion !== 1) {
    return "unsupported_version"
  }
  if (SeoRunReportV1Stored.safeParse(report).success) {
    return now.getTime() - completedAt.getTime() >= SEO_RUN_DETAIL_RETENTION_MS
      ? "detail_expired"
      : "available"
  }
  if (value.schemaVersion === 1) return "malformed"
  return SeoLegacyRunReport.safeParse(report).success
    ? "legacy_unavailable"
    : "malformed"
}

function projectedSeoRunReportAvailability(
  row: SeoRunSummaryProjectionRow,
  now: Date,
): SeoRunReportAvailability {
  if (!row.completedAt) return "running"
  if (row.reportDetailState === "detail_suppressed_retention_unhealthy") {
    return "detail_suppressed_retention_unhealthy"
  }
  if (row.reportDetailState === "detail_expired") return "detail_expired"
  if (row.reportSchemaVersion != null) {
    if (Number(row.reportSchemaVersion) !== 1) return "unsupported_version"
    if (!row.reportV1ShapeCompatible) return "malformed"
    return now.getTime() - row.completedAt.getTime() >=
      SEO_RUN_DETAIL_RETENTION_MS
      ? "detail_expired"
      : "available"
  }
  return row.reportJsonType === "object" && row.reportLegacyCompatible
    ? "legacy_unavailable"
    : "malformed"
}

function seoRunSummaryRecord(
  row: SeoRunSummaryRow,
  reportAvailability: SeoRunReportAvailability,
) {
  return {
    id: row.id,
    mode: row.mode,
    status: row.status,
    startedAt: row.startedAt.toISOString(),
    completedAt: iso(row.completedAt),
    eligibleCount: row.eligibleCount,
    selectedCount: row.selectedCount,
    wouldProposeCount: row.wouldProposeCount,
    proposedCount: row.proposedCount,
    materializationCount: row.materializationCount,
    ticketCount: row.ticketCount,
    experimentCount: row.experimentCount,
    suppressedOperations: row.suppressedOperations,
    providerCoverage: sanitizeSeoProviderCoverage(row.providerCoverage),
    reportAvailability,
    reclaimed: row.executionFenceGeneration > 1,
  }
}

export type ManagerSeoRunSummaryRecord = ReturnType<typeof seoRunSummaryRecord>

export class SeoExperimentService {
  private readonly targets = new SeoTargetService()

  constructor(private readonly prisma: PrismaClient) {}

  async startRun({
    assertion,
    input,
  }: {
    assertion: VerifiedSeoWorkloadAssertion
    input: z.infer<typeof SeoStartRunInput>
  }) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            await this.consumeWorkloadAssertion(tx, assertion)
            const mode = leastPermissiveMode(
              enumMode(input.mode),
              await this.lockAutomationMode(tx),
            )
            const now = new Date()
            const runId = randomUUID()
            const claimToken = randomUUID()
            const claimTokenHash = createHash("sha256")
              .update(claimToken)
              .digest("hex")
            const claimExpiresAt = new Date(
              now.getTime() + input.leaseSeconds * 1_000,
            )
            let run = await tx.seoRun.upsert({
              where: { idempotencyKey: input.idempotencyKey },
              update: {},
              create: {
                id: runId,
                idempotencyKey: input.idempotencyKey,
                mode,
                windowStart: input.windowStart
                  ? new Date(input.windowStart)
                  : null,
                windowEnd: input.windowEnd ? new Date(input.windowEnd) : null,
                ...(mode === "OFF"
                  ? {
                      status: "COMPLETED" as const,
                      completedAt: now,
                      suppressedOperations: [
                        "provider_work",
                        "proposal_persistence",
                      ],
                    }
                  : {
                      executionFenceGeneration: 1,
                      executionClaimTokenHash: claimTokenHash,
                      executionClaimExpiresAt: claimExpiresAt,
                    }),
              },
            })
            let executionClaim =
              run.id === runId && mode !== "OFF"
                ? {
                    generation: 1,
                    token: claimToken,
                    expiresAt: claimExpiresAt.toISOString(),
                  }
                : null
            let replayed = run.id !== runId
            if (
              replayed &&
              run.status === "RUNNING" &&
              (!run.executionClaimExpiresAt ||
                run.executionClaimExpiresAt <= now)
            ) {
              if (mode === "OFF") {
                const terminalized = await tx.seoRun.updateMany({
                  where: {
                    id: run.id,
                    status: "RUNNING",
                    OR: [
                      { executionClaimExpiresAt: null },
                      { executionClaimExpiresAt: { lte: now } },
                    ],
                  },
                  data: {
                    status: "COMPLETED",
                    mode: "OFF",
                    executionClaimTokenHash: null,
                    executionClaimExpiresAt: null,
                    suppressedOperations: {
                      set: ["provider_work", "proposal_persistence"],
                    },
                    completedAt: now,
                  },
                })
                if (terminalized.count === 1) {
                  run = await tx.seoRun.findUniqueOrThrow({
                    where: { id: run.id },
                  })
                }
              } else {
                const reclaimedMode = leastPermissiveMode(run.mode, mode)
                const reclaimed = await tx.seoRun.updateMany({
                  where: {
                    id: run.id,
                    status: "RUNNING",
                    OR: [
                      { executionClaimExpiresAt: null },
                      { executionClaimExpiresAt: { lte: now } },
                    ],
                  },
                  data: {
                    mode: reclaimedMode,
                    executionFenceGeneration: { increment: 1 },
                    executionClaimTokenHash: claimTokenHash,
                    executionClaimExpiresAt: claimExpiresAt,
                  },
                })
                if (reclaimed.count === 1) {
                  run = await tx.seoRun.findUniqueOrThrow({
                    where: { id: run.id },
                  })
                  executionClaim = {
                    generation: run.executionFenceGeneration,
                    token: claimToken,
                    expiresAt: claimExpiresAt.toISOString(),
                  }
                  replayed = false
                }
              }
            }
            const context = await this.loadRunContext(tx, input.targetLimit)
            return {
              ...this.runRecord(run),
              ...context,
              executionClaim,
              replayed,
            }
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        )
      } catch (error) {
        if (
          !(
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === "P2034"
          ) ||
          attempt === 2
        ) {
          throw error
        }
        await new Promise((resolve) =>
          setTimeout(
            resolve,
            10 * 2 ** attempt + Math.floor(Math.random() * 10),
          ),
        )
      }
    }
    throw new SeoLedgerConflictError("run_start_retry_exhausted")
  }

  async completeRun({
    assertion,
    input,
  }: {
    assertion: VerifiedSeoWorkloadAssertion
    input: z.infer<typeof SeoCompleteRunInput>
  }) {
    const retentionHealth = await readSearchTraceRetentionHealth(
      this.prisma,
    ).catch(() => ({ healthy: false as const }))
    return this.prisma.$transaction(
      async (tx) => {
        await this.consumeWorkloadAssertion(tx, assertion)
        const run = await tx.seoRun.findUnique({ where: { id: input.runId } })
        if (!run) throw new SeoLedgerConflictError("run_not_found")
        if (run.status !== "RUNNING") {
          if (run.status !== enumRunStatus(input.status)) {
            throw new SeoLedgerConflictError("run_fence_lost")
          }
          return { ...this.runRecord(run), replayed: true }
        }
        const now = new Date()
        const claimTokenHash = createHash("sha256")
          .update(input.claimToken)
          .digest("hex")
        const consumedClaim = await tx.seoRun.updateMany({
          where: {
            id: run.id,
            status: "RUNNING",
            executionFenceGeneration: input.claimGeneration,
            executionClaimTokenHash: claimTokenHash,
          },
          data: {
            executionClaimTokenHash: null,
            executionClaimExpiresAt: null,
          },
        })
        if (consumedClaim.count !== 1) {
          throw new SeoLedgerConflictError("run_fence_lost")
        }
        const effectiveMode = leastPermissiveMode(
          run.mode,
          await this.lockAutomationMode(tx),
        )
        if (effectiveMode === "LIVE" && input.observations.length > 0) {
          await tx.seoEvidenceObservation.createMany({
            data: input.observations.map((observation) => ({
              runId: run.id,
              observationKey: observation.observationKey,
              provider: enumProvider(observation.provider),
              schemaVersion: observation.schemaVersion,
              scope: inputJson(observation.scope),
              payload: inputJson(observation.payload),
              citations: inputJson(observation.citations),
              quality: inputJson(observation.quality),
              payloadDigest: observation.payloadDigest,
              retrievedAt: new Date(observation.retrievedAt),
              expiresAt: new Date(observation.expiresAt),
            })),
          })
        }
        const proposalOutcomes: PersistedProposalOutcome[] = []
        if (effectiveMode === "LIVE") {
          for (const proposal of input.proposals) {
            proposalOutcomes.push(
              await this.persistProposal(tx, run.id, proposal),
            )
          }
        }
        const proposedCount = proposalOutcomes.filter(
          (outcome) =>
            outcome.disposition === "persisted_new" &&
            outcome.originatingRunId === run.id,
        ).length
        const report = canonicalSeoRunReport(
          input.report,
          effectiveMode,
          proposalOutcomes,
          retentionHealth.healthy,
        )
        const completed = await tx.seoRun.update({
          where: { id: run.id },
          data: {
            status: enumRunStatus(input.status),
            mode: effectiveMode,
            providerCoverage: inputJson(
              sanitizeSeoProviderCoverage(input.providerCoverage),
            ),
            report,
            eligibleCount: input.eligibleCount,
            selectedCount: input.selectedCount,
            wouldProposeCount: input.wouldProposeCount,
            proposedCount,
            suppressedOperations:
              effectiveMode === "LIVE"
                ? input.suppressedOperations
                : Array.from(
                    new Set([
                      ...input.suppressedOperations,
                      "proposal_persistence",
                      "draft_materialization",
                      "ticket_creation",
                      "experiment_creation",
                    ]),
                  ),
            completedAt: now,
          },
        })
        return { ...this.runRecord(completed), replayed: false }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    )
  }

  async listWorkspace({
    user,
    limit = 50,
  }: {
    user: Principal | null
    limit?: number
  }) {
    assertManagerSeoAccess(user)
    const take = Math.min(100, Math.max(1, limit))
    const [proposals, experiments, lessons, reconciliations] =
      await Promise.all([
        this.prisma.seoProposal.findMany({
          where: {
            status: { in: ["PROPOSED", "APPROVED", "MATERIALIZED", "STALE"] },
          },
          orderBy: [{ status: "asc" }, { createdAt: "desc" }],
          take,
          include: PROPOSAL_INCLUDE,
        }),
        this.prisma.seoExperiment.findMany({
          orderBy: { updatedAt: "desc" },
          take,
          include: {
            proposalVersion: { include: { proposal: true } },
            evaluations: {
              orderBy: { observedAt: "desc" },
              take: 50,
            },
          },
        }),
        this.prisma.seoLesson.findMany({
          orderBy: { createdAt: "desc" },
          take,
          include: {
            experiment: {
              include: { proposalVersion: { include: { proposal: true } } },
            },
          },
        }),
        this.prisma.seoTicketOutbox.findMany({
          where: { status: "MANUAL_RECONCILE" },
          orderBy: { updatedAt: "desc" },
          take,
          include: {
            proposalVersion: { include: { proposal: true } },
            attempts: { orderBy: { attemptedAt: "desc" }, take: 20 },
          },
        }),
      ])
    const { evidenceByKey, overlapCountByProposalId } =
      await this.loadProposalContext(proposals)
    return {
      generatedAt: new Date().toISOString(),
      proposals: proposals.map((proposal) =>
        proposalRecord(
          proposal,
          evidenceByKey,
          overlapCountByProposalId.get(proposal.id) ?? 0,
        ),
      ),
      experiments: experiments.map((row) => ({
        id: row.id,
        proposalId: row.proposalVersion.proposal.id,
        proposalVersion: row.proposalVersion.version,
        status: row.status,
        canonicalUrl: row.proposalVersion.proposal.canonicalUrl,
        locale: row.proposalVersion.proposal.locale,
        lane: row.proposalVersion.proposal.lane,
        activatedAt: iso(row.activatedAt),
        observedActivationHash: row.observedActivationHash,
        measurementStartsAt: iso(row.measurementStartsAt),
        interimDueAt: iso(row.interimDueAt),
        finalDueAt: iso(row.finalDueAt),
        confounders: row.confounders,
        evaluations: [...row.evaluations].reverse().map((event) => ({
          id: event.id,
          kind: event.kind,
          outcome: event.outcome,
          metrics: event.metrics,
          evidenceDigest: event.evidenceDigest,
          confounders: event.confounders,
          observedAt: event.observedAt.toISOString(),
        })),
      })),
      lessons: lessons.map((row) => ({
        id: row.id,
        experimentId: row.experimentId,
        proposalId: row.experiment.proposalVersion.proposal.id,
        proposalVersion: row.experiment.proposalVersion.version,
        status: row.status,
        content: row.content,
        evidenceDigest: row.evidenceDigest,
        metrics: row.metrics,
        confounders: row.confounders,
        reviewedById: row.reviewedById,
        reviewedAt: iso(row.reviewedAt),
        createdAt: row.createdAt.toISOString(),
      })),
      ticketReconciliations: reconciliations.map((row) =>
        this.ticketRecord(row),
      ),
    }
  }

  async listRuns({
    user,
    limit = 25,
    after,
  }: {
    user: Principal | null
    limit?: number
    after?: string | null
  }) {
    assertManagerSeoAccess(user)
    const take = Math.min(25, Math.max(1, limit))
    const cursor = decodeSeoRunCursor(after)
    const cursorFilter = cursor
      ? Prisma.sql`
          WHERE started_at < ${new Date(cursor.startedAt)}
             OR (started_at = ${new Date(cursor.startedAt)} AND id < ${cursor.id})
        `
      : Prisma.sql``
    const rows = await this.prisma.$queryRaw<SeoRunSummaryProjectionRow[]>(
      Prisma.sql`
        SELECT
          id,
          UPPER(mode::text) AS mode,
          UPPER(status::text) AS status,
          started_at AS "startedAt",
          completed_at AS "completedAt",
          eligible_count AS "eligibleCount",
          selected_count AS "selectedCount",
          would_propose_count AS "wouldProposeCount",
          proposed_count AS "proposedCount",
          materialization_count AS "materializationCount",
          ticket_count AS "ticketCount",
          experiment_count AS "experimentCount",
          suppressed_operations AS "suppressedOperations",
          provider_coverage AS "providerCoverage",
          execution_fence_generation AS "executionFenceGeneration",
          jsonb_typeof(report) AS "reportJsonType",
          CASE
            WHEN jsonb_typeof(report -> 'schemaVersion') = 'number'
              THEN report ->> 'schemaVersion'
            ELSE NULL
          END AS "reportSchemaVersion",
          CASE
            WHEN jsonb_typeof(report -> 'detailState') = 'string'
              THEN report ->> 'detailState'
            ELSE NULL
          END AS "reportDetailState",
          CASE
            WHEN jsonb_typeof(report) <> 'object' THEN false
            ELSE
              report ?& ARRAY[
                'schemaVersion', 'detailState', 'selectionPolicyId',
                'generatedAt', 'eligibleCount', 'observedCount',
                'selectedCount', 'wouldProposeCount',
                'persistedProposalCount', 'providerCoverage',
                'skippedTargetIds', 'suppressedOperations', 'gscRequests',
                'queryFunnel', 'queryDecisions',
                'omittedQueryDecisionCount', 'proposalRefs'
              ]
              AND NOT EXISTS (
                SELECT 1
                FROM jsonb_object_keys(report) AS report_keys(report_key)
                WHERE report_key NOT IN (
                  'schemaVersion', 'detailState', 'selectionPolicyId',
                  'generatedAt', 'eligibleCount', 'observedCount',
                  'selectedCount', 'wouldProposeCount',
                  'persistedProposalCount', 'providerCoverage',
                  'skippedTargetIds', 'omittedSkippedTargetCount',
                  'suppressedOperations', 'gscRequests',
                  'omittedGscRequestCount', 'queryFunnel', 'queryDecisions',
                  'omittedQueryDecisionCount', 'proposalRefs'
                )
              )
              AND jsonb_typeof(report -> 'schemaVersion') = 'number'
              AND jsonb_typeof(report -> 'detailState') = 'string'
              AND jsonb_typeof(report -> 'selectionPolicyId') = 'string'
              AND jsonb_typeof(report -> 'generatedAt') = 'string'
              AND jsonb_typeof(report -> 'eligibleCount') = 'number'
              AND jsonb_typeof(report -> 'observedCount') = 'number'
              AND jsonb_typeof(report -> 'selectedCount') = 'number'
              AND jsonb_typeof(report -> 'wouldProposeCount') = 'number'
              AND jsonb_typeof(report -> 'persistedProposalCount') = 'number'
              AND jsonb_typeof(report -> 'providerCoverage') = 'object'
              AND jsonb_typeof(report -> 'skippedTargetIds') = 'array'
              AND (
                NOT (report ? 'omittedSkippedTargetCount')
                OR jsonb_typeof(report -> 'omittedSkippedTargetCount') = 'number'
              )
              AND jsonb_typeof(report -> 'suppressedOperations') = 'array'
              AND jsonb_typeof(report -> 'gscRequests') = 'array'
              AND (
                NOT (report ? 'omittedGscRequestCount')
                OR jsonb_typeof(report -> 'omittedGscRequestCount') = 'number'
              )
              AND jsonb_typeof(report -> 'queryFunnel') = 'object'
              AND jsonb_typeof(report -> 'queryDecisions') = 'array'
              AND jsonb_typeof(report -> 'omittedQueryDecisionCount') = 'number'
              AND jsonb_typeof(report -> 'proposalRefs') = 'array'
          END AS "reportV1ShapeCompatible",
          CASE
            WHEN jsonb_typeof(report) <> 'object' THEN false
            ELSE
              NOT (report ? 'schemaVersion')
              AND NOT EXISTS (
                SELECT 1
                FROM jsonb_object_keys(report) AS report_keys(report_key)
                WHERE report_key NOT IN (
                  'eligibleCount', 'observedCount', 'selectedCount',
                  'wouldProposeCount', 'persistedProposalCount',
                  'providerCoverage', 'skippedTargetIds',
                  'suppressedOperations'
                )
              )
              AND (
                NOT (report ? 'eligibleCount')
                OR jsonb_typeof(report -> 'eligibleCount') = 'number'
              )
              AND (
                NOT (report ? 'observedCount')
                OR jsonb_typeof(report -> 'observedCount') = 'number'
              )
              AND (
                NOT (report ? 'selectedCount')
                OR jsonb_typeof(report -> 'selectedCount') = 'number'
              )
              AND (
                NOT (report ? 'wouldProposeCount')
                OR jsonb_typeof(report -> 'wouldProposeCount') = 'number'
              )
              AND (
                NOT (report ? 'persistedProposalCount')
                OR jsonb_typeof(report -> 'persistedProposalCount') = 'number'
              )
              AND (
                NOT (report ? 'providerCoverage')
                OR jsonb_typeof(report -> 'providerCoverage') = 'object'
              )
              AND (
                NOT (report ? 'skippedTargetIds')
                OR jsonb_typeof(report -> 'skippedTargetIds') = 'array'
              )
              AND (
                NOT (report ? 'suppressedOperations')
                OR jsonb_typeof(report -> 'suppressedOperations') = 'array'
              )
          END AS "reportLegacyCompatible"
        FROM seo_run
        ${cursorFilter}
        ORDER BY started_at DESC, id DESC
        LIMIT ${take + 1}
      `,
    )
    const hasNextPage = rows.length > take
    const pageRows = rows.slice(0, take)
    const next = hasNextPage ? pageRows.at(-1) : null
    const now = new Date()
    return {
      generatedAt: now.toISOString(),
      items: pageRows.map((row) =>
        seoRunSummaryRecord(row, projectedSeoRunReportAvailability(row, now)),
      ),
      hasNextPage,
      nextCursor: next
        ? encodeSeoRunCursor({
            startedAt: next.startedAt.toISOString(),
            id: next.id,
          })
        : null,
    }
  }

  async getRun({ user, id }: { user: Principal | null; id: string }) {
    assertManagerSeoAccess(user)
    const row = await this.prisma.seoRun.findUnique({ where: { id } })
    if (!row) return null
    const now = new Date()
    const summary = seoRunSummaryRecord(
      row,
      seoRunReportAvailability(row.report, row.completedAt, now),
    )
    const parsed = SeoRunReportV1Stored.safeParse(row.report)
    const compacted = SeoRunCompactReport.safeParse(row.report)
    if (parsed.success && summary.reportAvailability === "detail_expired") {
      await compactExpiredSeoRunReportById(this.prisma, row.id, now).catch(
        () => false,
      )
    }
    const report = parsed.success
      ? summary.reportAvailability === "available"
        ? parsed.data
        : {
            schemaVersion: 1,
            detailState: summary.reportAvailability,
            selectionPolicyId: parsed.data.selectionPolicyId,
            eligibleCount: parsed.data.eligibleCount,
            observedCount: parsed.data.observedCount,
            selectedCount: parsed.data.selectedCount,
            wouldProposeCount: parsed.data.wouldProposeCount,
            persistedProposalCount: parsed.data.persistedProposalCount,
            providerCoverage: parsed.data.providerCoverage,
            suppressedOperations: parsed.data.suppressedOperations,
            proposalRefs: parsed.data.proposalRefs,
          }
      : compacted.success
        ? compacted.data
        : null
    const reportRefs = parsed.success
      ? parsed.data.proposalRefs
      : compacted.success
        ? compacted.data.proposalRefs
        : []
    const refs = reportRefs.filter(
      (reference) =>
        reference.version != null && reference.originatingRunId != null,
    )
    const versions =
      refs.length === 0
        ? []
        : await this.prisma.seoProposalVersion.findMany({
            where: {
              OR: refs.map((reference) => ({
                proposalId: reference.proposalId,
                version: reference.version!,
                payloadDigest: reference.payloadDigest,
              })),
            },
            select: {
              proposalId: true,
              version: true,
              payloadDigest: true,
              runId: true,
              proposal: { select: { status: true } },
              decision: {
                select: {
                  action: true,
                  actorId: true,
                  reason: true,
                  decidedAt: true,
                },
              },
              materialization: { select: { status: true } },
              experiment: {
                select: {
                  id: true,
                  status: true,
                  evaluations: {
                    orderBy: { observedAt: "desc" },
                    take: 1,
                    select: {
                      kind: true,
                      outcome: true,
                      observedAt: true,
                    },
                  },
                },
              },
            },
          })
    return {
      ...summary,
      report,
      proposalOutcomes: versions.map((version) => ({
        proposalId: version.proposalId,
        version: version.version,
        payloadDigest: version.payloadDigest,
        originatingRunId: version.runId,
        proposalStatus: version.proposal.status,
        humanDecision: version.decision
          ? {
              action: version.decision.action,
              actorId: redactSeoText(version.decision.actorId).slice(0, 191),
              reason: version.decision.reason
                ? redactSeoText(version.decision.reason)
                : null,
              decidedAt: version.decision.decidedAt.toISOString(),
            }
          : null,
        materializationStatus: version.materialization?.status ?? null,
        experiment: version.experiment
          ? {
              id: version.experiment.id,
              status: version.experiment.status,
              latestEvaluation: version.experiment.evaluations[0]
                ? {
                    kind: version.experiment.evaluations[0].kind,
                    outcome: version.experiment.evaluations[0].outcome,
                    observedAt:
                      version.experiment.evaluations[0].observedAt.toISOString(),
                  }
                : null,
            }
          : null,
      })),
    }
  }

  async getProposal({ user, id }: { user: Principal | null; id: string }) {
    assertManagerSeoAccess(user)
    const row = await this.prisma.seoProposal.findUnique({
      where: { id },
      include: PROPOSAL_INCLUDE,
    })
    if (!row) return null
    const { evidenceByKey, overlapCountByProposalId } =
      await this.loadProposalContext([row])
    return proposalRecord(
      row,
      evidenceByKey,
      overlapCountByProposalId.get(row.id) ?? 0,
    )
  }

  async decideProposal({
    user,
    assertion,
    expectedAction,
    overlapAcknowledged = false,
    reason,
  }: {
    user: Principal | null
    assertion: VerifiedSeoApprovalAssertion
    expectedAction: "approve" | "reject"
    overlapAcknowledged?: boolean
    reason?: string | null
  }): Promise<ManagerSeoDecisionRecord> {
    assertManagerSeoAccess(user)
    if (assertion.action !== expectedAction)
      throw new SeoLedgerConflictError("assertion_mismatch")
    return this.prisma.$transaction(
      async (tx) => {
        const version = await tx.seoProposalVersion.findUnique({
          where: {
            proposalId_version: {
              proposalId: assertion.proposalId,
              version: assertion.version,
            },
          },
          include: {
            proposal: true,
            decision: true,
            materialization: true,
            ticketOutbox: true,
          },
        })
        if (!version || version.payloadDigest !== assertion.payloadDigest) {
          throw new SeoLedgerConflictError("assertion_mismatch")
        }
        await this.consumeApprovalNonce(tx, assertion, version.id)
        if (version.decision) return this.decisionRecord(version)
        if (
          version.proposal.currentVersion !== version.version ||
          version.proposal.status !== "PROPOSED"
        ) {
          return this.statusDecision(
            version,
            "ALREADY_DECIDED",
            "Proposal already changed.",
          )
        }
        if (version.proposal.expiresAt <= new Date()) {
          await tx.seoProposal.update({
            where: { id: version.proposalId },
            data: { status: "EXPIRED" },
          })
          return this.statusDecision(
            version,
            "EXPIRED",
            "Proposal expired and must be regenerated.",
          )
        }
        const [overlappingProposals, activeOverlappingExperiments] =
          await Promise.all([
            tx.seoProposal.findMany({
              where: {
                id: { not: version.proposalId },
                semanticConflictKey: version.proposal.semanticConflictKey,
                status: { in: ["PROPOSED", "APPROVED", "MATERIALIZED"] },
              },
              select: { id: true },
            }),
            tx.seoExperiment.findMany({
              where: {
                proposalVersionId: { not: version.id },
                status: { in: ["AWAITING_ACTIVATION", "MEASURING"] },
                proposalVersion: {
                  proposal: {
                    semanticConflictKey: version.proposal.semanticConflictKey,
                  },
                },
              },
              select: {
                id: true,
                confounders: true,
                proposalVersion: { select: { proposalId: true } },
              },
            }),
          ])
        const overlapIdentities = new Set(
          overlappingProposals.map((proposal) => `proposal:${proposal.id}`),
        )
        for (const experiment of activeOverlappingExperiments) {
          overlapIdentities.add(
            experiment.proposalVersion.proposalId === version.proposalId
              ? `experiment:${experiment.id}`
              : `proposal:${experiment.proposalVersion.proposalId}`,
          )
        }
        const overlapCount = overlapIdentities.size
        if (
          expectedAction === "approve" &&
          overlapCount > 0 &&
          !overlapAcknowledged
        ) {
          return this.statusDecision(
            version,
            "CONFLICT",
            "Overlapping work requires acknowledgement.",
          )
        }
        if (expectedAction === "reject") {
          const decision = await tx.seoDecision.create({
            data: {
              proposalVersionId: version.id,
              action: "REJECT",
              actorId: assertion.actorId,
              reason: reason?.trim().slice(0, 2_000) || null,
            },
          })
          await tx.seoProposal.update({
            where: { id: version.proposalId },
            data: { status: "REJECTED" },
          })
          return {
            status: "REJECTED",
            proposalId: version.proposalId,
            version: version.version,
            decisionId: decision.id,
            draftRevisionId: null,
            editorPath: null,
            ticketOutboxId: null,
            message: "Proposal rejected.",
          }
        }
        if (version.proposal.targetType === "Engineering") {
          const decision = await tx.seoDecision.create({
            data: {
              proposalVersionId: version.id,
              action: "APPROVE",
              actorId: assertion.actorId,
              overlapAcknowledged,
              overlapCount,
              confounders: inputJson(
                overlapCount > 0 ? ["overlapping_change"] : [],
              ),
            },
          })
          const outbox = await tx.seoTicketOutbox.create({
            data: {
              proposalVersionId: version.id,
              payloadDigest: version.payloadDigest,
              payload: inputJson(version.engineeringBrief ?? version.payload),
              marker: `forge-seo:${version.proposalId}:v${version.version}:${version.payloadDigest.slice(0, 12)}`,
              nextAttemptAt: new Date(),
            },
          })
          await tx.seoProposalMaterialization.create({
            data: { proposalVersionId: version.id, status: "TICKET_PENDING" },
          })
          const expectedActivationHash = engineeringExpectedActivationHash(
            version.engineeringBrief,
          )
          if (expectedActivationHash) {
            await tx.seoExperiment.create({
              data: {
                proposalVersionId: version.id,
                preChangeSnapshot: inputJson(version.preChangeSnapshot),
                treatmentSnapshot: inputJson(version.treatmentSnapshot),
                preChangeHash: seoContentHash(version.preChangeSnapshot),
                treatmentHash: seoContentHash(version.treatmentSnapshot),
                expectedActivationHash,
                confounders: inputJson([]),
              },
            })
          }
          await tx.seoProposal.update({
            where: { id: version.proposalId },
            data: { status: "MATERIALIZED" },
          })
          return {
            status: "APPROVED",
            proposalId: version.proposalId,
            version: version.version,
            decisionId: decision.id,
            draftRevisionId: null,
            editorPath: null,
            ticketOutboxId: outbox.id,
            message:
              "Engineering brief approved and queued for ticket delivery.",
          }
        }
        try {
          const materialized = await this.targets.materializeEditorialDraft({
            tx,
            version,
            actorId: assertion.actorId,
          })
          const decision = await tx.seoDecision.create({
            data: {
              proposalVersionId: version.id,
              action: "APPROVE",
              actorId: assertion.actorId,
              overlapAcknowledged,
              overlapCount,
              confounders: inputJson(
                overlapCount > 0 ? ["overlapping_change"] : [],
              ),
            },
          })
          await tx.seoProposalMaterialization.create({
            data: {
              proposalVersionId: version.id,
              status: "DRAFT_CREATED",
              contentRevisionId: materialized.revisionId,
              editorPath: materialized.editorPath,
            },
          })
          await tx.seoExperiment.create({
            data: {
              proposalVersionId: version.id,
              preChangeSnapshot: materialized.preChangeSnapshot,
              treatmentSnapshot: materialized.treatmentSnapshot,
              preChangeHash: materialized.preChangeHash,
              treatmentHash: materialized.treatmentHash,
              expectedActivationHash: materialized.expectedActivationHash,
              confounders: inputJson([]),
            },
          })
          await tx.seoProposal.update({
            where: { id: version.proposalId },
            data: { status: "MATERIALIZED" },
          })
          return {
            status: "APPROVED",
            proposalId: version.proposalId,
            version: version.version,
            decisionId: decision.id,
            draftRevisionId: materialized.revisionId,
            editorPath: materialized.editorPath,
            ticketOutboxId: null,
            message: "Editorial draft created. Canonical content is unchanged.",
          }
        } catch (error) {
          if (error instanceof SeoTargetStaleError) {
            await tx.seoProposal.update({
              where: { id: version.proposalId },
              data: { status: "STALE" },
            })
            return this.statusDecision(
              version,
              "STALE",
              "The canonical target changed; regenerate the proposal.",
            )
          }
          if (error instanceof SeoTargetConflictError) {
            return this.statusDecision(
              version,
              "CONFLICT",
              "An existing human or AI draft must be resolved first.",
            )
          }
          throw error
        }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    )
  }

  async reviewLesson({
    user,
    assertion,
    lessonId,
    status,
  }: {
    user: Principal | null
    assertion: VerifiedSeoApprovalAssertion
    lessonId: string
    status: SeoLessonStatus
  }) {
    assertManagerSeoAccess(user)
    if (assertion.action !== "review_lesson" || status === "PENDING_REVIEW") {
      throw new SeoLedgerConflictError("assertion_mismatch")
    }
    return this.prisma.$transaction(async (tx) => {
      const lesson = await tx.seoLesson.findUnique({
        where: { id: lessonId },
        include: { experiment: { include: { proposalVersion: true } } },
      })
      if (
        !lesson ||
        lesson.experiment.proposalVersion.proposalId !== assertion.proposalId ||
        lesson.experiment.proposalVersion.version !== assertion.version ||
        lesson.experiment.proposalVersion.payloadDigest !==
          assertion.payloadDigest
      ) {
        throw new SeoLedgerConflictError("assertion_mismatch")
      }
      if (
        status === "ACTIVE" &&
        (lesson.experiment.status === "HARMFUL" ||
          lesson.experiment.status === "INCONCLUSIVE" ||
          lesson.experiment.status === "ROLLBACK_PROPOSED" ||
          (lesson.experiment.confounders !== null &&
            Array.isArray(lesson.experiment.confounders) &&
            lesson.experiment.confounders.length > 0))
      ) {
        throw new SeoLedgerConflictError("lesson_not_eligible")
      }
      await this.consumeApprovalNonce(
        tx,
        assertion,
        lesson.experiment.proposalVersion.id,
      )
      const updated = await tx.seoLesson.update({
        where: { id: lesson.id },
        data: {
          status,
          reviewedById: assertion.actorId,
          reviewedAt: new Date(),
        },
        include: {
          experiment: {
            include: { proposalVersion: { include: { proposal: true } } },
          },
        },
      })
      return {
        id: updated.id,
        experimentId: updated.experimentId,
        proposalId: updated.experiment.proposalVersion.proposal.id,
        proposalVersion: updated.experiment.proposalVersion.version,
        status: updated.status,
        content: updated.content,
        evidenceDigest: updated.evidenceDigest,
        metrics: updated.metrics,
        confounders: updated.confounders,
        reviewedById: updated.reviewedById,
        reviewedAt: iso(updated.reviewedAt),
        createdAt: updated.createdAt.toISOString(),
      }
    })
  }

  async reconcileTicket({
    user,
    assertion,
    outboxId,
    action,
    remoteId,
    remoteUrl,
  }: {
    user: Principal | null
    assertion: VerifiedSeoApprovalAssertion
    outboxId: string
    action: "BIND_EXISTING" | "MARK_FAILED"
    remoteId?: string | null
    remoteUrl?: string | null
  }) {
    assertManagerSeoAccess(user)
    if (assertion.action !== "reconcile_ticket")
      throw new SeoLedgerConflictError("assertion_mismatch")
    return this.prisma.$transaction(async (tx) => {
      const outbox = await tx.seoTicketOutbox.findUnique({
        where: { id: outboxId },
        include: {
          proposalVersion: { include: { proposal: true } },
          attempts: true,
        },
      })
      if (
        !outbox ||
        outbox.status !== "MANUAL_RECONCILE" ||
        outbox.proposalVersion.proposalId !== assertion.proposalId ||
        outbox.proposalVersion.version !== assertion.version ||
        outbox.payloadDigest !== assertion.payloadDigest
      ) {
        throw new SeoLedgerConflictError("assertion_mismatch")
      }
      await this.consumeApprovalNonce(tx, assertion, outbox.proposalVersionId)
      if (action === "BIND_EXISTING" && (!remoteId || !remoteUrl)) {
        throw new SeoLedgerConflictError("verified_ticket_required")
      }
      const updated = await tx.seoTicketOutbox.update({
        where: { id: outbox.id },
        data:
          action === "BIND_EXISTING"
            ? { status: "CREATED", remoteId, remoteUrl, lastErrorCode: null }
            : { status: "FAILED", lastErrorCode: "operator_marked_failed" },
        include: {
          proposalVersion: { include: { proposal: true } },
          attempts: true,
        },
      })
      await tx.seoProposalMaterialization.update({
        where: { proposalVersionId: outbox.proposalVersionId },
        data: {
          status: action === "BIND_EXISTING" ? "TICKET_CREATED" : "STALE",
        },
      })
      return this.ticketRecord(updated)
    })
  }

  async claimDueExperiments({
    assertion,
    input,
  }: {
    assertion: VerifiedSeoWorkloadAssertion
    input: Extract<z.infer<typeof SeoEvaluateInput>, { action: "claim_due" }>
  }) {
    return this.prisma.$transaction(async (tx) => {
      await this.consumeWorkloadAssertion(tx, assertion)
      await this.assertLiveAutomationMode(tx)
      const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT id FROM seo_experiment
        WHERE (
          status = 'awaiting_activation'
          OR (
            status = 'measuring'
            AND (
              (interim_due_at IS NOT NULL AND interim_due_at <= NOW())
              OR (final_due_at IS NOT NULL AND final_due_at <= NOW())
            )
          )
        )
          AND (
            evaluation_claim_expires_at IS NULL
            OR evaluation_claim_expires_at <= NOW()
          )
        ORDER BY updated_at ASC
        LIMIT ${input.limit}
        FOR UPDATE SKIP LOCKED
      `)
      const claimed = []
      for (const row of rows) {
        const claimToken = randomUUID()
        const experiment = await tx.seoExperiment.update({
          where: { id: row.id },
          data: {
            evaluationFenceGeneration: { increment: 1 },
            evaluationClaimTokenHash: createHash("sha256")
              .update(claimToken)
              .digest("hex"),
            evaluationClaimExpiresAt: new Date(Date.now() + 15 * 60_000),
          },
          include: { proposalVersion: { include: { proposal: true } } },
        })
        const currentHashes =
          experiment.proposalVersion.proposal.lane === "ENGINEERING"
            ? null
            : await this.targets.currentHashes({
                tx,
                targetType: experiment.proposalVersion.proposal.targetType,
                targetId: experiment.proposalVersion.proposal.targetId,
                locale: experiment.proposalVersion.proposal.locale,
              })
        claimed.push({
          ...experiment,
          claimGeneration: experiment.evaluationFenceGeneration,
          claimToken,
          currentCanonicalActivationHash: currentHashes?.activationHash ?? null,
        })
      }
      return claimed
    })
  }

  async recordEvaluation({
    assertion,
    input,
  }: {
    assertion: VerifiedSeoWorkloadAssertion
    input: Extract<
      z.infer<typeof SeoEvaluateInput>,
      { action: "record_result" }
    >
  }) {
    return this.prisma.$transaction(async (tx) => {
      await this.consumeWorkloadAssertion(tx, assertion)
      await this.assertLiveAutomationMode(tx)
      const experiment = await tx.seoExperiment.findUnique({
        where: { id: input.experimentId },
        include: { proposalVersion: { include: { proposal: true } } },
      })
      if (!experiment) throw new SeoLedgerConflictError("experiment_not_found")
      const claimTokenHash = createHash("sha256")
        .update(input.claimToken)
        .digest("hex")
      if (
        experiment.evaluationFenceGeneration !== input.claimGeneration ||
        experiment.evaluationClaimTokenHash !== claimTokenHash ||
        !experiment.evaluationClaimExpiresAt
      ) {
        throw new SeoLedgerConflictError("evaluation_fence_lost")
      }
      const now = new Date()
      const expectedKind =
        experiment.status === "AWAITING_ACTIVATION"
          ? "activation"
          : experiment.status === "MEASURING" &&
              experiment.finalDueAt &&
              experiment.finalDueAt <= now
            ? "final"
            : experiment.status === "MEASURING" &&
                experiment.interimDueAt &&
                experiment.interimDueAt <= now
              ? "interim"
              : null
      if (input.kind !== expectedKind) {
        throw new SeoLedgerConflictError("evaluation_stage_mismatch")
      }
      if (
        input.kind !== "activation" &&
        (experiment.status !== "MEASURING" ||
          !experiment.activatedAt ||
          experiment.observedActivationHash !==
            experiment.expectedActivationHash)
      ) {
        throw new SeoLedgerConflictError("experiment_not_activated")
      }
      let observedActivationHash = input.observedActivationHash ?? null
      let outcome = input.outcome
      if (
        input.kind === "activation" &&
        experiment.proposalVersion.proposal.lane !== "ENGINEERING"
      ) {
        const currentHashes = await this.targets.currentHashes({
          tx,
          targetType: experiment.proposalVersion.proposal.targetType,
          targetId: experiment.proposalVersion.proposal.targetId,
          locale: experiment.proposalVersion.proposal.locale,
        })
        const currentActivationHash = currentHashes?.activationHash ?? null
        const activationMatches =
          currentActivationHash === experiment.expectedActivationHash
        observedActivationHash = activationMatches
          ? currentActivationHash
          : null
        outcome = activationMatches ? "activated" : "awaiting_activation"
      }
      if (
        input.kind === "activation" &&
        observedActivationHash &&
        observedActivationHash !== experiment.expectedActivationHash
      ) {
        throw new SeoLedgerConflictError("activation_hash_mismatch")
      }
      const effectiveConfounders = new Set([
        ...strings(experiment.confounders),
        ...strings(input.confounders),
      ])
      let finalCanonicalHashes: {
        contentHash: string
        activationHash: string
      } | null = null
      if (
        input.kind === "final" &&
        ["beneficial", "neutral", "harmful"].includes(outcome.toLowerCase()) &&
        experiment.proposalVersion.proposal.lane !== "ENGINEERING"
      ) {
        finalCanonicalHashes = await this.targets.currentHashes({
          tx,
          targetType: experiment.proposalVersion.proposal.targetType,
          targetId: experiment.proposalVersion.proposal.targetId,
          locale: experiment.proposalVersion.proposal.locale,
        })
        if (
          finalCanonicalHashes?.activationHash !==
          experiment.expectedActivationHash
        ) {
          effectiveConfounders.add("canonical_content_changed")
          outcome = "inconclusive"
        }
      }
      const overlappingExperiments =
        input.kind === "activation" && observedActivationHash
          ? await tx.seoExperiment.findMany({
              where: {
                id: { not: experiment.id },
                status: "MEASURING",
                proposalVersion: {
                  proposal: {
                    semanticConflictKey:
                      experiment.proposalVersion.proposal.semanticConflictKey,
                  },
                },
              },
              select: { id: true, confounders: true },
            })
          : []
      if (overlappingExperiments.length > 0) {
        effectiveConfounders.add("overlapping_change")
      }
      const consumedFence = await tx.seoExperiment.updateMany({
        where: {
          id: experiment.id,
          status: experiment.status,
          evaluationFenceGeneration: input.claimGeneration,
          evaluationClaimTokenHash: claimTokenHash,
        },
        data: {
          evaluationClaimTokenHash: null,
          evaluationClaimExpiresAt: null,
        },
      })
      if (consumedFence.count !== 1) {
        throw new SeoLedgerConflictError("evaluation_fence_lost")
      }
      for (const overlapping of overlappingExperiments) {
        const confounders = new Set(strings(overlapping.confounders))
        confounders.add("overlapping_change")
        await tx.seoExperiment.update({
          where: { id: overlapping.id },
          data: { confounders: inputJson([...confounders]) },
        })
      }
      const event = await tx.seoEvaluationEvent.create({
        data: {
          experimentId: experiment.id,
          kind: input.kind.toUpperCase() as "ACTIVATION" | "INTERIM" | "FINAL",
          outcome,
          metrics: inputJson(input.metrics),
          evidenceDigest: input.evidenceDigest,
          confounders: inputJson([...effectiveConfounders]),
          observedAt: new Date(input.observedAt),
        },
      })
      const update: Prisma.SeoExperimentUpdateInput = {}
      if (input.kind === "activation" && observedActivationHash) {
        const activatedAt = input.activatedAt
          ? new Date(input.activatedAt)
          : new Date(input.observedAt)
        update.status = "MEASURING"
        update.observedActivationHash = observedActivationHash
        update.activatedAt = activatedAt
        update.measurementStartsAt = activatedAt
        update.interimDueAt = new Date(activatedAt.getTime() + 7 * 86_400_000)
        update.finalDueAt = new Date(activatedAt.getTime() + 28 * 86_400_000)
      } else if (input.kind === "interim") {
        update.interimDueAt = null
      } else if (input.kind === "final") {
        const terminal = outcome.toUpperCase()
        if (
          ["BENEFICIAL", "NEUTRAL", "HARMFUL", "INCONCLUSIVE"].includes(
            terminal,
          )
        ) {
          update.status = terminal as
            | "BENEFICIAL"
            | "NEUTRAL"
            | "HARMFUL"
            | "INCONCLUSIVE"
          update.finalDueAt = null
        } else {
          update.finalDueAt = new Date(
            new Date(input.observedAt).getTime() + 7 * 86_400_000,
          )
        }
      }
      if (effectiveConfounders.size > 0) {
        update.confounders = inputJson([...effectiveConfounders])
      }
      await tx.seoExperiment.update({
        where: { id: experiment.id },
        data: update,
      })
      if (input.kind === "final") {
        await this.persistFinalEvaluationArtifacts({
          tx,
          experiment,
          event,
          input: {
            ...input,
            outcome,
            confounders: [...effectiveConfounders],
          },
          currentHashes: finalCanonicalHashes,
        })
      }
      return {
        eventId: event.id,
        experimentId: experiment.id,
        outcome: event.outcome,
      }
    })
  }

  async claimTicket({
    assertion,
    input,
  }: {
    assertion: VerifiedSeoWorkloadAssertion
    input: Extract<z.infer<typeof SeoTicketsInput>, { action: "claim" }>
  }) {
    return this.prisma.$transaction(async (tx) => {
      await this.consumeWorkloadAssertion(tx, assertion)
      await this.assertLiveAutomationMode(tx)
      const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT id FROM seo_ticket_outbox
        WHERE (
          (
            status IN ('pending', 'retryable')
            AND (next_attempt_at IS NULL OR next_attempt_at <= NOW())
            AND (lease_expires_at IS NULL OR lease_expires_at <= NOW())
          )
          OR (
            status = 'claimed'
            AND lease_expires_at <= NOW()
          )
        )
        ORDER BY created_at ASC
        LIMIT 1 FOR UPDATE SKIP LOCKED
      `)
      const id = rows[0]?.id
      if (!id) return null
      const leaseToken = randomUUID()
      const leaseTokenHash = createHash("sha256")
        .update(leaseToken)
        .digest("hex")
      const leaseExpiresAt = new Date(Date.now() + input.leaseSeconds * 1_000)
      const outbox = await tx.seoTicketOutbox.update({
        where: { id },
        data: {
          status: "CLAIMED",
          fenceGeneration: { increment: 1 },
          leaseTokenHash,
          leaseExpiresAt,
          attemptCount: { increment: 1 },
        },
      })
      return {
        outboxId: outbox.id,
        generation: outbox.fenceGeneration,
        leaseToken,
        leaseExpiresAt: leaseExpiresAt.toISOString(),
        payloadDigest: outbox.payloadDigest,
        payload: outbox.payload,
        marker: outbox.marker,
        remoteId: outbox.remoteId,
        remoteUrl: outbox.remoteUrl,
      }
    })
  }

  async finishTicket({
    assertion,
    input,
  }: {
    assertion: VerifiedSeoWorkloadAssertion
    input: Exclude<z.infer<typeof SeoTicketsInput>, { action: "claim" }>
  }) {
    return this.prisma.$transaction(async (tx) => {
      await this.consumeWorkloadAssertion(tx, assertion)
      const leaseHash = createHash("sha256")
        .update(input.leaseToken)
        .digest("hex")
      const outbox = await tx.seoTicketOutbox.findUnique({
        where: { id: input.outboxId },
      })
      if (
        !outbox ||
        outbox.status !== "CLAIMED" ||
        outbox.fenceGeneration !== input.generation ||
        outbox.leaseTokenHash !== leaseHash ||
        !outbox.leaseExpiresAt ||
        outbox.leaseExpiresAt <= new Date()
      ) {
        throw new SeoLedgerConflictError("ticket_fence_lost")
      }
      const expiresAt = new Date(Date.now() + 180 * 86_400_000)
      if (input.action === "complete") {
        const consumedFence = await tx.seoTicketOutbox.updateMany({
          where: {
            id: outbox.id,
            status: "CLAIMED",
            fenceGeneration: input.generation,
            leaseTokenHash: leaseHash,
            leaseExpiresAt: { gt: new Date() },
          },
          data: {
            status: "CREATED",
            remoteId: input.remoteId,
            remoteUrl: input.remoteUrl,
            leaseTokenHash: null,
            leaseExpiresAt: null,
            nextAttemptAt: null,
            lastErrorCode: null,
          },
        })
        if (consumedFence.count !== 1) {
          throw new SeoLedgerConflictError("ticket_fence_lost")
        }
        await tx.seoTicketOutboxAttempt.create({
          data: {
            outboxId: outbox.id,
            generation: input.generation,
            outcome: "created",
            expiresAt,
          },
        })
        await tx.seoProposalMaterialization.update({
          where: { proposalVersionId: outbox.proposalVersionId },
          data: { status: "TICKET_CREATED" },
        })
        return tx.seoTicketOutbox.findUniqueOrThrow({
          where: { id: outbox.id },
        })
      }
      if (input.action === "retry") {
        const consumedFence = await tx.seoTicketOutbox.updateMany({
          where: {
            id: outbox.id,
            status: "CLAIMED",
            fenceGeneration: input.generation,
            leaseTokenHash: leaseHash,
            leaseExpiresAt: { gt: new Date() },
          },
          data: {
            status: "RETRYABLE",
            nextAttemptAt: new Date(input.nextAttemptAt),
            lastErrorCode: input.errorCode,
            leaseTokenHash: null,
            leaseExpiresAt: null,
          },
        })
        if (consumedFence.count !== 1) {
          throw new SeoLedgerConflictError("ticket_fence_lost")
        }
        await tx.seoTicketOutboxAttempt.create({
          data: {
            outboxId: outbox.id,
            generation: input.generation,
            outcome: "retryable",
            detail: inputJson({ errorCode: input.errorCode }),
            expiresAt,
          },
        })
        return tx.seoTicketOutbox.findUniqueOrThrow({
          where: { id: outbox.id },
        })
      }
      const consumedFence = await tx.seoTicketOutbox.updateMany({
        where: {
          id: outbox.id,
          status: "CLAIMED",
          fenceGeneration: input.generation,
          leaseTokenHash: leaseHash,
          leaseExpiresAt: { gt: new Date() },
        },
        data: {
          status: "MANUAL_RECONCILE",
          nextAttemptAt: null,
          lastErrorCode: input.errorCode,
          leaseTokenHash: null,
          leaseExpiresAt: null,
        },
      })
      if (consumedFence.count !== 1) {
        throw new SeoLedgerConflictError("ticket_fence_lost")
      }
      await tx.seoTicketOutboxAttempt.create({
        data: {
          outboxId: outbox.id,
          generation: input.generation,
          outcome: "manual_reconcile",
          detail: inputJson({
            errorCode: input.errorCode,
            candidates: input.candidates,
          }),
          expiresAt,
        },
      })
      await tx.seoProposalMaterialization.update({
        where: { proposalVersionId: outbox.proposalVersionId },
        data: { status: "MANUAL_RECONCILE" },
      })
      return tx.seoTicketOutbox.findUniqueOrThrow({
        where: { id: outbox.id },
      })
    })
  }

  private async persistProposal(
    tx: SeoTransaction,
    runId: string,
    input: z.infer<typeof SeoProposalIngestInput>,
  ) {
    if (seoContentHash(redactSeoJson(input.payload)) !== input.payloadDigest) {
      throw new SeoLedgerConflictError("proposal_digest_mismatch")
    }
    const existingRetry = await tx.seoProposalVersion.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    })
    if (existingRetry) {
      if (existingRetry.payloadDigest !== input.payloadDigest) {
        throw new SeoLedgerConflictError("idempotency_digest_mismatch")
      }
      return {
        proposalId: existingRetry.proposalId,
        payloadDigest: existingRetry.payloadDigest,
        disposition:
          existingRetry.runId === runId
            ? ("persisted_new" as const)
            : ("reused_existing" as const),
        version: existingRetry.version,
        originatingRunId: existingRetry.runId,
      }
    }
    const proposal = await tx.seoProposal.upsert({
      where: { id: input.proposalId },
      create: {
        id: input.proposalId,
        semanticConflictKey: input.semanticConflictKey,
        lane: enumLane(input.lane),
        targetType: input.targetType,
        targetId: input.targetId,
        canonicalUrl: input.canonicalUrl,
        locale: input.locale,
        currentVersion: 0,
        expiresAt: new Date(input.expiresAt),
      },
      update: {},
    })
    if (
      proposal.semanticConflictKey !== input.semanticConflictKey ||
      proposal.lane !== enumLane(input.lane) ||
      proposal.targetType !== input.targetType ||
      proposal.targetId !== input.targetId ||
      proposal.canonicalUrl !== input.canonicalUrl ||
      proposal.locale !== input.locale
    ) {
      throw new SeoLedgerConflictError("proposal_identity_mismatch")
    }
    const existingPayload = await tx.seoProposalVersion.findUnique({
      where: {
        proposalId_payloadDigest: {
          proposalId: proposal.id,
          payloadDigest: input.payloadDigest,
        },
      },
    })
    if (existingPayload) {
      return {
        proposalId: existingPayload.proposalId,
        payloadDigest: existingPayload.payloadDigest,
        disposition:
          existingPayload.runId === runId
            ? ("persisted_new" as const)
            : ("reused_existing" as const),
        version: existingPayload.version,
        originatingRunId: existingPayload.runId,
      }
    }
    const allocatedVersion = proposal.currentVersion + 1
    const version = await tx.seoProposalVersion.create({
      data: {
        proposalId: proposal.id,
        runId,
        version: allocatedVersion,
        idempotencyKey: input.idempotencyKey,
        payloadDigest: input.payloadDigest,
        canonicalIdentityDigest: input.canonicalIdentityDigest,
        baseContentHash: input.baseContentHash,
        intent: redactSeoText(input.intent),
        expectedOutcome: redactSeoText(input.expectedOutcome),
        risk: redactSeoText(input.risk),
        verificationPlan: redactSeoText(input.verificationPlan),
        rollbackPlan: redactSeoText(input.rollbackPlan),
        editorialDiff:
          input.editorialDiff == null
            ? Prisma.JsonNull
            : inputJson(input.editorialDiff),
        engineeringBrief:
          input.engineeringBrief == null
            ? Prisma.JsonNull
            : inputJson(input.engineeringBrief),
        evidence: inputJson(input.evidence),
        caveats: input.caveats.map(redactSeoText),
        affectedFields: input.affectedFields,
        payload: inputJson(input.payload),
        preChangeSnapshot: inputJson(input.preChangeSnapshot),
        treatmentSnapshot: inputJson(input.treatmentSnapshot),
      },
    })
    await tx.seoProposal.update({
      where: { id: proposal.id },
      data: {
        currentVersion: allocatedVersion,
        status: "PROPOSED",
        expiresAt: new Date(input.expiresAt),
      },
    })
    return {
      proposalId: version.proposalId,
      payloadDigest: version.payloadDigest,
      disposition: "persisted_new" as const,
      version: version.version,
      originatingRunId: version.runId,
    }
  }

  private async persistFinalEvaluationArtifacts({
    tx,
    experiment,
    event,
    input,
    currentHashes,
  }: {
    tx: SeoTransaction
    experiment: ExperimentWithProposal
    event: { id: string; outcome: string; observedAt: Date }
    input: RecordEvaluationInput
    currentHashes: {
      contentHash: string
      activationHash: string
    } | null
  }) {
    const terminal = input.outcome.toUpperCase()
    const confounders = strings(input.confounders)
    if (
      !["BENEFICIAL", "NEUTRAL", "HARMFUL"].includes(terminal) ||
      confounders.length > 0
    ) {
      return
    }
    const source = experiment.proposalVersion
    const lessonContent = {
      BENEFICIAL:
        "This measured SEO treatment improved its primary Search Console outcome. Reuse only after reviewing the exact locale, intent, metrics, and guardrails.",
      NEUTRAL:
        "This measured SEO treatment was neutral. Preserve the result to avoid repeatedly proposing the same unproductive change.",
      HARMFUL:
        "This measured SEO treatment was harmful. Preserve the result as a warning and review the approval-required rollback proposal.",
    }[terminal]!
    await tx.seoLesson.upsert({
      where: { experimentId: experiment.id },
      create: {
        experimentId: experiment.id,
        content: lessonContent,
        evidenceDigest: input.evidenceDigest,
        metrics: inputJson(input.metrics),
        confounders: inputJson(confounders),
      },
      update: {},
    })
    if (terminal !== "HARMFUL") return

    const rollbackProposalId = `seo-rollback-${createHash("sha256")
      .update(experiment.id)
      .digest("hex")
      .slice(0, 24)}`
    const rollbackPayload = {
      kind: "seo_rollback",
      sourceExperimentId: experiment.id,
      sourceProposalId: source.proposal.id,
      sourceProposalVersion: source.version,
      sourceEvaluationEventId: event.id,
      restoreSnapshot: experiment.preChangeSnapshot,
    }
    const payloadDigest = seoContentHash(redactSeoJson(rollbackPayload))
    const sourceDiff = record(source.editorialDiff)
    const rollbackDiff = Object.fromEntries(
      Object.entries(sourceDiff).flatMap(([field, rawDiff]) => {
        const exact = record(rawDiff)
        return "before" in exact || "after" in exact
          ? [
              [
                field,
                { before: exact.after ?? null, after: exact.before ?? null },
              ],
            ]
          : []
      }),
    )
    const engineeringRollback = source.proposal.targetType === "Engineering"
    const engineeringBrief = engineeringRollback
      ? {
          title: `Rollback SEO change from ${source.proposal.id}`,
          description:
            "The final matched-window evaluation was harmful. Restore the retained pre-change behavior through the normal engineering review and deployment process.",
          acceptanceCriteria: [
            "Restore the behavior represented by the immutable pre-change snapshot.",
            "Verify production still matches the harmful treatment before applying the rollback.",
            "Preserve canonical and locale identity.",
          ],
          affectedScope: [source.proposal.canonicalUrl, source.proposal.locale],
          ticketOnly: true,
          deploymentProbe: null,
        }
      : null
    await tx.seoProposal.upsert({
      where: { id: rollbackProposalId },
      create: {
        id: rollbackProposalId,
        semanticConflictKey: source.proposal.semanticConflictKey,
        lane: "ROLLBACK",
        targetType: source.proposal.targetType,
        targetId: source.proposal.targetId,
        canonicalUrl: source.proposal.canonicalUrl,
        locale: source.proposal.locale,
        currentVersion: 1,
        expiresAt: new Date(event.observedAt.getTime() + 14 * 86_400_000),
      },
      update: {},
    })
    await tx.seoProposalVersion.upsert({
      where: { idempotencyKey: `rollback:${experiment.id}:v1` },
      create: {
        proposalId: rollbackProposalId,
        runId: source.runId,
        version: 1,
        idempotencyKey: `rollback:${experiment.id}:v1`,
        payloadDigest,
        canonicalIdentityDigest: source.canonicalIdentityDigest,
        baseContentHash: currentHashes?.contentHash ?? experiment.treatmentHash,
        intent:
          "Restore the immutable pre-change state after a harmful result.",
        expectedOutcome:
          "Return the canonical page to its measured pre-change state after human approval.",
        risk: "Later human edits make this rollback stale; approval must not overwrite newer canonical content.",
        verificationPlan:
          "Verify the current canonical hash still matches the harmful treatment, then use the normal draft or engineering flow.",
        rollbackPlan:
          "If the rollback itself is harmful, restore the retained treatment snapshot through a new reviewed proposal.",
        editorialDiff: engineeringRollback
          ? Prisma.JsonNull
          : inputJson(rollbackDiff),
        engineeringBrief: engineeringBrief
          ? inputJson(engineeringBrief)
          : Prisma.JsonNull,
        evidence: inputJson([
          {
            id: event.id,
            provider: "gsc",
            status: "available",
            summary:
              "The final matched-window Search Console verdict was harmful.",
            retrievedAt: event.observedAt.toISOString(),
            quality: "final",
            coverage:
              "See the immutable final evaluation metrics and guardrails.",
          },
        ]),
        caveats: [
          "Rollback remains approval-required and never publishes automatically.",
        ],
        affectedFields: engineeringRollback ? [] : Object.keys(rollbackDiff),
        payload: inputJson(rollbackPayload),
        preChangeSnapshot: inputJson(experiment.treatmentSnapshot),
        treatmentSnapshot: inputJson(experiment.preChangeSnapshot),
      },
      update: {},
    })
  }

  private async loadRunContext(tx: SeoTransaction, targetLimit: number) {
    const perKindLimit = Math.max(1, Math.floor(targetLimit / 2))
    const [
      watchEligible,
      experienceEligible,
      watchRows,
      experienceRows,
      lessons,
    ] = await Promise.all([
      tx.videoLocale.count({
        where: {
          deletedAt: null,
          status: "PUBLISHED",
          languageSlug: { not: null },
          video: { deletedAt: null },
        },
      }),
      tx.experienceLocale.count({
        where: {
          status: "PUBLISHED",
          experience: { archivedAt: null, isTemplate: false },
        },
      }),
      tx.videoLocale.findMany({
        where: {
          deletedAt: null,
          status: "PUBLISHED",
          languageSlug: { not: null },
          video: { deletedAt: null },
        },
        orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
        take: perKindLimit,
        include: { video: { select: { slug: true } } },
      }),
      tx.experienceLocale.findMany({
        where: {
          status: "PUBLISHED",
          experience: { archivedAt: null, isTemplate: false },
        },
        orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
        take: perKindLimit,
        include: { experience: { select: { archivedAt: true } } },
      }),
      tx.seoLesson.findMany({
        where: { status: "ACTIVE" },
        orderBy: { updatedAt: "desc" },
        take: 100,
        select: {
          id: true,
          experimentId: true,
          content: true,
          evidenceDigest: true,
          metrics: true,
          confounders: true,
        },
      }),
    ])

    const watchTargets = watchRows.flatMap((row) => {
      if (!row.languageSlug) return []
      const data = seoVideoLocaleSnapshot(row)
      const canonicalUrl = `${env.WEB_CANONICAL_ORIGIN}/watch${buildCanonicalWatchVideoPath(row.video.slug, row.languageSlug)}`
      const identity = {
        targetType: "VideoLocale" as const,
        targetId: row.id,
        canonicalUrl,
        locale: row.locale ?? row.languageSlug,
      }
      return [
        {
          ...identity,
          baseContentHash: seoContentHash(data),
          canonicalIdentityDigest: seoContentHash(identity),
          preChangeSnapshot: { v: 1, data },
          supportedFields: [
            "title",
            "description",
            "snippet",
            "imageAlt",
            "searchTitle",
            "searchDescription",
            "socialImageAssetId",
          ],
        },
      ]
    })
    const experienceTargets = experienceRows.map((row) => {
      const data = seoExperienceLocaleSnapshot(row)
      const canonicalUrl = `${env.WEB_CANONICAL_ORIGIN}/watch/${row.slug}.html`
      const identity = {
        targetType: "ExperienceLocale" as const,
        targetId: row.id,
        canonicalUrl,
        locale: row.locale,
      }
      return {
        ...identity,
        baseContentHash: seoContentHash(data),
        canonicalIdentityDigest: seoContentHash(identity),
        preChangeSnapshot: { v: 1, data },
        supportedFields: [
          "slug",
          "isHomepage",
          "pathSegment",
          "title",
          "metaDescription",
          "ogTitle",
          "ogDescription",
          "ogImageUrl",
          "blocks",
        ],
      }
    })
    return {
      targets: [...watchTargets, ...experienceTargets],
      lessons,
      coverage: {
        targetLimit,
        watch: {
          eligible: watchEligible,
          returned: watchTargets.length,
          truncated: watchTargets.length < watchEligible,
        },
        experience: {
          eligible: experienceEligible,
          returned: experienceTargets.length,
          truncated: experienceTargets.length < experienceEligible,
        },
        lessons: {
          returned: lessons.length,
          truncated: lessons.length === 100,
        },
      },
    }
  }

  private async loadProposalContext(proposals: ProposalWithDetails[]) {
    const currentVersions = proposals.flatMap((proposal) => {
      const version = proposal.versions[0]
      return version ? [{ proposal, version }] : []
    })
    const evidenceRefs = currentVersions
      .flatMap(({ version }) =>
        proposalEvidenceIds(version.evidence).map((observationKey) => ({
          runId: version.runId,
          observationKey,
        })),
      )
      .slice(0, 5_000)
    const semanticConflictKeys = [
      ...new Set(
        currentVersions.map(({ proposal }) => proposal.semanticConflictKey),
      ),
    ]
    const [evidenceRows, activeProposals] = await Promise.all([
      evidenceRefs.length === 0
        ? Promise.resolve([] as ProposalEvidenceRow[])
        : this.prisma.seoEvidenceObservation.findMany({
            where: { OR: evidenceRefs },
            take: 5_000,
            select: {
              runId: true,
              observationKey: true,
              provider: true,
              quality: true,
              citations: true,
              retrievedAt: true,
            },
          }),
      semanticConflictKeys.length === 0
        ? Promise.resolve(
            [] as Array<{
              id: string
              semanticConflictKey: string
            }>,
          )
        : this.prisma.seoProposal.findMany({
            where: {
              semanticConflictKey: { in: semanticConflictKeys },
              status: { in: ["PROPOSED", "APPROVED", "MATERIALIZED"] },
            },
            select: { id: true, semanticConflictKey: true },
          }),
    ])
    const activeCountByConflictKey = new Map<string, number>()
    for (const proposal of activeProposals) {
      activeCountByConflictKey.set(
        proposal.semanticConflictKey,
        (activeCountByConflictKey.get(proposal.semanticConflictKey) ?? 0) + 1,
      )
    }
    return {
      evidenceByKey: new Map(
        evidenceRows.map((row) => [`${row.runId}:${row.observationKey}`, row]),
      ),
      overlapCountByProposalId: new Map(
        currentVersions.map(({ proposal }) => [
          proposal.id,
          Math.max(
            0,
            (activeCountByConflictKey.get(proposal.semanticConflictKey) ?? 0) -
              (activeProposals.some((active) => active.id === proposal.id)
                ? 1
                : 0),
          ),
        ]),
      ),
    }
  }

  private async lockAutomationMode(tx: SeoTransaction) {
    const rows = await tx.$queryRaw<Array<{ mode: string }>>(Prisma.sql`
      SELECT mode::text AS mode
      FROM seo_automation_state
      WHERE key = 'global'
      FOR SHARE
    `)
    return normalizedMode(rows[0]?.mode ?? "off")
  }

  private async assertLiveAutomationMode(tx: SeoTransaction) {
    if ((await this.lockAutomationMode(tx)) !== "LIVE") {
      throw new SeoLedgerConflictError("seo_automation_not_live")
    }
  }

  private async consumeWorkloadAssertion(
    tx: SeoTransaction,
    assertion: VerifiedSeoWorkloadAssertion,
  ) {
    try {
      await tx.seoWorkloadAssertion.create({
        data: {
          jtiHash: assertion.jtiHash,
          keyId: assertion.keyId,
          environment: assertion.environment,
          audience: assertion.audience,
          capability: assertion.capability,
          requestDigest: assertion.requestDigest,
          expiresAt: assertion.expiresAt,
        },
      })
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new SeoAssertionReplayError()
      }
      throw error
    }
  }

  private async consumeApprovalNonce(
    tx: SeoTransaction,
    assertion: VerifiedSeoApprovalAssertion,
    proposalVersionId: string,
  ) {
    try {
      await tx.seoApprovalNonce.create({
        data: {
          nonceHash: assertion.nonceHash,
          keyId: assertion.keyId,
          environment: assertion.environment,
          audience: assertion.audience,
          actorId: assertion.actorId,
          action: enumDecisionAction(assertion.action),
          proposalVersionId,
          expiresAt: assertion.expiresAt,
        },
      })
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new SeoAssertionReplayError()
      }
      throw error
    }
  }

  private runRecord(run: {
    id: string
    idempotencyKey: string
    mode: string
    status: string
    providerCoverage: unknown
    report: unknown
    eligibleCount: number
    selectedCount: number
    wouldProposeCount: number
    proposedCount: number
    materializationCount: number
    ticketCount: number
    experimentCount: number
    suppressedOperations: string[]
    startedAt: Date
    completedAt: Date | null
  }) {
    return {
      runId: run.id,
      idempotencyKey: run.idempotencyKey,
      mode: run.mode,
      status: run.status,
      providerCoverage: run.providerCoverage,
      report: run.report,
      eligibleCount: run.eligibleCount,
      selectedCount: run.selectedCount,
      wouldProposeCount: run.wouldProposeCount,
      proposedCount: run.proposedCount,
      materializationCount: run.materializationCount,
      ticketCount: run.ticketCount,
      experimentCount: run.experimentCount,
      suppressedOperations: run.suppressedOperations,
      startedAt: run.startedAt.toISOString(),
      completedAt: iso(run.completedAt),
    }
  }

  private decisionRecord(version: {
    proposalId: string
    version: number
    decision: { id: string; action: SeoDecisionAction } | null
    materialization: {
      contentRevisionId: string | null
      editorPath: string | null
    } | null
    ticketOutbox: { id: string } | null
  }): ManagerSeoDecisionRecord {
    const approved = version.decision?.action === "APPROVE"
    return {
      status: approved ? "APPROVED" : "REJECTED",
      proposalId: version.proposalId,
      version: version.version,
      decisionId: version.decision?.id ?? null,
      draftRevisionId: version.materialization?.contentRevisionId ?? null,
      editorPath: version.materialization?.editorPath ?? null,
      ticketOutboxId: version.ticketOutbox?.id ?? null,
      message: approved
        ? "Proposal was already approved."
        : "Proposal was already rejected.",
    }
  }

  private statusDecision(
    version: { proposalId: string; version: number },
    status: ManagerSeoDecisionRecord["status"],
    message: string,
  ): ManagerSeoDecisionRecord {
    return {
      status,
      proposalId: version.proposalId,
      version: version.version,
      decisionId: null,
      draftRevisionId: null,
      editorPath: null,
      ticketOutboxId: null,
      message,
    }
  }

  private ticketRecord(row: {
    id: string
    status: string
    payloadDigest: string
    marker: string
    attemptCount: number
    lastErrorCode: string | null
    remoteId: string | null
    remoteUrl: string | null
    proposalVersion: { proposalId: string; version: number }
    attempts: Array<{ outcome: string; detail: unknown; attemptedAt: Date }>
  }) {
    const candidateAttempt = row.attempts.find(
      (attempt) => attempt.outcome === "manual_reconcile",
    )
    const detail = candidateAttempt?.detail
    const candidates =
      detail && typeof detail === "object" && !Array.isArray(detail)
        ? ((detail as Record<string, unknown>).candidates ?? [])
        : []
    return {
      outboxId: row.id,
      proposalId: row.proposalVersion.proposalId,
      proposalVersion: row.proposalVersion.version,
      status: row.status,
      payloadDigest: row.payloadDigest,
      marker: row.marker,
      attemptCount: row.attemptCount,
      lastErrorCode: row.lastErrorCode,
      remoteId: row.remoteId,
      remoteUrl: row.remoteUrl,
      attempts: row.attempts.map((attempt) => ({
        outcome: attempt.outcome,
        detail: attempt.detail,
        attemptedAt: attempt.attemptedAt.toISOString(),
      })),
      candidateTickets: candidates,
    }
  }
}

export type ManagerSeoDecisionRecord = {
  status:
    | "APPROVED"
    | "REJECTED"
    | "STALE"
    | "CONFLICT"
    | "ALREADY_DECIDED"
    | "EXPIRED"
  proposalId: string
  version: number
  decisionId: string | null
  draftRevisionId: string | null
  editorPath: string | null
  ticketOutboxId: string | null
  message: string
}

export class SeoLedgerConflictError extends Error {
  constructor(readonly code: string) {
    super("SEO ledger transition rejected")
    this.name = "SeoLedgerConflictError"
  }
}

export class SeoAssertionReplayError extends Error {
  constructor() {
    super("SEO assertion has already been consumed")
    this.name = "SeoAssertionReplayError"
  }
}
