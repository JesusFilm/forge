import type { SeoLessonStatus } from "@prisma/client"
import { builder } from "@/graphql/builder"
import { verifySeoApprovalAssertion } from "@/auth/seo-approval-assertion"
import { SeoAssertionInvalidError } from "@/auth/seo-assertion-keyring"
import type {
  ManagerSeoDecisionRecord,
  ManagerSeoProposalRecord,
  ManagerSeoRunSummaryRecord,
} from "@/services/seo-experiment.service"

type Workspace = Awaited<
  ReturnType<
    import("@/services/seo-experiment.service").SeoExperimentService["listWorkspace"]
  >
>

type Experiment = Workspace["experiments"][number]
type Evaluation = Experiment["evaluations"][number]
type Lesson = Workspace["lessons"][number]
type TicketReconciliation = Workspace["ticketReconciliations"][number]
type RunPage = Awaited<
  ReturnType<
    import("@/services/seo-experiment.service").SeoExperimentService["listRuns"]
  >
>
type RunDetail = NonNullable<
  Awaited<
    ReturnType<
      import("@/services/seo-experiment.service").SeoExperimentService["getRun"]
    >
  >
>
type RunProposalOutcome = RunDetail["proposalOutcomes"][number]

type ManagerSeoRunProposalReference = {
  proposalId: string
  payloadDigest: string
  disposition: string
  version: number | null
  originatingRunId: string | null
}

type ManagerSeoProviderCoverage = {
  provider: string
  status: string
}

type ManagerSeoRunReportBase = {
  schemaVersion: number
  detailState: string
  selectionPolicyId: string | null
  eligibleCount: number
  selectedCount: number
  wouldProposeCount: number
  persistedProposalCount: number
  providerCoverage: ManagerSeoProviderCoverage[]
  suppressedOperations: string[]
  proposalRefs: ManagerSeoRunProposalReference[]
}

type ManagerSeoRunGscRequest = {
  propertyId: string
  startDate: string
  endDate: string
  dimensions: string[]
  searchType: string
  dataState: string
  filters: ManagerSeoRunGscFilter[]
  omittedFilterCount: number
  timezone: string
  configuredRowCap: number
  returnedRowCount: number
  pageCount: number
  requestCount: number
  capReached: boolean
  responseAggregationType: string | null
  firstIncompleteDate: string | null
  status: string
  caveats: string[]
  omittedCaveatCount: number
}

type ManagerSeoRunGscFilter = {
  dimension: string
  operator: string
  expression: string
}

type ManagerSeoRunQueryFunnel = {
  providerRows: number
  malformedRows: number
  unmatchedTargetRows: number
  belowImpressionThresholdRows: number
  ctrThresholdNotMetRows: number
  rankedRows: number
  selectedQueryRows: number
  rejectedQueryRows: number
}

type ManagerSeoRunQueryDecision = {
  observationId: string
  targetId: string
  locale: string
  query: string
  canonicalUrl: string
  clicks: number
  impressions: number
  ctr: number
  position: number
  score: number
  selectionOutcome: string
  reason: string
}

type ManagerSeoRunReportAvailable = ManagerSeoRunReportBase & {
  detailState: "available"
  generatedAt: string
  observedCount: number
  skippedTargetIds: string[]
  omittedSkippedTargetCount: number
  gscRequests: ManagerSeoRunGscRequest[]
  omittedGscRequestCount: number
  queryFunnel: ManagerSeoRunQueryFunnel
  queryDecisions: ManagerSeoRunQueryDecision[]
  omittedQueryDecisionCount: number
}

type ManagerSeoRunReportUnavailable = ManagerSeoRunReportBase & {
  detailState: string
  observedCount: number | null
}

type ManagerSeoRunReportCompacted = ManagerSeoRunReportBase & {
  detailState: "detail_expired" | "detail_suppressed_retention_unhealthy"
  detailExpiresAt: string | null
  compactedAt: string
}

type ManagerSeoRunHumanDecision = {
  action: string
  actorId: string
  reason: string | null
  decidedAt: string
}

type ManagerSeoRunLatestEvaluation = {
  kind: string
  outcome: string
  observedAt: string
}

type ManagerSeoRunOutcomeExperiment = {
  id: string
  status: string
  latestEvaluation: ManagerSeoRunLatestEvaluation | null
}

function managerSeoProviderCoverage(
  value: Record<string, unknown>,
): ManagerSeoProviderCoverage[] {
  return Object.entries(value).map(([provider, status]) => ({
    provider,
    status: String(status),
  }))
}

