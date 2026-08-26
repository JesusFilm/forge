import { builder } from "@/graphql/builder"
import { verifySubtitleReviewAssertion } from "@/auth/subtitle-review-assertion"
import {
  subtitleEvalDelegationBodyDigest,
  type VerifiedSubtitleEvalDelegation,
  verifySubtitleEvalDelegation,
} from "@/auth/subtitle-eval-delegation-assertion"
import { z } from "zod"

type CorpusVersion = NonNullable<
  Awaited<
    ReturnType<
      import("@/services/subtitle-eval.service").SubtitleEvalService["getCorpusVersion"]
    >
  >
>
type CorpusCell = CorpusVersion["cells"][number]
type RunDetail = NonNullable<
  Awaited<
    ReturnType<
      import("@/services/subtitle-eval.service").SubtitleEvalService["getRun"]
    >
  >
>
type RunCell = RunDetail["cells"][number]
type TerminalReport = NonNullable<RunDetail["terminalReport"]>
type SubtitleEvalService =
  import("@/services/subtitle-eval.service").SubtitleEvalService

const ProviderCallUsage = z
  .object({
    promptTokens: z.number().int().nonnegative(),
    completionTokens: z.number().int().nonnegative(),
    totalTokens: z.number().int().nonnegative(),
  })
  .strict()
  .nullable()

function normalizeProviderCalls<
  T extends {
    chunkIndex?: number | null
    providerRequestId?: string | null
    providerResponseId?: string | null
    resolvedModel?: string | null
    usage?: unknown
  },
>(calls: readonly T[]) {
  return calls.map((call) => ({
    ...call,
    chunkIndex: call.chunkIndex ?? null,
    providerRequestId: call.providerRequestId ?? null,
    providerResponseId: call.providerResponseId ?? null,
    resolvedModel: call.resolvedModel ?? null,
    usage: ProviderCallUsage.parse(call.usage ?? null),
  }))
}

async function consumeDelegation(
  service: Pick<SubtitleEvalService, "consumeDelegation">,
  token: string,
  operation: VerifiedSubtitleEvalDelegation["operation"],
  payload: unknown,
  method: string,
) {
  const assertion = await verifySubtitleEvalDelegation(token)
  await service.consumeDelegation({
    assertion,
    operation,
    method,
    bodyDigest: subtitleEvalDelegationBodyDigest(payload),
  })
  return assertion
}

const CorpusCellRef = builder
  .objectRef<CorpusCell>("ManagerSubtitleEvalCorpusCell")
  .implement({
    authScopes: { role: "MANAGER_BACKEND" },
    fields: (t) => ({
      id: t.exposeID("id"),
      caseId: t.exposeString("caseId"),
      collectionKey: t.exposeString("collectionKey"),
      videoId: t.exposeString("videoId"),
      clipStartSeconds: t.exposeFloat("clipStartSeconds", { nullable: true }),
      clipEndSeconds: t.exposeFloat("clipEndSeconds", { nullable: true }),
      editionIdentity: t.exposeString("editionIdentity"),
      sourceLanguageId: t.exposeID("sourceLanguageId"),
      sourceLanguageSlug: t.exposeString("sourceLanguageSlug"),
      sourceTrackIdentity: t.exposeString("sourceTrackIdentity"),
      targetLanguageId: t.exposeID("targetLanguageId"),
      targetLanguageSlug: t.exposeString("targetLanguageSlug"),
      referenceTrackIdentity: t.exposeString("referenceTrackIdentity"),
      sourceSnapshotDigest: t.string({
        resolve: (row) => row.sourceSnapshot.sha256,
      }),
      sourceSnapshotRawDigest: t.string({
        resolve: (row) => row.sourceSnapshot.rawSha256,
      }),
      sourceSnapshotClippedDigest: t.string({
        nullable: true,
        resolve: (row) => row.sourceSnapshot.clippedSha256,
      }),
      referenceSnapshotDigest: t.string({
        resolve: (row) => row.referenceSnapshot.sha256,
      }),
      referenceSnapshotRawDigest: t.string({
        resolve: (row) => row.referenceSnapshot.rawSha256,
      }),
      referenceSnapshotClippedDigest: t.string({
        nullable: true,
        resolve: (row) => row.referenceSnapshot.clippedSha256,
      }),
      metadata: t.field({ type: "JSON", resolve: (row) => row.metadata }),
    }),
  })

const CorpusVersionRef = builder
  .objectRef<CorpusVersion>("ManagerSubtitleEvalCorpusVersion")
  .implement({
    authScopes: { hasPermission: "read:manager-subtitle-eval" },
    fields: (t) => ({
      id: t.exposeID("id"),
      status: t.exposeString("status"),
      identityDigest: t.exposeString("identityDigest"),
      manifestDigest: t.exposeString("manifestDigest"),
      lockDigest: t.exposeString("lockDigest"),
      authority: t.exposeString("authority"),
      certification: t.field({
        type: "JSON",
        resolve: (row) => row.certification,
      }),
      supersedesVersionId: t.exposeID("supersedesVersionId", {
        nullable: true,
      }),
      approvedById: t.exposeID("approvedById", { nullable: true }),
      approvedAt: t.string({
        nullable: true,
        resolve: (row) => row.approvedAt?.toISOString() ?? null,
      }),
      cells: t.field({ type: [CorpusCellRef], resolve: (row) => row.cells }),
      createdAt: t.string({ resolve: (row) => row.createdAt.toISOString() }),
    }),
  })

const TerminalReportRef = builder
  .objectRef<TerminalReport>("ManagerSubtitleEvalTerminalReport")
  .implement({
    authScopes: { hasPermission: "read:manager-subtitle-eval" },
    fields: (t) => ({
      id: t.exposeID("id"),
      status: t.exposeString("status"),
      reportDigest: t.exposeString("reportDigest"),
      reportArtifactDigest: t.exposeString("reportArtifactDigest", {
        nullable: true,
      }),
      corpusIdentityDigest: t.exposeString("corpusIdentityDigest"),
      sourceReferenceDigests: t.field({
        type: "JSON",
        resolve: (row) => row.sourceReferenceDigests,
      }),
      providerIdentities: t.field({
        type: "JSON",
        resolve: (row) => row.providerIdentities,
      }),
      runtimeIdentity: t.field({
        type: "JSON",
        resolve: (row) => row.runtimeIdentity,
      }),
      usage: t.field({ type: "JSON", resolve: (row) => row.usage }),
      languageMetrics: t.field({
        type: "JSON",
        resolve: (row) => row.languageMetrics,
      }),
      collectionMetrics: t.field({
        type: "JSON",
        resolve: (row) => row.collectionMetrics,
      }),
      artifactInventory: t.field({
        type: "JSON",
        resolve: (row) => row.artifactInventory,
      }),
      reproducibilityLimits: t.field({
        type: ["String"],
        resolve: (row) => row.reproducibilityLimits,
      }),
      partialFailures: t.field({
        type: "JSON",
        resolve: (row) => row.partialFailures,
      }),
      completedAt: t.string({
        resolve: (row) => row.completedAt.toISOString(),
      }),
    }),
  })

const RunCellRef = builder
  .objectRef<RunCell>("ManagerSubtitleEvalRunCell")
  .implement({
    authScopes: { hasPermission: "read:manager-subtitle-eval" },
    fields: (t) => ({
      id: t.exposeID("id"),
      status: t.exposeString("status"),
      attemptCount: t.exposeInt("attemptCount"),
      leaseGeneration: t.exposeInt("leaseGeneration"),
      errorCode: t.exposeString("errorCode", { nullable: true }),
      errorRetryable: t.exposeBoolean("errorRetryable", { nullable: true }),
      resultDigest: t.exposeString("resultDigest", { nullable: true }),
      caseId: t.string({ resolve: (row) => row.corpusCell.caseId }),
      collectionKey: t.string({
        resolve: (row) => row.corpusCell.collectionKey,
      }),
      videoId: t.string({ resolve: (row) => row.corpusCell.videoId }),
      targetLanguageId: t.id({
        resolve: (row) => row.corpusCell.targetLanguageId,
      }),
      targetLanguageSlug: t.string({
        resolve: (row) => row.corpusCell.targetLanguageSlug,
      }),
      machineMetrics: t.field({
        type: "JSON",
        nullable: true,
        resolve: (row) => row.machineAssessment?.metrics ?? null,
      }),
      providerRequestId: t.string({
        nullable: true,
        resolve: (row) => row.machineAssessment?.providerRequestId ?? null,
      }),
      providerResponseId: t.string({
        nullable: true,
        resolve: (row) => row.machineAssessment?.providerResponseId ?? null,
      }),
      assessmentDigest: t.string({
        nullable: true,
        resolve: (row) => row.machineAssessment?.assessmentDigest ?? null,
      }),
      resolvedModel: t.string({
        nullable: true,
        resolve: (row) => row.machineAssessment?.resolvedModel ?? null,
      }),
      reproducibilityLimits: t.field({
        type: ["String"],
        resolve: (row) => row.machineAssessment?.reproducibilityLimits ?? [],
      }),
      artifactDigests: t.field({
        type: ["String"],
        resolve: (row) => row.artifacts.map((artifact) => artifact.sha256),
      }),
      assignmentCount: t.int({ resolve: (row) => row.assignments.length }),
    }),
  })

