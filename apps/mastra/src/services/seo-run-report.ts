import { z } from "zod"

export const SEO_SELECTION_POLICY_ID = "gsc-low-ctr-v1" as const
export const SEO_RUN_REPORT_MAX_BYTES = 220 * 1_024
const SEO_RUN_REPORT_PROJECTION_BYTES = SEO_RUN_REPORT_MAX_BYTES - 1_024

const DigestSchema = z.string().regex(/^[a-f0-9]{64}$/u)
const BoundedIdSchema = z.string().trim().min(1).max(191)

export const SeoRunQueryFunnelSchema = z
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
  .strict()

export const SeoRunQueryDecisionSchema = z
  .object({
    observationId: BoundedIdSchema,
    targetId: BoundedIdSchema,
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

const SeoRunGscFilterSchema = z
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

const SeoRunGscRequestSchema = z
  .object({
    propertyId: z.string().min(1).max(500),
    startDate: z.string().date(),
    endDate: z.string().date(),
    dimensions: z.array(z.string().max(50)).max(5),
    searchType: z.literal("web"),
    dataState: z.enum(["final", "all", "hourly_all"]),
    filters: z.array(SeoRunGscFilterSchema).max(20),
    omittedFilterCount: z.number().int().nonnegative(),
    timezone: z.string().max(100),
    configuredRowCap: z.number().int().nonnegative(),
    returnedRowCount: z.number().int().nonnegative(),
    pageCount: z.number().int().nonnegative(),
    requestCount: z.number().int().nonnegative(),
    capReached: z.boolean(),
    responseAggregationType: z.string().max(100).nullable(),
    firstIncompleteDate: z.string().date().nullable(),
    status: z.enum(["available", "partial", "unavailable"]),
    caveats: z.array(z.string().max(500)).max(20),
    omittedCaveatCount: z.number().int().nonnegative(),
  })
  .strict()

const SeoRunProposalRefSchema = z
  .object({
    proposalId: BoundedIdSchema,
    payloadDigest: DigestSchema,
    disposition: z.enum(["would_propose", "pending_persistence"]),
  })
  .strict()

export const SeoRunSelectionAuditSchema = z
  .object({
    selectionPolicyId: z.literal(SEO_SELECTION_POLICY_ID),
    funnel: SeoRunQueryFunnelSchema,
    queryDecisions: z.array(SeoRunQueryDecisionSchema).max(100),
    omittedQueryDecisionCount: z.number().int().nonnegative(),
  })
  .strict()

const SeoRunReportObjectSchema = z
  .object({
    schemaVersion: z.literal(1),
    detailState: z.literal("available"),
    selectionPolicyId: z.literal(SEO_SELECTION_POLICY_ID),
    generatedAt: z.string().datetime(),
    eligibleCount: z.number().int().nonnegative(),
    observedCount: z.number().int().nonnegative(),
    selectedCount: z.number().int().nonnegative(),
    wouldProposeCount: z.number().int().nonnegative(),
    persistedProposalCount: z.number().int().nonnegative(),
    providerCoverage: z.record(
      z.string(),
      z.enum(["available", "partial", "unavailable"]),
    ),
    skippedTargetIds: z.array(z.string().max(200)).max(1_000),
    omittedSkippedTargetCount: z.number().int().nonnegative(),
    suppressedOperations: z.array(z.string().max(191)).max(100),
    gscRequests: z.array(SeoRunGscRequestSchema).max(50),
    omittedGscRequestCount: z.number().int().nonnegative(),
    queryFunnel: SeoRunQueryFunnelSchema,
    queryDecisions: z.array(SeoRunQueryDecisionSchema).max(100),
    omittedQueryDecisionCount: z.number().int().nonnegative(),
    proposalRefs: z.array(SeoRunProposalRefSchema).max(50),
  })
  .strict()

export const SeoRunReportSchema = SeoRunReportObjectSchema.superRefine(
  (report, context) => {
    if (serializedSeoRunReportBytes(report) > SEO_RUN_REPORT_MAX_BYTES) {
      context.addIssue({
        code: "custom",
        message: `SEO run report exceeds ${SEO_RUN_REPORT_MAX_BYTES} bytes`,
      })
    }
  },
)

export type SeoRunReport = z.infer<typeof SeoRunReportSchema>

export function serializedSeoRunReportBytes(
  report: z.infer<typeof SeoRunReportObjectSchema>,
): number {
  return Buffer.byteLength(JSON.stringify(report), "utf8")
}

function trimToLargestFittingPrefix<T>(
  report: z.infer<typeof SeoRunReportObjectSchema>,
  values: T[],
  assign: (kept: T[]) => void,
): number {
  let minimum = 0
  let maximum = values.length
  while (minimum < maximum) {
    const candidate = Math.ceil((minimum + maximum) / 2)
    assign(values.slice(0, candidate))
    if (
      serializedSeoRunReportBytes(report) <= SEO_RUN_REPORT_PROJECTION_BYTES
    ) {
      minimum = candidate
    } else {
      maximum = candidate - 1
    }
  }
  assign(values.slice(0, minimum))
  return values.length - minimum
}

/**
 * Produce the persisted/detail projection with deterministic tail truncation.
 * Proposal references and scalar funnel totals remain authoritative even when
 * verbose evidence detail must be omitted to preserve the response budget.
 */
export function projectSeoRunReport(
  input: z.input<typeof SeoRunReportObjectSchema>,
): SeoRunReport {
  const report = SeoRunReportObjectSchema.parse(input)
  const withinBudget = () =>
    serializedSeoRunReportBytes(report) <= SEO_RUN_REPORT_PROJECTION_BYTES
  if (withinBudget()) return SeoRunReportSchema.parse(report)

  const selectedDecisions = report.queryDecisions.filter(
    (decision) => decision.selectionOutcome === "selected",
  )
  const rejectedDecisions = report.queryDecisions.filter(
    (decision) => decision.selectionOutcome !== "selected",
  )
  report.queryDecisions = [...selectedDecisions, ...rejectedDecisions]
  report.omittedQueryDecisionCount += trimToLargestFittingPrefix(
    report,
    rejectedDecisions,
    (kept) => {
      report.queryDecisions = [...selectedDecisions, ...kept]
    },
  )
  if (withinBudget()) return SeoRunReportSchema.parse(report)

  const skippedTargetIds = report.skippedTargetIds
  report.omittedSkippedTargetCount += trimToLargestFittingPrefix(
    report,
    skippedTargetIds,
    (kept) => {
      report.skippedTargetIds = kept
    },
  )
  if (withinBudget()) return SeoRunReportSchema.parse(report)

  for (let index = report.gscRequests.length - 1; index >= 0; index -= 1) {
    const request = report.gscRequests[index]!
    const caveats = request.caveats
    request.omittedCaveatCount += trimToLargestFittingPrefix(
      report,
      caveats,
      (kept) => {
        request.caveats = kept
      },
    )
    if (withinBudget()) return SeoRunReportSchema.parse(report)
  }

  for (let index = report.gscRequests.length - 1; index >= 0; index -= 1) {
    const request = report.gscRequests[index]!
    const filters = request.filters
    request.omittedFilterCount += trimToLargestFittingPrefix(
      report,
      filters,
      (kept) => {
        request.filters = kept
      },
    )
    if (withinBudget()) return SeoRunReportSchema.parse(report)
  }

  const queryDecisions = report.queryDecisions
  report.omittedQueryDecisionCount += trimToLargestFittingPrefix(
    report,
    queryDecisions,
    (kept) => {
      report.queryDecisions = kept
    },
  )
  if (withinBudget()) return SeoRunReportSchema.parse(report)

  const gscRequests = report.gscRequests
  report.omittedGscRequestCount += trimToLargestFittingPrefix(
    report,
    gscRequests,
    (kept) => {
      report.gscRequests = kept
    },
  )
  if (withinBudget()) return SeoRunReportSchema.parse(report)

  throw new Error("SEO run report cannot fit the bounded detail projection")
}

export function createEmptySeoRunReport(generatedAt: string): SeoRunReport {
  return {
    schemaVersion: 1,
    detailState: "available",
    selectionPolicyId: SEO_SELECTION_POLICY_ID,
    generatedAt,
    eligibleCount: 0,
    observedCount: 0,
    selectedCount: 0,
    wouldProposeCount: 0,
    persistedProposalCount: 0,
    providerCoverage: {},
    skippedTargetIds: [],
    omittedSkippedTargetCount: 0,
    suppressedOperations: [],
    gscRequests: [],
    omittedGscRequestCount: 0,
    queryFunnel: {
      providerRows: 0,
      malformedRows: 0,
      unmatchedTargetRows: 0,
      belowImpressionThresholdRows: 0,
      ctrThresholdNotMetRows: 0,
      rankedRows: 0,
      selectedQueryRows: 0,
      rejectedQueryRows: 0,
    },
    queryDecisions: [],
    omittedQueryDecisionCount: 0,
    proposalRefs: [],
  }
}