function managerSeoRunReport(
  report: RunDetail["report"],
):
  | ManagerSeoRunReportAvailable
  | ManagerSeoRunReportUnavailable
  | ManagerSeoRunReportCompacted
  | null {
  if (!report || typeof report !== "object" || Array.isArray(report)) {
    return null
  }
  const value = report as Record<string, unknown>
  const base: ManagerSeoRunReportBase = {
    schemaVersion: Number(value.schemaVersion),
    detailState: String(value.detailState),
    selectionPolicyId:
      typeof value.selectionPolicyId === "string"
        ? value.selectionPolicyId
        : null,
    eligibleCount: Number(value.eligibleCount),
    selectedCount: Number(value.selectedCount),
    wouldProposeCount: Number(value.wouldProposeCount),
    persistedProposalCount: Number(value.persistedProposalCount),
    providerCoverage: managerSeoProviderCoverage(
      (value.providerCoverage as Record<string, unknown>) ?? {},
    ),
    suppressedOperations: Array.isArray(value.suppressedOperations)
      ? value.suppressedOperations.map(String)
      : [],
    proposalRefs: Array.isArray(value.proposalRefs)
      ? (value.proposalRefs as ManagerSeoRunProposalReference[])
      : [],
  }
  if (value.detailState === "available") {
    return {
      ...base,
      detailState: "available",
      generatedAt: String(value.generatedAt),
      observedCount: Number(value.observedCount),
      skippedTargetIds: Array.isArray(value.skippedTargetIds)
        ? value.skippedTargetIds.map(String)
        : [],
      omittedSkippedTargetCount: Number(value.omittedSkippedTargetCount),
      gscRequests: value.gscRequests as ManagerSeoRunGscRequest[],
      omittedGscRequestCount: Number(value.omittedGscRequestCount),
      queryFunnel: value.queryFunnel as ManagerSeoRunQueryFunnel,
      queryDecisions: value.queryDecisions as ManagerSeoRunQueryDecision[],
      omittedQueryDecisionCount: Number(value.omittedQueryDecisionCount),
    }
  }
  if (typeof value.compactedAt === "string") {
    return {
      ...base,
      detailState:
        value.detailState as ManagerSeoRunReportCompacted["detailState"],
      detailExpiresAt:
        typeof value.detailExpiresAt === "string"
          ? value.detailExpiresAt
          : null,
      compactedAt: value.compactedAt,
    }
  }
  return {
    ...base,
    observedCount:
      typeof value.observedCount === "number" ? value.observedCount : null,
  }
}

const ManagerSeoDecisionRef = builder
  .objectRef<ManagerSeoDecisionRecord>("ManagerSeoDecisionResult")
  .implement({
    fields: (t) => ({
      status: t.exposeString("status"),
      proposalId: t.exposeID("proposalId"),
      version: t.exposeInt("version"),
      decisionId: t.exposeID("decisionId", { nullable: true }),
      draftRevisionId: t.exposeID("draftRevisionId", { nullable: true }),
      editorPath: t.exposeString("editorPath", { nullable: true }),
      ticketOutboxId: t.exposeID("ticketOutboxId", { nullable: true }),
      message: t.exposeString("message"),
    }),
  })

const ManagerSeoProposalDecisionRef = builder
  .objectRef<
    NonNullable<ManagerSeoProposalRecord["decision"]>
  >("ManagerSeoProposalDecision")
  .implement({
    fields: (t) => ({
      id: t.exposeID("id"),
      action: t.exposeString("action"),
      actorId: t.exposeString("actorId"),
      overlapAcknowledged: t.exposeBoolean("overlapAcknowledged"),
      overlapCount: t.exposeInt("overlapCount"),
      reason: t.exposeString("reason", { nullable: true }),
      decidedAt: t.exposeString("decidedAt"),
    }),
  })

const ManagerSeoProposalMaterializationRef = builder
  .objectRef<
    NonNullable<ManagerSeoProposalRecord["materialization"]>
  >("ManagerSeoProposalMaterialization")
  .implement({
    fields: (t) => ({
      status: t.exposeString("status"),
      draftRevisionId: t.exposeID("draftRevisionId", { nullable: true }),
      editorPath: t.exposeString("editorPath", { nullable: true }),
      ticketOutboxId: t.exposeID("ticketOutboxId", { nullable: true }),
    }),
  })