const RunDetailRef = builder
  .objectRef<RunDetail>("ManagerSubtitleEvalRun")
  .implement({
    authScopes: { hasPermission: "read:manager-subtitle-eval" },
    fields: (t) => ({
      id: t.exposeID("id"),
      status: t.exposeString("status"),
      corpusVersionId: t.exposeID("corpusVersionId"),
      requestedProvider: t.exposeString("requestedProvider"),
      requestedModel: t.exposeString("requestedModel"),
      promptPolicyId: t.exposeString("promptPolicyId"),
      workflowPolicyDigest: t.exposeString("workflowPolicyDigest"),
      codeRevision: t.exposeString("codeRevision"),
      concurrency: t.exposeInt("concurrency"),
      timeoutSeconds: t.exposeInt("timeoutSeconds"),
      maxAttempts: t.exposeInt("maxAttempts"),
      estimatedSpendMicros: t.string({
        resolve: (row) => row.estimatedSpendMicros.toString(),
      }),
      cells: t.field({ type: [RunCellRef], resolve: (row) => row.cells }),
      terminalReport: t.field({
        type: TerminalReportRef,
        nullable: true,
        resolve: (row) => row.terminalReport,
      }),
      createdAt: t.string({ resolve: (row) => row.createdAt.toISOString() }),
      terminalAt: t.string({
        nullable: true,
        resolve: (row) => row.terminalAt?.toISOString() ?? null,
      }),
    }),
  })

type RunSummary = Awaited<
  ReturnType<
    import("@/services/subtitle-eval.service").SubtitleEvalService["listRuns"]
  >
>["nodes"][number]
type RunPage = Awaited<
  ReturnType<
    import("@/services/subtitle-eval.service").SubtitleEvalService["listRuns"]
  >
>
type ReviewerAssignmentPage = Awaited<
  ReturnType<
    import("@/services/subtitle-eval.service").SubtitleEvalService["listReviewerAssignments"]
  >
>
type ReviewerAssignmentSummary = ReviewerAssignmentPage["nodes"][number]
type ReviewerAssignmentDetail = Awaited<
  ReturnType<
    import("@/services/subtitle-eval.service").SubtitleEvalService["getReviewerAssignment"]
  >
>
type OperatorReviewerCandidatePage = Awaited<
  ReturnType<
    import("@/services/subtitle-eval.service").SubtitleEvalService["listOperatorReviewerCandidates"]
  >
>
type OperatorReviewerCandidate = OperatorReviewerCandidatePage["nodes"][number]
type OperatorAssignmentPage = Awaited<
  ReturnType<
    import("@/services/subtitle-eval.service").SubtitleEvalService["listOperatorAssignments"]
  >
>
type OperatorAssignmentSummary = OperatorAssignmentPage["nodes"][number]
type OperatorAssignmentDetail = NonNullable<
  Awaited<
    ReturnType<
      import("@/services/subtitle-eval.service").SubtitleEvalService["getOperatorAssignment"]
    >
  >
>
type VideoContext = NonNullable<
  Awaited<
    ReturnType<
      import("@/services/subtitle-eval.service").SubtitleEvalService["getVideoContext"]
    >
  >
>

const RunSummaryRef = builder
  .objectRef<RunSummary>("ManagerSubtitleEvalRunSummary")
  .implement({
    description: "Bounded scalar projection for one subtitle evaluation run.",
    authScopes: { hasPermission: "read:manager-subtitle-eval" },
    fields: (t) => ({
      id: t.exposeID("id"),
      status: t.exposeString("status"),
      requestedProvider: t.exposeString("requestedProvider"),
      requestedModel: t.exposeString("requestedModel"),
      promptPolicyId: t.exposeString("promptPolicyId"),
      codeRevision: t.exposeString("codeRevision"),
      cellCount: t.int({ resolve: (row) => row._count.cells }),
      createdAt: t.string({ resolve: (row) => row.createdAt.toISOString() }),
      terminalAt: t.string({
        nullable: true,
        resolve: (row) => row.terminalAt?.toISOString() ?? null,
      }),
    }),
  })

const RunPageRef = builder
  .objectRef<RunPage>("ManagerSubtitleEvalRunPage")
  .implement({
    authScopes: { hasPermission: "read:manager-subtitle-eval" },
    fields: (t) => ({
      nodes: t.field({ type: [RunSummaryRef], resolve: (row) => row.nodes }),
      nextCursor: t.exposeString("nextCursor", { nullable: true }),
    }),
  })

const ReviewerAssignmentSummaryRef = builder
  .objectRef<ReviewerAssignmentSummary>(
    "ManagerSubtitleEvalReviewerAssignmentSummary",
  )
  .implement({
    authScopes: { hasPermission: "read:manager-subtitle-eval" },
    fields: (t) => ({
      id: t.exposeID("id"),
      status: t.exposeString("status"),
      kind: t.exposeString("kind"),
      round: t.exposeInt("round"),
      targetLanguageId: t.exposeID("targetLanguageId"),
      targetLanguageSlug: t.exposeString("targetLanguageSlug"),
      caseId: t.string({ resolve: (row) => row.runCell.corpusCell.caseId }),
      collectionKey: t.string({
        resolve: (row) => row.runCell.corpusCell.collectionKey,
      }),
      videoId: t.string({ resolve: (row) => row.runCell.corpusCell.videoId }),
      assignedAt: t.string({ resolve: (row) => row.assignedAt.toISOString() }),
      submittedAt: t.string({
        nullable: true,
        resolve: (row) => row.submittedAt?.toISOString() ?? null,
      }),
    }),
  })

const ReviewerAssignmentPageRef = builder
  .objectRef<ReviewerAssignmentPage>(
    "ManagerSubtitleEvalReviewerAssignmentPage",
  )
  .implement({
    authScopes: { hasPermission: "read:manager-subtitle-eval" },
    fields: (t) => ({
      nodes: t.field({
        type: [ReviewerAssignmentSummaryRef],
        resolve: (row) => row.nodes,
      }),
      nextCursor: t.exposeString("nextCursor", { nullable: true }),
    }),
  })

const OperatorReviewerCandidateRef = builder
  .objectRef<OperatorReviewerCandidate>(
    "ManagerSubtitleEvalOperatorReviewerCandidate",
  )
  .implement({
    authScopes: { hasPermission: "read:manager-subtitle-eval" },
    fields: (t) => ({
      membershipId: t.exposeID("membershipId"),
      displayName: t.exposeString("displayName"),
      email: t.exposeString("email"),
      targetLanguageId: t.exposeID("targetLanguageId"),
      targetLanguageSlug: t.exposeString("targetLanguageSlug"),
      qualificationVersion: t.exposeInt("qualificationVersion"),
      rubricDimensions: t.field({
        type: ["String"],
        resolve: (row) => row.rubricDimensions,
      }),
      specialistCapabilities: t.field({
        type: ["String"],
        resolve: (row) => row.specialistCapabilities,
      }),
      activeAssignmentCount: t.exposeInt("activeAssignmentCount"),
    }),
  })
const OperatorReviewerCandidatePageRef = builder
  .objectRef<OperatorReviewerCandidatePage>(
    "ManagerSubtitleEvalOperatorReviewerCandidatePage",
  )
  .implement({
    authScopes: { hasPermission: "read:manager-subtitle-eval" },
    fields: (t) => ({
      nodes: t.field({
        type: [OperatorReviewerCandidateRef],
        resolve: (row) => row.nodes,
      }),
      nextCursor: t.exposeString("nextCursor", { nullable: true }),
    }),
  })