const ManagerSeoProposalRef = builder
  .objectRef<ManagerSeoProposalRecord>("ManagerSeoProposal")
  .implement({
    fields: (t) => ({
      id: t.exposeID("id"),
      version: t.exposeInt("version"),
      payloadDigest: t.exposeString("payloadDigest"),
      status: t.exposeString("status"),
      lane: t.exposeString("lane"),
      targetType: t.exposeString("targetType"),
      targetId: t.exposeID("targetId", { nullable: true }),
      canonicalUrl: t.exposeString("canonicalUrl"),
      locale: t.exposeString("locale"),
      intent: t.exposeString("intent"),
      expectedOutcome: t.exposeString("expectedOutcome"),
      risk: t.exposeString("risk"),
      verificationPlan: t.exposeString("verificationPlan"),
      rollbackPlan: t.exposeString("rollbackPlan"),
      editorialDiff: t.field({
        type: "JSON",
        nullable: true,
        resolve: (row) => row.editorialDiff,
      }),
      engineeringBrief: t.field({
        type: "JSON",
        nullable: true,
        resolve: (row) => row.engineeringBrief,
      }),
      evidence: t.field({ type: "JSON", resolve: (row) => row.evidence }),
      caveats: t.field({ type: ["String"], resolve: (row) => row.caveats }),
      overlapCount: t.exposeInt("overlapCount"),
      expiresAt: t.exposeString("expiresAt"),
      createdAt: t.exposeString("createdAt"),
      decision: t.field({
        type: ManagerSeoProposalDecisionRef,
        nullable: true,
        resolve: (row) => row.decision,
      }),
      materialization: t.field({
        type: ManagerSeoProposalMaterializationRef,
        nullable: true,
        resolve: (row) => row.materialization,
      }),
    }),
  })

const ManagerSeoEvaluationRef = builder
  .objectRef<Evaluation>("ManagerSeoEvaluation")
  .implement({
    fields: (t) => ({
      id: t.exposeID("id"),
      kind: t.exposeString("kind"),
      outcome: t.exposeString("outcome"),
      metrics: t.field({ type: "JSON", resolve: (row) => row.metrics }),
      evidenceDigest: t.exposeString("evidenceDigest"),
      confounders: t.field({ type: "JSON", resolve: (row) => row.confounders }),
      observedAt: t.exposeString("observedAt"),
    }),
  })

const ManagerSeoExperimentRef = builder
  .objectRef<Experiment>("ManagerSeoExperiment")
  .implement({
    fields: (t) => ({
      id: t.exposeID("id"),
      proposalId: t.exposeID("proposalId"),
      proposalVersion: t.exposeInt("proposalVersion"),
      status: t.exposeString("status"),
      canonicalUrl: t.exposeString("canonicalUrl"),
      locale: t.exposeString("locale"),
      lane: t.exposeString("lane"),
      activatedAt: t.exposeString("activatedAt", { nullable: true }),
      observedActivationHash: t.exposeString("observedActivationHash", {
        nullable: true,
      }),
      measurementStartsAt: t.exposeString("measurementStartsAt", {
        nullable: true,
      }),
      interimDueAt: t.exposeString("interimDueAt", { nullable: true }),
      finalDueAt: t.exposeString("finalDueAt", { nullable: true }),
      confounders: t.field({ type: "JSON", resolve: (row) => row.confounders }),
      evaluations: t.field({
        type: [ManagerSeoEvaluationRef],
        resolve: (row) => row.evaluations,
      }),
    }),
  })

const ManagerSeoLessonRef = builder
  .objectRef<Lesson>("ManagerSeoLesson")
  .implement({
    fields: (t) => ({
      id: t.exposeID("id"),
      experimentId: t.exposeID("experimentId"),
      proposalId: t.exposeID("proposalId"),
      proposalVersion: t.exposeInt("proposalVersion"),
      status: t.exposeString("status"),
      content: t.exposeString("content"),
      evidenceDigest: t.exposeString("evidenceDigest"),
      metrics: t.field({ type: "JSON", resolve: (row) => row.metrics }),
      confounders: t.field({ type: "JSON", resolve: (row) => row.confounders }),
      reviewedById: t.exposeString("reviewedById", { nullable: true }),
      reviewedAt: t.exposeString("reviewedAt", { nullable: true }),
      createdAt: t.exposeString("createdAt"),
    }),
  })

const ManagerSeoTicketReconciliationRef = builder
  .objectRef<TicketReconciliation>("ManagerSeoTicketReconciliation")
  .implement({
    fields: (t) => ({
      outboxId: t.exposeID("outboxId"),
      proposalId: t.exposeID("proposalId"),
      proposalVersion: t.exposeInt("proposalVersion"),
      status: t.exposeString("status"),
      payloadDigest: t.exposeString("payloadDigest"),
      marker: t.exposeString("marker"),
      attemptCount: t.exposeInt("attemptCount"),
      lastErrorCode: t.exposeString("lastErrorCode", { nullable: true }),
      remoteId: t.exposeString("remoteId", { nullable: true }),
      remoteUrl: t.exposeString("remoteUrl", { nullable: true }),
      attempts: t.field({ type: "JSON", resolve: (row) => row.attempts }),
      candidateTickets: t.field({
        type: "JSON",
        resolve: (row) => row.candidateTickets,
      }),
    }),
  })

const ManagerSeoWorkspaceRef = builder
  .objectRef<Workspace>("ManagerSeoWorkspace")
  .implement({
    fields: (t) => ({
      generatedAt: t.exposeString("generatedAt"),
      proposals: t.field({
        type: [ManagerSeoProposalRef],
        resolve: (row) => row.proposals,
      }),
      experiments: t.field({
        type: [ManagerSeoExperimentRef],
        resolve: (row) => row.experiments,
      }),
      lessons: t.field({
        type: [ManagerSeoLessonRef],
        resolve: (row) => row.lessons,
      }),
      ticketReconciliations: t.field({
        type: [ManagerSeoTicketReconciliationRef],
        resolve: (row) => row.ticketReconciliations,
      }),
    }),
  })

const ManagerSeoRunSummaryRef = builder
  .objectRef<ManagerSeoRunSummaryRecord>("ManagerSeoRunSummary")
  .implement({
    fields: (t) => ({
      id: t.exposeID("id"),
      mode: t.exposeString("mode"),
      status: t.exposeString("status"),
      startedAt: t.exposeString("startedAt"),
      completedAt: t.exposeString("completedAt", { nullable: true }),
      eligibleCount: t.exposeInt("eligibleCount"),
      selectedCount: t.exposeInt("selectedCount"),
      wouldProposeCount: t.exposeInt("wouldProposeCount"),
      proposedCount: t.exposeInt("proposedCount"),
      materializationCount: t.exposeInt("materializationCount"),
      ticketCount: t.exposeInt("ticketCount"),
      experimentCount: t.exposeInt("experimentCount"),
      suppressedOperations: t.exposeStringList("suppressedOperations"),
      providerCoverage: t.field({
        type: "JSON",
        resolve: (row) => row.providerCoverage,
      }),
      reportAvailability: t.exposeString("reportAvailability"),
      reclaimed: t.exposeBoolean("reclaimed"),
    }),
  })

const ManagerSeoRunPageRef = builder
  .objectRef<RunPage>("ManagerSeoRunPage")
  .implement({
    fields: (t) => ({
      generatedAt: t.exposeString("generatedAt"),
      items: t.field({
        type: [ManagerSeoRunSummaryRef],
        resolve: (row) => row.items,
      }),
      hasNextPage: t.exposeBoolean("hasNextPage"),
      nextCursor: t.exposeString("nextCursor", { nullable: true }),
    }),
  })

const ManagerSeoRunProposalReferenceRef = builder
  .objectRef<ManagerSeoRunProposalReference>("ManagerSeoRunProposalReference")
  .implement({
    fields: (t) => ({
      proposalId: t.exposeID("proposalId"),
      payloadDigest: t.exposeString("payloadDigest"),
      disposition: t.exposeString("disposition"),
      version: t.exposeInt("version", { nullable: true }),
      originatingRunId: t.exposeID("originatingRunId", { nullable: true }),
    }),
  })

const ManagerSeoRunProviderCoverageRef = builder
  .objectRef<ManagerSeoProviderCoverage>("ManagerSeoRunProviderCoverage")
  .implement({
    fields: (t) => ({
      provider: t.exposeString("provider"),
      status: t.exposeString("status"),
    }),
  })