const OperatorAssignmentSummaryRef = builder
  .objectRef<OperatorAssignmentSummary>(
    "ManagerSubtitleEvalOperatorAssignmentSummary",
  )
  .implement({
    authScopes: { hasPermission: "read:manager-subtitle-eval" },
    fields: (t) => ({
      id: t.exposeID("id"),
      runCellId: t.exposeID("runCellId"),
      status: t.exposeString("status"),
      kind: t.exposeString("kind"),
      round: t.exposeInt("round"),
      specialistDimension: t.exposeString("specialistDimension", {
        nullable: true,
      }),
      reviewerMembershipId: t.exposeID("reviewerMembershipId", {
        nullable: true,
      }),
      reviewerDisplayName: t.exposeString("reviewerDisplayName", {
        nullable: true,
      }),
      reviewerEmail: t.exposeString("reviewerEmail", { nullable: true }),
      assignedAt: t.string({ resolve: (row) => row.assignedAt.toISOString() }),
      submittedAt: t.string({
        nullable: true,
        resolve: (row) => row.submittedAt?.toISOString() ?? null,
      }),
      latestVerdict: t.exposeString("latestVerdict", { nullable: true }),
    }),
  })
const OperatorAssignmentPageRef = builder
  .objectRef<OperatorAssignmentPage>(
    "ManagerSubtitleEvalOperatorAssignmentPage",
  )
  .implement({
    authScopes: { hasPermission: "read:manager-subtitle-eval" },
    fields: (t) => ({
      nodes: t.field({
        type: [OperatorAssignmentSummaryRef],
        resolve: (row) => row.nodes,
      }),
      nextCursor: t.exposeString("nextCursor", { nullable: true }),
    }),
  })

const VideoContextRef = builder
  .objectRef<VideoContext>("ManagerSubtitleEvalVideoContext")
  .implement({
    description:
      "Manager-BFF-only playback candidate for one frozen corpus video edition. The BFF must recheck Mux public policy by asset id.",
    authScopes: { role: "MANAGER_BACKEND" },
    fields: (t) => ({
      muxAssetId: t.exposeString("muxAssetId", { nullable: false }),
      playbackId: t.exposeString("playbackId", { nullable: false }),
      durationSeconds: t.exposeFloat("durationSeconds", { nullable: true }),
    }),
  })

type ReviewerTrack = {
  label: string
  contentId: string
  mediaType: string
}
const ReviewerTrackRef = builder
  .objectRef<ReviewerTrack>("ManagerSubtitleEvalReviewerTrack")
  .implement({
    description:
      "Neutral assignment-scoped subtitle identity. Directional provenance and storage keys are intentionally omitted.",
    authScopes: { hasPermission: "read:manager-subtitle-eval" },
    fields: (t) => ({
      label: t.exposeString("label"),
      contentId: t.exposeID("contentId"),
      mediaType: t.exposeString("mediaType"),
    }),
  })

type PostSubmitReceipt = NonNullable<
  ReviewerAssignmentDetail["postSubmitReceipt"]
>
const PostSubmitReceiptRef = builder
  .objectRef<PostSubmitReceipt>("ManagerSubtitleEvalPostSubmitReceipt")
  .implement({
    description:
      "Provenance unlocked by stored human evidence. Machine fields remain advisory and separate from the human verdict.",
    authScopes: { hasPermission: "read:manager-subtitle-eval" },
    fields: (t) => ({
      reviewId: t.exposeID("reviewId", { nullable: false }),
      submittedAt: t.string({
        nullable: false,
        resolve: (row) => row.submittedAt.toISOString(),
      }),
      referenceTrackLabel: t.exposeString("referenceTrackLabel", {
        nullable: false,
      }),
      candidateTrackLabel: t.exposeString("candidateTrackLabel", {
        nullable: false,
      }),
      machineAdvisoryRiskFlags: t.field({
        type: ["String"],
        nullable: false,
        resolve: (row) => row.machineAdvisoryRiskFlags,
      }),
      resolvedModel: t.exposeString("resolvedModel", { nullable: true }),
      assessmentDigest: t.exposeString("assessmentDigest", {
        nullable: false,
      }),
    }),
  })

const ReviewerAssignmentDetailRef = builder
  .objectRef<ReviewerAssignmentDetail>("ManagerSubtitleEvalReviewerAssignment")
  .implement({
    authScopes: { hasPermission: "read:manager-subtitle-eval" },
    fields: (t) => ({
      id: t.exposeID("id"),
      status: t.exposeString("status"),
      kind: t.exposeString("kind"),
      round: t.exposeInt("round"),
      targetLanguageId: t.exposeID("targetLanguageId"),
      targetLanguageSlug: t.exposeString("targetLanguageSlug"),
      caseId: t.exposeString("caseId"),
      collectionKey: t.exposeString("collectionKey"),
      videoId: t.exposeString("videoId"),
      editionIdentity: t.exposeString("editionIdentity", { nullable: false }),
      clipStartSeconds: t.exposeFloat("clipStartSeconds", { nullable: true }),
      clipEndSeconds: t.exposeFloat("clipEndSeconds", { nullable: true }),
      sourceTrack: t.field({
        type: ReviewerTrackRef,
        resolve: (row) => row.sourceTrack,
      }),
      trackA: t.field({ type: ReviewerTrackRef, resolve: (row) => row.trackA }),
      trackB: t.field({ type: ReviewerTrackRef, resolve: (row) => row.trackB }),
      submitted: t.exposeBoolean("submitted"),
      postSubmitReceipt: t.field({
        type: PostSubmitReceiptRef,
        nullable: true,
        resolve: (row) => row.postSubmitReceipt,
      }),
    }),
  })

const OperatorAssignmentDetailRef = builder
  .objectRef<OperatorAssignmentDetail>("ManagerSubtitleEvalOperatorAssignment")
  .implement({
    description:
      "Read-only operator evidence with named provenance, bounded human verdicts, notes, and suggested corrections.",
    authScopes: { hasPermission: "read:manager-subtitle-eval" },
    fields: (t) => ({
      id: t.exposeID("id"),
      status: t.exposeString("status"),
      kind: t.exposeString("kind"),
      round: t.exposeInt("round"),
      specialistDimension: t.exposeString("specialistDimension", {
        nullable: true,
      }),
      targetLanguageId: t.exposeID("targetLanguageId"),
      targetLanguageSlug: t.exposeString("targetLanguageSlug"),
      reviewerMembershipId: t.exposeID("reviewerMembershipId", {
        nullable: true,
      }),
      reviewerDisplayName: t.exposeString("reviewerDisplayName", {
        nullable: true,
      }),
      reviewerEmail: t.exposeString("reviewerEmail", { nullable: true }),
      caseId: t.exposeString("caseId"),
      collectionKey: t.exposeString("collectionKey"),
      videoId: t.exposeString("videoId"),
      editionIdentity: t.exposeString("editionIdentity"),
      clipStartSeconds: t.exposeFloat("clipStartSeconds", { nullable: true }),
      clipEndSeconds: t.exposeFloat("clipEndSeconds", { nullable: true }),
      sourceTrack: t.field({
        type: ReviewerTrackRef,
        resolve: (row) => row.sourceTrack,
      }),
      referenceTrack: t.field({
        type: ReviewerTrackRef,
        resolve: (row) => row.referenceTrack,
      }),
      candidateTrack: t.field({
        type: ReviewerTrackRef,
        resolve: (row) => row.candidateTrack,
      }),
      referenceTrackLabel: t.exposeString("referenceTrackLabel"),
      candidateTrackLabel: t.exposeString("candidateTrackLabel"),
      machineAssessment: t.field({
        type: "JSON",
        nullable: true,
        resolve: (row) => row.machineAssessment,
      }),
      reviews: t.field({ type: "JSON", resolve: (row) => row.reviews }),
    }),
  })

type OperationResult = {
  id: string
  status?: string | null
  digest?: string | null
  replayed: boolean
}
const OperationResultRef = builder
  .objectRef<OperationResult>("ManagerSubtitleEvalOperationResult")
  .implement({
    authScopes: { hasPermission: "write:manager-subtitle-eval" },
    fields: (t) => ({
      id: t.exposeID("id"),
      status: t.exposeString("status", { nullable: true }),
      digest: t.exposeString("digest", { nullable: true }),
      replayed: t.exposeBoolean("replayed"),
    }),
  })

type ComparisonDetail = NonNullable<
  Awaited<
    ReturnType<
      import("@/services/subtitle-eval.service").SubtitleEvalService["getComparison"]
    >
  >
>
type Narrative = ComparisonDetail["narratives"][number]
const NarrativeRef = builder
  .objectRef<Narrative>("ManagerSubtitleEvalNarrative")
  .implement({
    authScopes: { hasPermission: "read:manager-subtitle-eval" },
    fields: (t) => ({
      id: t.exposeID("id"),
      version: t.exposeInt("version"),
      hypothesis: t.exposeString("hypothesis"),
      conclusion: t.exposeString("conclusion", { nullable: true }),
      rationale: t.exposeString("rationale", { nullable: true }),
      followUpAction: t.exposeString("followUpAction", { nullable: true }),
      createdById: t.exposeID("createdById"),
      createdAt: t.string({ resolve: (row) => row.createdAt.toISOString() }),
    }),
  })