const ManagerSeoRunGscRequestRef = builder
  .objectRef<ManagerSeoRunGscRequest>("ManagerSeoRunGscRequest")
  .implement({
    fields: (t) => ({
      propertyId: t.exposeString("propertyId"),
      startDate: t.exposeString("startDate"),
      endDate: t.exposeString("endDate"),
      dimensions: t.exposeStringList("dimensions"),
      searchType: t.exposeString("searchType"),
      dataState: t.exposeString("dataState"),
      filters: t.field({
        type: [ManagerSeoRunGscFilterRef],
        resolve: (row) => row.filters,
      }),
      omittedFilterCount: t.exposeInt("omittedFilterCount"),
      timezone: t.exposeString("timezone"),
      configuredRowCap: t.exposeInt("configuredRowCap"),
      returnedRowCount: t.exposeInt("returnedRowCount"),
      pageCount: t.exposeInt("pageCount"),
      requestCount: t.exposeInt("requestCount"),
      capReached: t.exposeBoolean("capReached"),
      responseAggregationType: t.exposeString("responseAggregationType", {
        nullable: true,
      }),
      firstIncompleteDate: t.exposeString("firstIncompleteDate", {
        nullable: true,
      }),
      status: t.exposeString("status"),
      caveats: t.exposeStringList("caveats"),
      omittedCaveatCount: t.exposeInt("omittedCaveatCount"),
    }),
  })

const ManagerSeoRunGscFilterRef = builder
  .objectRef<ManagerSeoRunGscFilter>("ManagerSeoRunGscFilter")
  .implement({
    fields: (t) => ({
      dimension: t.exposeString("dimension"),
      operator: t.exposeString("operator"),
      expression: t.exposeString("expression"),
    }),
  })

const ManagerSeoRunQueryFunnelRef = builder
  .objectRef<ManagerSeoRunQueryFunnel>("ManagerSeoRunQueryFunnel")
  .implement({
    fields: (t) => ({
      providerRows: t.exposeInt("providerRows"),
      malformedRows: t.exposeInt("malformedRows"),
      unmatchedTargetRows: t.exposeInt("unmatchedTargetRows"),
      belowImpressionThresholdRows: t.exposeInt("belowImpressionThresholdRows"),
      ctrThresholdNotMetRows: t.exposeInt("ctrThresholdNotMetRows"),
      rankedRows: t.exposeInt("rankedRows"),
      selectedQueryRows: t.exposeInt("selectedQueryRows"),
      rejectedQueryRows: t.exposeInt("rejectedQueryRows"),
    }),
  })

const ManagerSeoRunQueryDecisionRef = builder
  .objectRef<ManagerSeoRunQueryDecision>("ManagerSeoRunQueryDecision")
  .implement({
    fields: (t) => ({
      observationId: t.exposeID("observationId"),
      targetId: t.exposeID("targetId"),
      locale: t.exposeString("locale"),
      query: t.exposeString("query"),
      canonicalUrl: t.exposeString("canonicalUrl"),
      clicks: t.exposeFloat("clicks"),
      impressions: t.exposeFloat("impressions"),
      ctr: t.exposeFloat("ctr"),
      position: t.exposeFloat("position"),
      score: t.exposeFloat("score"),
      selectionOutcome: t.exposeString("selectionOutcome"),
      reason: t.exposeString("reason"),
    }),
  })

const ManagerSeoRunReportAvailableRef = builder
  .objectRef<ManagerSeoRunReportAvailable>("ManagerSeoRunReportAvailable")
  .implement({
    fields: (t) => ({
      schemaVersion: t.exposeInt("schemaVersion"),
      detailState: t.exposeString("detailState"),
      selectionPolicyId: t.exposeString("selectionPolicyId", {
        nullable: true,
      }),
      generatedAt: t.exposeString("generatedAt"),
      eligibleCount: t.exposeInt("eligibleCount"),
      observedCount: t.exposeInt("observedCount"),
      skippedTargetIds: t.exposeStringList("skippedTargetIds"),
      omittedSkippedTargetCount: t.exposeInt("omittedSkippedTargetCount"),
      selectedCount: t.exposeInt("selectedCount"),
      wouldProposeCount: t.exposeInt("wouldProposeCount"),
      persistedProposalCount: t.exposeInt("persistedProposalCount"),
      providerCoverage: t.field({
        type: [ManagerSeoRunProviderCoverageRef],
        resolve: (row) => row.providerCoverage,
      }),
      suppressedOperations: t.exposeStringList("suppressedOperations"),
      gscRequests: t.field({
        type: [ManagerSeoRunGscRequestRef],
        resolve: (row) => row.gscRequests,
      }),
      omittedGscRequestCount: t.exposeInt("omittedGscRequestCount"),
      queryFunnel: t.field({
        type: ManagerSeoRunQueryFunnelRef,
        resolve: (row) => row.queryFunnel,
      }),
      queryDecisions: t.field({
        type: [ManagerSeoRunQueryDecisionRef],
        resolve: (row) => row.queryDecisions,
      }),
      omittedQueryDecisionCount: t.exposeInt("omittedQueryDecisionCount"),
      proposalRefs: t.field({
        type: [ManagerSeoRunProposalReferenceRef],
        resolve: (row) => row.proposalRefs,
      }),
    }),
  })

const ManagerSeoRunReportUnavailableRef = builder
  .objectRef<ManagerSeoRunReportUnavailable>("ManagerSeoRunReportUnavailable")
  .implement({
    fields: (t) => ({
      schemaVersion: t.exposeInt("schemaVersion"),
      detailState: t.exposeString("detailState"),
      selectionPolicyId: t.exposeString("selectionPolicyId", {
        nullable: true,
      }),
      eligibleCount: t.exposeInt("eligibleCount"),
      observedCount: t.exposeInt("observedCount", { nullable: true }),
      selectedCount: t.exposeInt("selectedCount"),
      wouldProposeCount: t.exposeInt("wouldProposeCount"),
      persistedProposalCount: t.exposeInt("persistedProposalCount"),
      providerCoverage: t.field({
        type: [ManagerSeoRunProviderCoverageRef],
        resolve: (row) => row.providerCoverage,
      }),
      suppressedOperations: t.exposeStringList("suppressedOperations"),
      proposalRefs: t.field({
        type: [ManagerSeoRunProposalReferenceRef],
        resolve: (row) => row.proposalRefs,
      }),
    }),
  })

const ManagerSeoRunReportCompactedRef = builder
  .objectRef<ManagerSeoRunReportCompacted>("ManagerSeoRunReportCompacted")
  .implement({
    fields: (t) => ({
      schemaVersion: t.exposeInt("schemaVersion"),
      detailState: t.exposeString("detailState"),
      selectionPolicyId: t.exposeString("selectionPolicyId", {
        nullable: true,
      }),
      eligibleCount: t.exposeInt("eligibleCount"),
      selectedCount: t.exposeInt("selectedCount"),
      wouldProposeCount: t.exposeInt("wouldProposeCount"),
      persistedProposalCount: t.exposeInt("persistedProposalCount"),
      providerCoverage: t.field({
        type: [ManagerSeoRunProviderCoverageRef],
        resolve: (row) => row.providerCoverage,
      }),
      suppressedOperations: t.exposeStringList("suppressedOperations"),
      proposalRefs: t.field({
        type: [ManagerSeoRunProposalReferenceRef],
        resolve: (row) => row.proposalRefs,
      }),
      detailExpiresAt: t.exposeString("detailExpiresAt", { nullable: true }),
      compactedAt: t.exposeString("compactedAt"),
    }),
  })

const ManagerSeoRunReportRef = builder.unionType("ManagerSeoRunReport", {
  types: [
    ManagerSeoRunReportAvailableRef,
    ManagerSeoRunReportUnavailableRef,
    ManagerSeoRunReportCompactedRef,
  ],
  resolveType: (report) => {
    if (report.detailState === "available") {
      return ManagerSeoRunReportAvailableRef
    }
    return "compactedAt" in report
      ? ManagerSeoRunReportCompactedRef
      : ManagerSeoRunReportUnavailableRef
  },
})

const ManagerSeoRunHumanDecisionRef = builder
  .objectRef<ManagerSeoRunHumanDecision>("ManagerSeoRunHumanDecision")
  .implement({
    fields: (t) => ({
      action: t.exposeString("action"),
      actorId: t.exposeString("actorId"),
      reason: t.exposeString("reason", { nullable: true }),
      decidedAt: t.exposeString("decidedAt"),
    }),
  })

const ManagerSeoRunLatestEvaluationRef = builder
  .objectRef<ManagerSeoRunLatestEvaluation>("ManagerSeoRunLatestEvaluation")
  .implement({
    fields: (t) => ({
      kind: t.exposeString("kind"),
      outcome: t.exposeString("outcome"),
      observedAt: t.exposeString("observedAt"),
    }),
  })

const ManagerSeoRunOutcomeExperimentRef = builder
  .objectRef<ManagerSeoRunOutcomeExperiment>("ManagerSeoRunOutcomeExperiment")
  .implement({
    fields: (t) => ({
      id: t.exposeID("id"),
      status: t.exposeString("status"),
      latestEvaluation: t.field({
        type: ManagerSeoRunLatestEvaluationRef,
        nullable: true,
        resolve: (row) => row.latestEvaluation,
      }),
    }),
  })