const ComparisonRef = builder
  .objectRef<ComparisonDetail>("ManagerSubtitleEvalComparison")
  .implement({
    authScopes: { hasPermission: "read:manager-subtitle-eval" },
    fields: (t) => ({
      id: t.exposeID("id"),
      baselineReportId: t.exposeID("baselineReportId"),
      candidateReportId: t.exposeID("candidateReportId"),
      changedAxis: t.exposeString("changedAxis"),
      identityDifferences: t.field({
        type: "JSON",
        resolve: (row) => row.identityDifferences,
      }),
      descriptiveDeltas: t.field({
        type: "JSON",
        resolve: (row) => row.descriptiveDeltas,
      }),
      humanEvidence: t.field({
        type: "JSON",
        description:
          "Live latest non-superseded human review evidence, kept distinct from frozen machine metrics.",
        resolve: (row) => row.humanEvidence,
      }),
      unmatchedCells: t.field({
        type: "JSON",
        resolve: (row) => row.unmatchedCells,
      }),
      matchedCellCount: t.exposeInt("matchedCellCount"),
      matchedCollectionCount: t.exposeInt("matchedCollectionCount"),
      coverageLabel: t.exposeString("coverageLabel"),
      narratives: t.field({
        type: [NarrativeRef],
        resolve: (row) => row.narratives,
      }),
    }),
  })

type ReferenceIssuePage = Awaited<
  ReturnType<
    import("@/services/subtitle-eval.service").SubtitleEvalService["listReferenceIssues"]
  >
>
type ReferenceIssue = ReferenceIssuePage["nodes"][number]
const ReferenceIssueRef = builder
  .objectRef<ReferenceIssue>("ManagerSubtitleEvalReferenceIssue")
  .implement({
    authScopes: { hasPermission: "read:manager-subtitle-eval" },
    fields: (t) => ({
      id: t.exposeID("id"),
      status: t.exposeString("status"),
      reviewId: t.exposeID("reviewId"),
      corpusCellId: t.exposeID("corpusCellId"),
      caseId: t.string({ resolve: (row) => row.corpusCell.caseId }),
      collectionKey: t.string({
        resolve: (row) => row.corpusCell.collectionKey,
      }),
      targetLanguageId: t.id({
        resolve: (row) => row.corpusCell.targetLanguageId,
      }),
      targetLanguageSlug: t.string({
        resolve: (row) => row.corpusCell.targetLanguageSlug,
      }),
      dispositionReason: t.exposeString("dispositionReason", {
        nullable: true,
      }),
      correctedCorpusVersionId: t.exposeID("correctedCorpusVersionId", {
        nullable: true,
      }),
      createdAt: t.string({ resolve: (row) => row.createdAt.toISOString() }),
    }),
  })
const ReferenceIssuePageRef = builder
  .objectRef<ReferenceIssuePage>("ManagerSubtitleEvalReferenceIssuePage")
  .implement({
    authScopes: { hasPermission: "read:manager-subtitle-eval" },
    fields: (t) => ({
      nodes: t.field({
        type: [ReferenceIssueRef],
        resolve: (row) => row.nodes,
      }),
      nextCursor: t.exposeString("nextCursor", { nullable: true }),
    }),
  })

type StaleRunPage = Awaited<
  ReturnType<
    import("@/services/subtitle-eval.service").SubtitleEvalService["listStaleRuns"]
  >
>
type StaleRun = StaleRunPage["nodes"][number]
const StaleRunRef = builder
  .objectRef<StaleRun>("ManagerSubtitleEvalStaleRun")
  .implement({
    authScopes: { hasPermission: "read:manager-subtitle-eval" },
    fields: (t) => ({
      id: t.exposeID("id"),
      status: t.exposeString("status"),
      leaseGeneration: t.exposeInt("leaseGeneration"),
      leaseExpiresAt: t.string({
        nullable: true,
        resolve: (row) => row.leaseExpiresAt?.toISOString() ?? null,
      }),
      cellCount: t.int({ resolve: (row) => row._count.cells }),
      updatedAt: t.string({ resolve: (row) => row.updatedAt.toISOString() }),
    }),
  })
const StaleRunPageRef = builder
  .objectRef<StaleRunPage>("ManagerSubtitleEvalStaleRunPage")
  .implement({
    authScopes: { hasPermission: "read:manager-subtitle-eval" },
    fields: (t) => ({
      nodes: t.field({ type: [StaleRunRef], resolve: (row) => row.nodes }),
      nextCursor: t.exposeString("nextCursor", { nullable: true }),
    }),
  })

const ArtifactKindEnum = builder.enumType("ManagerSubtitleEvalArtifactKind", {
  values: {
    CANDIDATE_VTT: { value: "CANDIDATE_VTT" },
    REVIEW_EVIDENCE: { value: "REVIEW_EVIDENCE" },
    CELL_REPORT: { value: "CELL_REPORT" },
  } as const,
})
const AssignmentKindEnum = builder.enumType(
  "ManagerSubtitleEvalAssignmentKind",
  {
    values: {
      STANDARD: { value: "STANDARD" },
      SPECIALIST: { value: "SPECIALIST" },
    } as const,
  },
)
const RunTerminalStatusEnum = builder.enumType(
  "ManagerSubtitleEvalTerminalStatus",
  {
    values: {
      COMPLETED: { value: "COMPLETED" },
      PARTIAL: { value: "PARTIAL" },
      FAILED: { value: "FAILED" },
    } as const,
  },
)
const ReviewVerdictEnum = builder.enumType("ManagerSubtitleEvalReviewVerdict", {
  values: {
    PASS: { value: "PASS" },
    NEEDS_CHANGES: { value: "NEEDS_CHANGES" },
    REFERENCE_QUESTIONABLE: { value: "REFERENCE_QUESTIONABLE" },
    SPECIALIST_REVIEW: { value: "SPECIALIST_REVIEW" },
  } as const,
})
const BlindTrackEnum = builder.enumType("ManagerSubtitleEvalBlindTrack", {
  values: { A: { value: "A" }, B: { value: "B" } } as const,
})
const IssueCodeEnum = builder.enumType("ManagerSubtitleEvalIssueCode", {
  values: {
    MISTRANSLATION: { value: "MISTRANSLATION" },
    OMISSION: { value: "OMISSION" },
    ADDITION: { value: "ADDITION" },
    TERMINOLOGY: { value: "TERMINOLOGY" },
    GRAMMAR: { value: "GRAMMAR" },
    NATURALNESS: { value: "NATURALNESS" },
    TONE_REGISTER: { value: "TONE_REGISTER" },
    TIMING: { value: "TIMING" },
    LINE_BREAK: { value: "LINE_BREAK" },
    READING_SPEED: { value: "READING_SPEED" },
    SCRIPTURE: { value: "SCRIPTURE" },
    THEOLOGY: { value: "THEOLOGY" },
    REFERENCE_ERROR: { value: "REFERENCE_ERROR" },
    OTHER: { value: "OTHER" },
  } as const,
})
const ChangedAxisEnum = builder.enumType("ManagerSubtitleEvalChangedAxis", {
  values: {
    MODEL: { value: "MODEL" },
    PROMPT_POLICY: { value: "PROMPT_POLICY" },
    WORKFLOW_POLICY: { value: "WORKFLOW_POLICY" },
    CODE_REVISION: { value: "CODE_REVISION" },
    RUNTIME: { value: "RUNTIME" },
  } as const,
})
const ProviderOperationEnum = builder.enumType(
  "ManagerSubtitleEvalProviderOperation",
  {
    values: {
      SCRIPTURE_DETECTION: { value: "SCRIPTURE_DETECTION" },
      TRANSLATION: { value: "TRANSLATION" },
      RETIMING: { value: "RETIMING" },
      SCRIPTURE_VALIDATION: { value: "SCRIPTURE_VALIDATION" },
    } as const,
  },
)
const ProviderCallStatusEnum = builder.enumType(
  "ManagerSubtitleEvalProviderCallStatus",
  {
    values: {
      SUCCEEDED: { value: "SUCCEEDED" },
      FAILED: { value: "FAILED" },
      INVALID_OUTPUT: { value: "INVALID_OUTPUT" },
    } as const,
  },
)