const ManagerSeoRunProposalOutcomeRef = builder
  .objectRef<RunProposalOutcome>("ManagerSeoRunProposalOutcome")
  .implement({
    fields: (t) => ({
      proposalId: t.exposeID("proposalId"),
      version: t.exposeInt("version"),
      payloadDigest: t.exposeString("payloadDigest"),
      originatingRunId: t.exposeID("originatingRunId"),
      proposalStatus: t.exposeString("proposalStatus"),
      humanDecision: t.field({
        type: ManagerSeoRunHumanDecisionRef,
        nullable: true,
        resolve: (row) =>
          row.humanDecision as ManagerSeoRunHumanDecision | null,
      }),
      materializationStatus: t.exposeString("materializationStatus", {
        nullable: true,
      }),
      experiment: t.field({
        type: ManagerSeoRunOutcomeExperimentRef,
        nullable: true,
        resolve: (row) =>
          row.experiment as ManagerSeoRunOutcomeExperiment | null,
      }),
    }),
  })

const ManagerSeoRunDetailRef = builder
  .objectRef<RunDetail>("ManagerSeoRunDetail")
  .implement({
    fields: (t) => ({
      id: t.exposeID("id"),
      mode: t.exposeString("mode"),
      status: t.exposeString("status"),
      startedAt: t.exposeString("startedAt"),
      completedAt: t.exposeString("completedAt", { nullable: true }),
      eligibleCount: t.exposeInt("eligibleCount"),
      selectedCount: t.exposeInt("selectedCount"),
      wouldProposeCount: t.exposeInt("wouldProposeCount"),
      proposedCount: t.exposeInt("proposedCount"),
      materializationCount: t.exposeInt("materializationCount"),
      ticketCount: t.exposeInt("ticketCount"),
      experimentCount: t.exposeInt("experimentCount"),
      suppressedOperations: t.exposeStringList("suppressedOperations"),
      providerCoverage: t.field({
        type: "JSON",
        resolve: (row) => row.providerCoverage,
      }),
      reportAvailability: t.exposeString("reportAvailability"),
      reclaimed: t.exposeBoolean("reclaimed"),
      report: t.field({
        type: ManagerSeoRunReportRef,
        nullable: true,
        resolve: (row) => managerSeoRunReport(row.report),
      }),
      proposalOutcomes: t.field({
        type: [ManagerSeoRunProposalOutcomeRef],
        resolve: (row) => row.proposalOutcomes,
      }),
    }),
  })

const ManagerSeoApproveInput = builder.inputType("ManagerSeoApproveInput", {
  fields: (t) => ({
    proposalId: t.id({ required: true }),
    version: t.int({ required: true }),
    payloadDigest: t.string({ required: true }),
    assertion: t.string({ required: true }),
    overlapAcknowledged: t.boolean({ required: false, defaultValue: false }),
  }),
})

const ManagerSeoRejectInput = builder.inputType("ManagerSeoRejectInput", {
  fields: (t) => ({
    proposalId: t.id({ required: true }),
    version: t.int({ required: true }),
    payloadDigest: t.string({ required: true }),
    assertion: t.string({ required: true }),
    reason: t.string({ required: false }),
  }),
})

const ManagerSeoLessonReviewInput = builder.inputType(
  "ManagerSeoLessonReviewInput",
  {
    fields: (t) => ({
      lessonId: t.id({ required: true }),
      status: t.string({ required: true }),
      assertion: t.string({ required: true }),
    }),
  },
)

const ManagerSeoTicketReconcileInput = builder.inputType(
  "ManagerSeoTicketReconcileInput",
  {
    fields: (t) => ({
      outboxId: t.id({ required: true }),
      action: t.string({ required: true }),
      remoteId: t.string({ required: false }),
      remoteUrl: t.string({ required: false }),
      assertion: t.string({ required: true }),
    }),
  },
)

function assertionMatchesInput(
  assertion: Awaited<ReturnType<typeof verifySeoApprovalAssertion>>,
  input: {
    proposalId: string | number
    version: number
    payloadDigest: string
  },
) {
  return (
    assertion.proposalId === String(input.proposalId) &&
    assertion.version === input.version &&
    assertion.payloadDigest === input.payloadDigest
  )
}

builder.queryFields((t) => ({
  managerSeoWorkspace: t.field({
    type: ManagerSeoWorkspaceRef,
    nullable: false,
    authScopes: { hasPermission: "read:manager-seo" },
    args: { limit: t.arg.int({ required: false, defaultValue: 50 }) },
    resolve: (_root, args, ctx) =>
      ctx.services.seoExperiment.listWorkspace({
        user: ctx.user,
        limit: args.limit ?? 50,
      }),
  }),
  managerSeoProposal: t.field({
    type: ManagerSeoProposalRef,
    nullable: true,
    authScopes: { hasPermission: "read:manager-seo" },
    args: { id: t.arg.id({ required: true }) },
    resolve: (_root, args, ctx) =>
      ctx.services.seoExperiment.getProposal({
        user: ctx.user,
        id: String(args.id),
      }),
  }),
  managerSeoRuns: t.field({
    type: ManagerSeoRunPageRef,
    nullable: false,
    authScopes: { hasPermission: "read:manager-seo" },
    args: {
      limit: t.arg.int({ required: false, defaultValue: 25 }),
      after: t.arg.string({ required: false }),
    },
    resolve: (_root, args, ctx) =>
      ctx.services.seoExperiment.listRuns({
        user: ctx.user,
        limit: args.limit ?? 25,
        after: args.after,
      }),
  }),
  managerSeoRun: t.field({
    type: ManagerSeoRunDetailRef,
    nullable: true,
    authScopes: { hasPermission: "read:manager-seo-audit-detail" },
    args: { id: t.arg.id({ required: true }) },
    resolve: (_root, args, ctx) =>
      ctx.services.seoExperiment.getRun({
        user: ctx.user,
        id: String(args.id),
      }),
  }),
}))

builder.mutationFields((t) => ({
  approveManagerSeoProposal: t.field({
    type: ManagerSeoDecisionRef,
    nullable: false,
    authScopes: { hasPermission: "read:manager-seo" },
    args: { input: t.arg({ type: ManagerSeoApproveInput, required: true }) },
    resolve: async (_root, { input }, ctx) => {
      const assertion = await verifySeoApprovalAssertion(input.assertion)
      if (!assertionMatchesInput(assertion, input)) {
        throw new SeoAssertionInvalidError()
      }
      return ctx.services.seoExperiment.decideProposal({
        user: ctx.user,
        assertion,
        expectedAction: "approve",
        overlapAcknowledged: input.overlapAcknowledged ?? false,
      })
    },
  }),
  rejectManagerSeoProposal: t.field({
    type: ManagerSeoDecisionRef,
    nullable: false,
    authScopes: { hasPermission: "read:manager-seo" },
    args: { input: t.arg({ type: ManagerSeoRejectInput, required: true }) },
    resolve: async (_root, { input }, ctx) => {
      const assertion = await verifySeoApprovalAssertion(input.assertion)
      if (!assertionMatchesInput(assertion, input)) {
        throw new SeoAssertionInvalidError()
      }
      return ctx.services.seoExperiment.decideProposal({
        user: ctx.user,
        assertion,
        expectedAction: "reject",
        reason: input.reason,
      })
    },
  }),
  reviewManagerSeoLesson: t.field({
    type: ManagerSeoLessonRef,
    nullable: false,
    authScopes: { hasPermission: "read:manager-seo" },
    args: {
      input: t.arg({ type: ManagerSeoLessonReviewInput, required: true }),
    },
    resolve: async (_root, { input }, ctx) => {
      const assertion = await verifySeoApprovalAssertion(input.assertion)
      const statuses: ReadonlySet<string> = new Set([
        "ACTIVE",
        "SUPERSEDED",
        "RETIRED",
      ])
      if (!statuses.has(input.status)) throw new SeoAssertionInvalidError()
      return ctx.services.seoExperiment.reviewLesson({
        user: ctx.user,
        assertion,
        lessonId: String(input.lessonId),
        status: input.status as SeoLessonStatus,
      })
    },
  }),
  reconcileManagerSeoTicket: t.field({
    type: ManagerSeoTicketReconciliationRef,
    nullable: false,
    authScopes: { hasPermission: "read:manager-seo" },
    args: {
      input: t.arg({ type: ManagerSeoTicketReconcileInput, required: true }),
    },
    resolve: async (_root, { input }, ctx) => {
      const assertion = await verifySeoApprovalAssertion(input.assertion)
      if (input.action !== "BIND_EXISTING" && input.action !== "MARK_FAILED") {
        throw new SeoAssertionInvalidError()
      }
      return ctx.services.seoExperiment.reconcileTicket({
        user: ctx.user,
        assertion,
        outboxId: String(input.outboxId),
        action: input.action,
        remoteId: input.remoteId,
        remoteUrl: input.remoteUrl,
      })
    },
  }),
}))