const CorpusSnapshotInput = builder.inputType(
  "ManagerSubtitleEvalCorpusSnapshotInput",
  {
    fields: (t) => ({
      sha256: t.string({ required: true }),
      rawSha256: t.string({ required: true }),
      clippedSha256: t.string({ required: false }),
      objectKey: t.string({ required: true }),
      byteLength: t.string({ required: true }),
    }),
  },
)
const CorpusCellInput = builder.inputType(
  "ManagerSubtitleEvalCorpusCellInput",
  {
    fields: (t) => ({
      caseId: t.id({ required: true }),
      collectionKey: t.string({ required: true }),
      videoId: t.id({ required: true }),
      editionIdentity: t.string({ required: true }),
      sourceLanguageId: t.id({ required: true }),
      sourceLanguageSlug: t.string({ required: true }),
      sourceTrackIdentity: t.string({ required: true }),
      targetLanguageId: t.id({ required: true }),
      targetLanguageSlug: t.string({ required: true }),
      referenceTrackIdentity: t.string({ required: true }),
      sourceSnapshot: t.field({ type: CorpusSnapshotInput, required: true }),
      referenceSnapshot: t.field({ type: CorpusSnapshotInput, required: true }),
      metadata: t.field({ type: "JSON", required: false }),
    }),
  },
)
const ImportCorpusInput = builder.inputType(
  "ManagerSubtitleEvalImportCorpusInput",
  {
    fields: (t) => ({
      assertion: t.string({ required: true }),
      manifestDigest: t.string({ required: true }),
      lockDigest: t.string({ required: true }),
      authority: t.string({ required: true }),
      certification: t.field({ type: "JSON", required: false }),
      supersedesVersionId: t.id({ required: false }),
      cells: t.field({ type: [CorpusCellInput], required: true }),
    }),
  },
)
const ApproveCorpusInput = builder.inputType(
  "ManagerSubtitleEvalApproveCorpusInput",
  {
    fields: (t) => ({
      assertion: t.string({ required: true }),
      corpusVersionId: t.id({ required: true }),
      certification: t.field({ type: "JSON", required: true }),
      reason: t.string({ required: true }),
    }),
  },
)
const CreateRunInput = builder.inputType("ManagerSubtitleEvalCreateRunInput", {
  fields: (t) => ({
    assertion: t.string({ required: true }),
    idempotencyKey: t.string({ required: true }),
    corpusVersionId: t.id({ required: true }),
    corpusCellIds: t.idList({ required: true }),
    requestedProvider: t.string({ required: true }),
    requestedModel: t.string({ required: true }),
    promptPolicyId: t.string({ required: true }),
    workflowPolicyDigest: t.string({ required: true }),
    codeRevision: t.string({ required: true }),
    determinism: t.field({ type: "JSON", required: false }),
    concurrency: t.int({ required: true }),
    timeoutSeconds: t.int({ required: true }),
    maxAttempts: t.int({ required: true }),
  }),
})

const ArtifactInput = builder.inputType("ManagerSubtitleEvalArtifactInput", {
  fields: (t) => ({
    kind: t.field({ type: ArtifactKindEnum, required: true }),
    sha256: t.string({ required: true }),
    objectKey: t.string({ required: true }),
    byteLength: t.string({ required: true }),
    mediaType: t.string({ required: true }),
  }),
})
const MachineAssessmentInput = builder.inputType(
  "ManagerSubtitleEvalMachineAssessmentInput",
  {
    fields: (t) => ({
      schemaVersion: t.int({ required: true }),
      metrics: t.field({ type: "JSON", required: true }),
      advisoryRiskFlags: t.stringList({ required: false }),
      usage: t.field({ type: "JSON", required: false }),
      reproducibilityLimits: t.stringList({ required: true }),
      providerRequestId: t.string({ required: false }),
      providerResponseId: t.string({ required: false }),
      resolvedModel: t.string({ required: false }),
      assessmentDigest: t.string({ required: true }),
    }),
  },
)
const ProviderCallInput = builder.inputType(
  "ManagerSubtitleEvalProviderCallInput",
  {
    fields: (t) => ({
      callSequence: t.int({ required: true }),
      operation: t.field({ type: ProviderOperationEnum, required: true }),
      chunkIndex: t.int({ required: false }),
      operationAttempt: t.int({ required: true }),
      status: t.field({ type: ProviderCallStatusEnum, required: true }),
      requestDigest: t.string({ required: true }),
      providerRequestId: t.string({ required: false }),
      providerResponseId: t.string({ required: false }),
      requestedModel: t.string({ required: true }),
      resolvedModel: t.string({ required: false }),
      usage: t.field({ type: "JSON", required: false }),
    }),
  },
)
const FinalizeCellInput = builder.inputType(
  "ManagerSubtitleEvalFinalizeCellInput",
  {
    fields: (t) => ({
      runCellId: t.id({ required: true }),
      leaseGeneration: t.int({ required: true }),
      leaseToken: t.string({ required: true }),
      resultDigest: t.string({ required: true }),
      artifacts: t.field({ type: [ArtifactInput], required: true }),
      providerCalls: t.field({ type: [ProviderCallInput], required: true }),
      machineAssessment: t.field({
        type: MachineAssessmentInput,
        required: true,
      }),
    }),
  },
)
const FailCellInput = builder.inputType("ManagerSubtitleEvalFailCellInput", {
  fields: (t) => ({
    runCellId: t.id({ required: true }),
    leaseGeneration: t.int({ required: true }),
    leaseToken: t.string({ required: true }),
    errorCode: t.string({ required: true }),
    retryable: t.boolean({ required: true }),
    providerCalls: t.field({ type: [ProviderCallInput], required: true }),
  }),
})
const FinalizeRunInput = builder.inputType(
  "ManagerSubtitleEvalFinalizeRunInput",
  {
    fields: (t) => ({
      runId: t.id({ required: true }),
      expectedStatus: t.field({ type: RunTerminalStatusEnum, required: true }),
      expectedCorpusIdentityDigest: t.string({ required: true }),
      expectedSourceReferenceDigest: t.string({ required: true }),
      reproducibilityLimits: t.stringList({ required: false }),
    }),
  },
)
const CreateAssignmentInput = builder.inputType(
  "ManagerSubtitleEvalCreateAssignmentInput",
  {
    fields: (t) => ({
      assertion: t.string({ required: true }),
      idempotencyKey: t.string({ required: true }),
      runCellId: t.id({ required: true }),
      reviewerMembershipId: t.id({ required: true }),
      kind: t.field({ type: AssignmentKindEnum, required: true }),
      specialistDimension: t.string({ required: false }),
    }),
  },
)
const CorrectionInput = builder.inputType(
  "ManagerSubtitleEvalCorrectionInput",
  {
    fields: (t) => ({
      segmentId: t.id({ required: true }),
      track: t.string({ required: true }),
      text: t.string({ required: true }),
    }),
  },
)
const BlindTrackAssessmentInput = builder.inputType(
  "ManagerSubtitleEvalBlindTrackAssessmentInput",
  {
    fields: (t) => ({
      meaningAccuracyScore: t.int({ required: true }),
      naturalnessScore: t.int({ required: true }),
      timingReadabilityScore: t.int({ required: true }),
      scriptureTheologyScore: t.int({ required: false }),
      issueCodes: t.field({ type: [IssueCodeEnum], required: true }),
      criticalMeaningLoss: t.boolean({ required: true }),
      criticalHarmful: t.boolean({ required: true }),
      criticalScriptureRisk: t.boolean({ required: true }),
    }),
  },
)
const BlindTrackAssessmentsInput = builder.inputType(
  "ManagerSubtitleEvalBlindTrackAssessmentsInput",
  {
    fields: (t) => ({
      trackA: t.field({ type: BlindTrackAssessmentInput, required: true }),
      trackB: t.field({ type: BlindTrackAssessmentInput, required: true }),
    }),
  },
)
const SubmitReviewInput = builder.inputType(
  "ManagerSubtitleEvalSubmitReviewInput",
  {
    fields: (t) => ({
      assertion: t.string({ required: true }),
      idempotencyKey: t.string({ required: true }),
      assignmentId: t.id({ required: true }),
      rubricVersion: t.int({ required: true }),
      trackAssessments: t.field({
        type: BlindTrackAssessmentsInput,
        required: true,
      }),
      verdict: t.field({ type: ReviewVerdictEnum, required: true }),
      questionableTrack: t.field({ type: BlindTrackEnum, required: false }),
      notes: t.string({ required: false }),
      corrections: t.field({ type: [CorrectionInput], required: true }),
      supersedesReviewId: t.id({ required: false }),
      bodyDigest: t.string({ required: true }),
    }),
  },
)
const CreateComparisonInput = builder.inputType(
  "ManagerSubtitleEvalCreateComparisonInput",
  {
    fields: (t) => ({
      assertion: t.string({ required: true }),
      idempotencyKey: t.string({ required: true }),
      baselineReportId: t.id({ required: true }),
      candidateReportId: t.id({ required: true }),
      changedAxis: t.field({ type: ChangedAxisEnum, required: true }),
    }),
  },
)
const DispositionReferenceIssueInput = builder.inputType(
  "ManagerSubtitleEvalDispositionReferenceIssueInput",
  {
    fields: (t) => ({
      assertion: t.string({ required: true }),
      issueId: t.id({ required: true }),
      disposition: t.string({ required: true }),
      reason: t.string({ required: true }),
      correctedCorpusVersionId: t.id({ required: false }),
    }),
  },
)
const AssignSpecialistInput = builder.inputType(
  "ManagerSubtitleEvalAssignSpecialistInput",
  {
    fields: (t) => ({
      assertion: t.string({ required: true }),
      assignmentId: t.id({ required: true }),
      reviewerMembershipId: t.id({ required: true }),
    }),
  },
)
const AppendNarrativeInput = builder.inputType(
  "ManagerSubtitleEvalAppendNarrativeInput",
  {
    fields: (t) => ({
      assertion: t.string({ required: true }),
      comparisonId: t.id({ required: true }),
      hypothesis: t.string({ required: true }),
      conclusion: t.string({ required: false }),
      rationale: t.string({ required: false }),
      followUpAction: t.string({ required: false }),
    }),
  },
)
const RecoverRunInput = builder.inputType(
  "ManagerSubtitleEvalRecoverRunInput",
  {
    fields: (t) => ({
      assertion: t.string({ required: true }),
      runId: t.id({ required: true }),
      leaseGeneration: t.int({ required: true }),
      leaseToken: t.string({ required: true }),
      dispatchFailed: t.boolean({ required: false }),
    }),
  },
)
const MachineRecoverRunInput = builder.inputType(
  "ManagerSubtitleEvalMachineRecoverRunInput",
  {
    fields: (t) => ({
      runId: t.id({ required: true }),
      leaseGeneration: t.int({ required: true }),
      leaseToken: t.string({ required: true }),
      dispatchFailed: t.boolean({ required: false }),
    }),
  },
)

builder.queryFields((t) => ({
  managerSubtitleEvalVideoContext: t.field({
    type: VideoContextRef,
    nullable: true,
    authScopes: { hasPermission: "read:manager-subtitle-eval" },
    args: {
      videoId: t.arg.id({ required: true }),
      editionIdentity: t.arg.string({ required: true }),
    },
    resolve: (_root, args, ctx) =>
      ctx.services.subtitleEval.getVideoContext({
        user: ctx.user,
        videoId: String(args.videoId),
        editionIdentity: args.editionIdentity,
      }),
  }),
  managerSubtitleEvalCorpusVersion: t.field({
    type: CorpusVersionRef,
    nullable: true,
    authScopes: { hasPermission: "read:manager-subtitle-eval" },
    args: { id: t.arg.id({ required: true }) },
    resolve: (_root, args, ctx) =>
      ctx.services.subtitleEval.getCorpusVersion({
        user: ctx.user,
        id: String(args.id),
      }),
  }),
  managerSubtitleEvalRun: t.field({
    type: RunDetailRef,
    nullable: true,
    authScopes: { hasPermission: "read:manager-subtitle-eval" },
    args: { id: t.arg.id({ required: true }) },
    resolve: (_root, args, ctx) =>
      ctx.services.subtitleEval.getRun({
        user: ctx.user,
        id: String(args.id),
      }),
  }),
  managerSubtitleEvalRuns: t.field({
    type: RunPageRef,
    authScopes: { hasPermission: "read:manager-subtitle-eval" },
    args: {
      limit: t.arg.int({ required: false, defaultValue: 25 }),
      after: t.arg.string({ required: false }),
    },
    resolve: (_root, args, ctx) =>
      ctx.services.subtitleEval.listRuns({
        user: ctx.user,
        limit: args.limit ?? 25,
        after: args.after,
      }),
  }),
  managerSubtitleEvalStaleRuns: t.field({
    type: StaleRunPageRef,
    authScopes: { hasPermission: "read:manager-subtitle-eval" },
    args: {
      limit: t.arg.int({ required: false, defaultValue: 25 }),
      after: t.arg.string({ required: false }),
    },
    resolve: (_root, args, ctx) =>
      ctx.services.subtitleEval.listStaleRuns({
        user: ctx.user,
        limit: args.limit ?? 25,
        after: args.after,
      }),
  }),
  managerSubtitleEvalComparison: t.field({
    type: ComparisonRef,
    nullable: true,
    authScopes: { hasPermission: "read:manager-subtitle-eval" },
    args: { id: t.arg.id({ required: true }) },
    resolve: (_root, args, ctx) =>
      ctx.services.subtitleEval.getComparison({
        user: ctx.user,
        id: String(args.id),
      }),
  }),
  managerSubtitleEvalReferenceIssues: t.field({
    type: ReferenceIssuePageRef,
    authScopes: { hasPermission: "read:manager-subtitle-eval" },
    args: {
      status: t.arg.string({ required: false }),
      limit: t.arg.int({ required: false, defaultValue: 25 }),
      after: t.arg.string({ required: false }),
    },
    resolve: (_root, args, ctx) =>
      ctx.services.subtitleEval.listReferenceIssues({
        user: ctx.user,
        status: args.status as "OPEN" | "ACCEPTED" | "REJECTED" | undefined,
        limit: args.limit ?? 25,
        after: args.after,
      }),
  }),
  managerSubtitleEvalOperatorReviewerCandidates: t.field({
    type: OperatorReviewerCandidatePageRef,
    authScopes: { hasPermission: "read:manager-subtitle-eval" },
    args: {
      targetLanguageId: t.arg.id({ required: true }),
      targetLanguageSlug: t.arg.string({ required: true }),
      specialistDimension: t.arg.string({ required: false }),
      limit: t.arg.int({ required: false, defaultValue: 25 }),
      after: t.arg.string({ required: false }),
    },
    resolve: (_root, args, ctx) =>
      ctx.services.subtitleEval.listOperatorReviewerCandidates({
        user: ctx.user,
        targetLanguageId: String(args.targetLanguageId),
        targetLanguageSlug: args.targetLanguageSlug,
        specialistDimension: args.specialistDimension,
        limit: args.limit ?? 25,
        after: args.after,
      }),
  }),
  managerSubtitleEvalOperatorAssignments: t.field({
    type: OperatorAssignmentPageRef,
    authScopes: { hasPermission: "read:manager-subtitle-eval" },
    args: {
      runId: t.arg.id({ required: true }),
      runCellId: t.arg.id({ required: false }),
      limit: t.arg.int({ required: false, defaultValue: 50 }),
      after: t.arg.string({ required: false }),
    },
    resolve: (_root, args, ctx) =>
      ctx.services.subtitleEval.listOperatorAssignments({
        user: ctx.user,
        runId: String(args.runId),
        runCellId: args.runCellId ? String(args.runCellId) : null,
        limit: args.limit ?? 50,
        after: args.after,
      }),
  }),
  managerSubtitleEvalOperatorAssignment: t.field({
    type: OperatorAssignmentDetailRef,
    nullable: true,
    authScopes: { hasPermission: "read:manager-subtitle-eval" },
    args: { assignmentId: t.arg.id({ required: true }) },
    resolve: (_root, args, ctx) =>
      ctx.services.subtitleEval.getOperatorAssignment({
        user: ctx.user,
        assignmentId: String(args.assignmentId),
      }),
  }),
  managerSubtitleEvalReviewerAssignments: t.field({
    type: ReviewerAssignmentPageRef,
    authScopes: { hasPermission: "read:manager-subtitle-eval" },
    args: {
      assertion: t.arg.string({ required: true }),
      limit: t.arg.int({ required: false, defaultValue: 25 }),
      after: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      const payload = { limit: args.limit ?? 25, after: args.after ?? null }
      const assertion = await consumeDelegation(
        ctx.services.subtitleEval,
        args.assertion,
        "REVIEWER_QUEUE",
        payload,
        "GET",
      )
      return ctx.services.subtitleEval.listReviewerAssignments({
        actorId: assertion.actorId,
        limit: args.limit ?? 25,
        after: args.after,
      })
    },
  }),
  managerSubtitleEvalReviewerAssignment: t.field({
    type: ReviewerAssignmentDetailRef,
    nullable: true,
    authScopes: { hasPermission: "read:manager-subtitle-eval" },
    args: {
      assignmentId: t.arg.id({ required: true }),
      assertion: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      const assertion = await verifySubtitleReviewAssertion(args.assertion)
      if (
        assertion.assignmentId !== String(args.assignmentId) ||
        assertion.method !== "GET"
      ) {
        return null
      }
      try {
        return await ctx.services.subtitleEval.getReviewerAssignment({
          assertion,
        })
      } catch {
        return null
      }
    },
  }),
}))

builder.mutationFields((t) => ({
  importManagerSubtitleEvalCorpus: t.field({
    type: OperationResultRef,
    authScopes: { hasPermission: "write:manager-subtitle-eval" },
    args: { input: t.arg({ type: ImportCorpusInput, required: true }) },
    resolve: async (_root, { input }, ctx) => {
      const { assertion: assertionToken, ...delegatedPayload } = input
      const assertion = await consumeDelegation(
        ctx.services.subtitleEval,
        assertionToken,
        "IMPORT_CORPUS",
        delegatedPayload,
        "POST",
      )
      const result = await ctx.services.subtitleEval.importCorpus({
        user: ctx.user,
        requestId: assertion.requestId,
        importedById: assertion.actorId,
        input: {
          ...delegatedPayload,
          certification: input.certification ?? {},
          supersedesVersionId: input.supersedesVersionId
            ? String(input.supersedesVersionId)
            : null,
          cells: input.cells.map((cell) => ({
            ...cell,
            caseId: String(cell.caseId),
            videoId: String(cell.videoId),
            sourceLanguageId: String(cell.sourceLanguageId),
            targetLanguageId: String(cell.targetLanguageId),
            metadata: cell.metadata ?? {},
            sourceSnapshot: {
              ...cell.sourceSnapshot,
              kind: "SOURCE" as const,
              clippedSha256: cell.sourceSnapshot.clippedSha256 ?? null,
              byteLength: BigInt(cell.sourceSnapshot.byteLength),
              mediaType: "text/vtt" as const,
            },
            referenceSnapshot: {
              ...cell.referenceSnapshot,
              kind: "REFERENCE" as const,
              clippedSha256: cell.referenceSnapshot.clippedSha256 ?? null,
              byteLength: BigInt(cell.referenceSnapshot.byteLength),
              mediaType: "text/vtt" as const,
            },
          })),
        },
      })
      return {
        id: result.id,
        status: result.status,
        digest: result.identityDigest,
        replayed: result.replayed,
      }
    },
  }),
  approveManagerSubtitleEvalCorpus: t.field({
    type: OperationResultRef,
    authScopes: { hasPermission: "write:manager-subtitle-eval" },
    args: { input: t.arg({ type: ApproveCorpusInput, required: true }) },
    resolve: async (_root, { input }, ctx) => {
      const { assertion: assertionToken, ...delegatedPayload } = input
      const assertion = await consumeDelegation(
        ctx.services.subtitleEval,
        assertionToken,
        "APPROVE_CORPUS",
        delegatedPayload,
        "POST",
      )
      const row = await ctx.services.subtitleEval.approveCorpusVersion({
        user: ctx.user,
        input: {
          ...delegatedPayload,
          corpusVersionId: String(input.corpusVersionId),
          approvedById: assertion.actorId,
          requestId: assertion.requestId,
          certification: input.certification as never,
        },
      })
      return {
        id: row.id,
        status: row.status,
        digest: row.identityDigest,
        replayed: row.replayed,
      }
    },
  }),
  createManagerSubtitleEvalRun: t.field({
    type: OperationResultRef,
    authScopes: { hasPermission: "write:manager-subtitle-eval" },
    args: { input: t.arg({ type: CreateRunInput, required: true }) },
    resolve: async (_root, { input }, ctx) => {
      const { assertion: assertionToken, ...delegatedPayload } = input
      const assertion = await consumeDelegation(
        ctx.services.subtitleEval,
        assertionToken,
        "CREATE_RUN",
        delegatedPayload,
        "POST",
      )
      const result = await ctx.services.subtitleEval.createRun({
        user: ctx.user,
        requestId: assertion.requestId,
        input: {
          ...delegatedPayload,
          operatorId: assertion.actorId,
          corpusVersionId: String(input.corpusVersionId),
          corpusCellIds: input.corpusCellIds.map(String),
          determinism: input.determinism ?? {},
        },
      })
      return { id: result.id, status: result.status, replayed: result.replayed }
    },
  }),
  claimManagerSubtitleEvalCell: t.field({
    type: OperationResultRef,
    authScopes: { hasPermission: "write:manager-subtitle-eval" },
    args: {
      runCellId: t.arg.id({ required: true }),
      leaseSeconds: t.arg.int({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      const result = await ctx.services.subtitleEval.claimRunCell({
        runCellId: String(args.runCellId),
        leaseSeconds: args.leaseSeconds,
      })
      return {
        id: result.cell.id,
        status: result.cell.status,
        digest: result.executionClaim
          ? `${result.executionClaim.generation}:${result.executionClaim.token}:${result.executionClaim.expiresAt}#${result.executionClaim.executionAttempt}`
          : null,
        replayed: result.replayed,
      }
    },
  }),
  finalizeManagerSubtitleEvalCell: t.field({
    type: OperationResultRef,
    authScopes: { hasPermission: "write:manager-subtitle-eval" },
    args: { input: t.arg({ type: FinalizeCellInput, required: true }) },
    resolve: async (_root, { input }, ctx) => {
      const result = await ctx.services.subtitleEval.finalizeRunCell({
        ...input,
        runCellId: String(input.runCellId),
        artifacts: input.artifacts.map((artifact) => ({
          ...artifact,
          byteLength: BigInt(artifact.byteLength),
        })),
        providerCalls: normalizeProviderCalls(input.providerCalls),
        machineAssessment: {
          ...input.machineAssessment,
          metrics: input.machineAssessment.metrics ?? null,
          advisoryRiskFlags: input.machineAssessment.advisoryRiskFlags ?? [],
          usage: input.machineAssessment.usage ?? {},
        },
      })
      return {
        id: result.cell.id,
        status: result.cell.status,
        digest: result.cell.resultDigest,
        replayed: result.replayed,
      }
    },
  }),
  failManagerSubtitleEvalCell: t.field({
    type: OperationResultRef,
    authScopes: { hasPermission: "write:manager-subtitle-eval" },
    args: { input: t.arg({ type: FailCellInput, required: true }) },
    resolve: async (_root, { input }, ctx) => {
      const result = await ctx.services.subtitleEval.failRunCell({
        ...input,
        runCellId: String(input.runCellId),
        providerCalls: normalizeProviderCalls(input.providerCalls),
      })
      return {
        id: result.id,
        status: result.status,
        digest: result.errorCode,
        replayed: false,
      }
    },
  }),
  claimManagerSubtitleEvalRecovery: t.field({
    type: OperationResultRef,
    authScopes: { hasPermission: "write:manager-subtitle-eval" },
    args: {
      assertion: t.arg.string({ required: true }),
      runId: t.arg.id({ required: true }),
      leaseSeconds: t.arg.int({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      const payload = {
        action: "claim",
        runId: String(args.runId),
        leaseSeconds: args.leaseSeconds,
      }
      await consumeDelegation(
        ctx.services.subtitleEval,
        args.assertion,
        "RECOVER_RUN",
        payload,
        "POST",
      )
      const claim = await ctx.services.subtitleEval.claimRunRecovery({
        user: ctx.user,
        runId: String(args.runId),
        leaseSeconds: args.leaseSeconds,
      })
      return {
        id: claim.runId,
        status: "CLAIMED",
        digest: `${claim.leaseGeneration}:${claim.leaseToken}:${claim.leaseExpiresAt.toISOString()}`,
        replayed: false,
      }
    },
  }),
  recoverManagerSubtitleEvalRun: t.field({
    type: OperationResultRef,
    authScopes: { hasPermission: "write:manager-subtitle-eval" },
    args: { input: t.arg({ type: RecoverRunInput, required: true }) },
    resolve: async (_root, { input }, ctx) => {
      const { assertion: assertionToken, ...delegatedPayload } = input
      const assertion = await consumeDelegation(
        ctx.services.subtitleEval,
        assertionToken,
        "RECOVER_RUN",
        delegatedPayload,
        "POST",
      )
      const result = await ctx.services.subtitleEval.recoverRun({
        user: ctx.user,
        input: {
          ...delegatedPayload,
          runId: String(input.runId),
          dispatchFailed: input.dispatchFailed ?? false,
          actorId: assertion.actorId,
          requestId: assertion.requestId,
        },
      })
      return {
        id: result.runId,
        status: result.readyToFinalize ? "READY_TO_FINALIZE" : "REQUEUED",
        digest: `${result.requeuedCellCount}:${result.terminalizedCellCount}`,
        replayed: false,
      }
    },
  }),
  claimManagerSubtitleEvalMachineRecovery: t.field({
    type: OperationResultRef,
    authScopes: { hasPermission: "write:manager-subtitle-eval" },
    args: {
      runId: t.arg.id({ required: true }),
      leaseSeconds: t.arg.int({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      const claim = await ctx.services.subtitleEval.claimMachineRunRecovery({
        user: ctx.user,
        runId: String(args.runId),
        leaseSeconds: args.leaseSeconds,
      })
      return {
        id: claim.runId,
        status: "CLAIMED",
        digest: `${claim.leaseGeneration}:${claim.leaseToken}:${claim.leaseExpiresAt.toISOString()}`,
        replayed: false,
      }
    },
  }),
  recoverManagerSubtitleEvalMachineRun: t.field({
    type: OperationResultRef,
    authScopes: { hasPermission: "write:manager-subtitle-eval" },
    args: { input: t.arg({ type: MachineRecoverRunInput, required: true }) },
    resolve: async (_root, { input }, ctx) => {
      const result = await ctx.services.subtitleEval.recoverMachineRun({
        user: ctx.user,
        input: {
          ...input,
          runId: String(input.runId),
          dispatchFailed: input.dispatchFailed ?? false,
        },
      })
      return {
        id: result.runId,
        status: result.readyToFinalize ? "READY_TO_FINALIZE" : "REQUEUED",
        digest: `${result.requeuedCellCount}:${result.terminalizedCellCount}`,
        replayed: false,
      }
    },
  }),
  finalizeManagerSubtitleEvalRun: t.field({
    type: OperationResultRef,
    authScopes: { hasPermission: "write:manager-subtitle-eval" },
    args: { input: t.arg({ type: FinalizeRunInput, required: true }) },
    resolve: async (_root, { input }, ctx) => {
      const result = await ctx.services.subtitleEval.finalizeRun({
        ...input,
        runId: String(input.runId),
        reproducibilityLimits: input.reproducibilityLimits ?? [],
      })
      return {
        id: result.report.id,
        status: result.report.status,
        digest: result.report.reportDigest,
        replayed: result.replayed,
      }
    },
  }),
  createManagerSubtitleEvalAssignment: t.field({
    type: OperationResultRef,
    authScopes: { hasPermission: "write:manager-subtitle-eval" },
    args: { input: t.arg({ type: CreateAssignmentInput, required: true }) },
    resolve: async (_root, { input }, ctx) => {
      const { assertion: assertionToken, ...delegatedPayload } = input
      const assertion = await consumeDelegation(
        ctx.services.subtitleEval,
        assertionToken,
        "CREATE_ASSIGNMENT",
        delegatedPayload,
        "POST",
      )
      const result = await ctx.services.subtitleEval.createAssignment({
        user: ctx.user,
        input: {
          ...delegatedPayload,
          runCellId: String(input.runCellId),
          reviewerMembershipId: String(input.reviewerMembershipId),
          assignedById: assertion.actorId,
          requestId: assertion.requestId,
        },
      })
      return {
        id: result.assignment.id,
        status: result.assignment.status,
        replayed: result.replayed,
      }
    },
  }),
  submitManagerSubtitleEvalReview: t.field({
    type: OperationResultRef,
    authScopes: { hasPermission: "write:manager-subtitle-eval" },
    args: { input: t.arg({ type: SubmitReviewInput, required: true }) },
    resolve: async (_root, { input }, ctx) => {
      const assertion = await verifySubtitleReviewAssertion(input.assertion)
      const { assertion: _assertion, ...reviewInput } = input
      void _assertion
      const result = await ctx.services.subtitleEval.submitReview({
        assertion,
        input: {
          ...reviewInput,
          assignmentId: String(input.assignmentId),
          questionableTrack: input.questionableTrack ?? null,
          trackAssessments: {
            trackA: {
              ...input.trackAssessments.trackA,
              scriptureTheologyScore:
                input.trackAssessments.trackA.scriptureTheologyScore ?? null,
            },
            trackB: {
              ...input.trackAssessments.trackB,
              scriptureTheologyScore:
                input.trackAssessments.trackB.scriptureTheologyScore ?? null,
            },
          },
          supersedesReviewId: input.supersedesReviewId
            ? String(input.supersedesReviewId)
            : null,
          corrections: input.corrections.map((correction) => ({
            ...correction,
            segmentId: String(correction.segmentId),
            track: correction.track as "A" | "B",
          })),
        },
      })
      return {
        id: result.review.id,
        status: result.review.verdict,
        digest: result.review.bodyDigest,
        replayed: result.replayed,
      }
    },
  }),
  createManagerSubtitleEvalComparison: t.field({
    type: OperationResultRef,
    authScopes: { hasPermission: "write:manager-subtitle-eval" },
    args: { input: t.arg({ type: CreateComparisonInput, required: true }) },
    resolve: async (_root, { input }, ctx) => {
      const { assertion: assertionToken, ...delegatedPayload } = input
      const assertion = await consumeDelegation(
        ctx.services.subtitleEval,
        assertionToken,
        "CREATE_COMPARISON",
        delegatedPayload,
        "POST",
      )
      const result = await ctx.services.subtitleEval.createComparison({
        user: ctx.user,
        input: {
          ...delegatedPayload,
          baselineReportId: String(input.baselineReportId),
          candidateReportId: String(input.candidateReportId),
          createdById: assertion.actorId,
          requestId: assertion.requestId,
        },
      })
      return {
        id: result.comparison.id,
        status: result.comparison.coverageLabel,
        replayed: result.replayed,
      }
    },
  }),
  dispositionManagerSubtitleEvalReferenceIssue: t.field({
    type: OperationResultRef,
    authScopes: { hasPermission: "write:manager-subtitle-eval" },
    args: {
      input: t.arg({ type: DispositionReferenceIssueInput, required: true }),
    },
    resolve: async (_root, { input }, ctx) => {
      const { assertion: assertionToken, ...delegatedPayload } = input
      const assertion = await consumeDelegation(
        ctx.services.subtitleEval,
        assertionToken,
        "DISPOSITION_REFERENCE_ISSUE",
        delegatedPayload,
        "POST",
      )
      const row = await ctx.services.subtitleEval.dispositionReferenceIssue({
        user: ctx.user,
        input: {
          ...delegatedPayload,
          issueId: String(input.issueId),
          disposition: input.disposition as "ACCEPTED" | "REJECTED",
          correctedCorpusVersionId: input.correctedCorpusVersionId
            ? String(input.correctedCorpusVersionId)
            : null,
          actorId: assertion.actorId,
          requestId: assertion.requestId,
        },
      })
      return { id: row.id, status: row.status, replayed: false }
    },
  }),
  assignManagerSubtitleEvalSpecialist: t.field({
    type: OperationResultRef,
    authScopes: { hasPermission: "write:manager-subtitle-eval" },
    args: { input: t.arg({ type: AssignSpecialistInput, required: true }) },
    resolve: async (_root, { input }, ctx) => {
      const { assertion: assertionToken, ...delegatedPayload } = input
      const assertion = await consumeDelegation(
        ctx.services.subtitleEval,
        assertionToken,
        "ASSIGN_SPECIALIST",
        delegatedPayload,
        "POST",
      )
      const result = await ctx.services.subtitleEval.assignPendingSpecialist({
        user: ctx.user,
        input: {
          ...delegatedPayload,
          assignmentId: String(input.assignmentId),
          reviewerMembershipId: String(input.reviewerMembershipId),
          assignedById: assertion.actorId,
          requestId: assertion.requestId,
        },
      })
      return {
        id: result.assignment.id,
        status: result.assignment.status,
        replayed: result.replayed,
      }
    },
  }),
  appendManagerSubtitleEvalNarrative: t.field({
    type: OperationResultRef,
    authScopes: { hasPermission: "write:manager-subtitle-eval" },
    args: { input: t.arg({ type: AppendNarrativeInput, required: true }) },
    resolve: async (_root, { input }, ctx) => {
      const { assertion: assertionToken, ...delegatedPayload } = input
      const assertion = await consumeDelegation(
        ctx.services.subtitleEval,
        assertionToken,
        "APPEND_NARRATIVE",
        delegatedPayload,
        "POST",
      )
      const row = await ctx.services.subtitleEval.appendExperimentNarrative({
        user: ctx.user,
        input: {
          ...delegatedPayload,
          comparisonId: String(input.comparisonId),
          createdById: assertion.actorId,
          requestId: assertion.requestId,
        },
      })
      return { id: row.id, status: `VERSION_${row.version}`, replayed: false }
    },
  }),
}))
