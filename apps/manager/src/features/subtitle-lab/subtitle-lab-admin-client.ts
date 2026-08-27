import { randomUUID } from "node:crypto"

import { print } from "@apollo/client/utilities"
import {
  adminGraphql,
  type AdminResultOf,
  type AdminVariablesOf,
} from "@forge/admin-graphql"
import { z } from "zod"

import { env } from "@/config/env"
import {
  canonicalDigest,
  canonicalReviewSubmissionDigest,
  normalizeReviewSubmission,
  operationResultSchema,
  sha256Bytes,
} from "@/features/subtitle-lab/subtitle-lab-contract"
import {
  getAdminManagerOAuthBearer,
  getAdminManagerServiceBearer,
} from "@/lib/admin-manager-session"
import type { ManagerSessionPrincipal } from "@/lib/manager-session-cookie"
import { createSubtitleEvalSessionProof } from "@/lib/subtitle-eval-session-proof"
import { MAX_SUBTITLE_EVAL_ARTIFACT_BYTES } from "@/services/subtitle-eval-artifacts"

const MAX_ADMIN_GRAPHQL_RESPONSE_BYTES = 4 * 1024 * 1024
const MAX_ADMIN_SESSION_RESPONSE_BYTES = 64 * 1024
const MAX_ADMIN_LOCATOR_RESPONSE_BYTES = 16 * 1024

const CorpusOperation = adminGraphql(`
  query ManagerSubtitleEvalCorpusVersion($id: ID!) {
    managerSubtitleEvalCorpusVersion(id: $id) {
      id status identityDigest manifestDigest lockDigest authority certification
      supersedesVersionId approvedById approvedAt createdAt
      cells {
        id caseId collectionKey videoId editionIdentity
        sourceLanguageId sourceLanguageSlug sourceTrackIdentity
        targetLanguageId targetLanguageSlug referenceTrackIdentity
        sourceSnapshotDigest sourceSnapshotRawDigest
        sourceSnapshotClippedDigest referenceSnapshotDigest
        referenceSnapshotRawDigest referenceSnapshotClippedDigest metadata
      }
    }
  }
`)
const RunOperation = adminGraphql(`
  query ManagerSubtitleEvalRun($id: ID!) {
    managerSubtitleEvalRun(id: $id) {
      id status corpusVersionId requestedProvider requestedModel promptPolicyId
      workflowPolicyDigest codeRevision concurrency timeoutSeconds maxAttempts
      estimatedSpendMicros createdAt terminalAt
      cells {
        id status attemptCount leaseGeneration errorCode errorRetryable resultDigest
        caseId collectionKey videoId targetLanguageId targetLanguageSlug
        machineMetrics providerRequestId providerResponseId assessmentDigest
        resolvedModel reproducibilityLimits artifactDigests assignmentCount
      }
      terminalReport {
        id status reportDigest reportArtifactDigest corpusIdentityDigest
        sourceReferenceDigests providerIdentities runtimeIdentity usage
        languageMetrics collectionMetrics artifactInventory reproducibilityLimits
        partialFailures completedAt
      }
    }
  }
`)
const RunsOperation = adminGraphql(`
  query ManagerSubtitleEvalRuns($limit: Int, $after: String) {
    managerSubtitleEvalRuns(limit: $limit, after: $after) {
      nodes {
        id status requestedProvider requestedModel promptPolicyId codeRevision
        cellCount createdAt terminalAt
      }
      nextCursor
    }
  }
`)
const StaleRunsOperation = adminGraphql(`
  query ManagerSubtitleEvalStaleRuns($limit: Int, $after: String) {
    managerSubtitleEvalStaleRuns(limit: $limit, after: $after) {
      nodes { id status leaseGeneration leaseExpiresAt cellCount updatedAt }
      nextCursor
    }
  }
`)
const ReviewerQueueOperation = adminGraphql(`
  query ManagerSubtitleEvalReviewerAssignments(
    $assertion: String!
    $limit: Int
    $after: String
  ) {
    managerSubtitleEvalReviewerAssignments(
      assertion: $assertion
      limit: $limit
      after: $after
    ) {
      nodes {
        id status kind round targetLanguageId targetLanguageSlug caseId
        collectionKey videoId assignedAt submittedAt
      }
      nextCursor
    }
  }
`)
const ReviewerDetailOperation = adminGraphql(`
  query ManagerSubtitleEvalReviewerAssignment(
    $assignmentId: ID!
    $assertion: String!
  ) {
    managerSubtitleEvalReviewerAssignment(
      assignmentId: $assignmentId
      assertion: $assertion
    ) {
      id status kind round targetLanguageId targetLanguageSlug caseId
      collectionKey videoId editionIdentity clipStartSeconds clipEndSeconds submitted
      sourceTrack { label contentId mediaType }
      trackA { label contentId mediaType }
      trackB { label contentId mediaType }
      postSubmitReceipt {
        reviewId submittedAt referenceTrackLabel candidateTrackLabel
        machineAdvisoryRiskFlags resolvedModel assessmentDigest
      }
    }
  }
`)
const ImportCorpusOperation = adminGraphql(`
  mutation ImportManagerSubtitleEvalCorpus(
    $input: ManagerSubtitleEvalImportCorpusInput!
  ) {
    importManagerSubtitleEvalCorpus(input: $input) {
      id status digest replayed
    }
  }
`)
const CreateRunOperation = adminGraphql(`
  mutation CreateManagerSubtitleEvalRun(
    $input: ManagerSubtitleEvalCreateRunInput!
  ) {
    createManagerSubtitleEvalRun(input: $input) { id status digest replayed }
  }
`)
const ClaimCellOperation = adminGraphql(`
  mutation ClaimManagerSubtitleEvalCell($runCellId: ID!, $leaseSeconds: Int!) {
    claimManagerSubtitleEvalCell(
      runCellId: $runCellId
      leaseSeconds: $leaseSeconds
    ) { id status digest replayed }
  }
`)
const FinalizeCellOperation = adminGraphql(`
  mutation FinalizeManagerSubtitleEvalCell(
    $input: ManagerSubtitleEvalFinalizeCellInput!
  ) {
    finalizeManagerSubtitleEvalCell(input: $input) { id status digest replayed }
  }
`)
const FailCellOperation = adminGraphql(`
  mutation FailManagerSubtitleEvalCell(
    $input: ManagerSubtitleEvalFailCellInput!
  ) {
    failManagerSubtitleEvalCell(input: $input) { id status digest replayed }
  }
`)
const FinalizeRunOperation = adminGraphql(`
  mutation FinalizeManagerSubtitleEvalRun(
    $input: ManagerSubtitleEvalFinalizeRunInput!
  ) {
    finalizeManagerSubtitleEvalRun(input: $input) { id status digest replayed }
  }
`)
const CreateAssignmentOperation = adminGraphql(`
  mutation CreateManagerSubtitleEvalAssignment(
    $input: ManagerSubtitleEvalCreateAssignmentInput!
  ) {
    createManagerSubtitleEvalAssignment(input: $input) {
      id status digest replayed
    }
  }
`)
const ApproveCorpusOperation = adminGraphql(`
  mutation ApproveManagerSubtitleEvalCorpus(
    $input: ManagerSubtitleEvalApproveCorpusInput!
  ) {
    approveManagerSubtitleEvalCorpus(input: $input) {
      id status digest replayed
    }
  }
`)
const ComparisonOperation = adminGraphql(`
  query ManagerSubtitleEvalComparison($id: ID!) {
    managerSubtitleEvalComparison(id: $id) {
      id baselineReportId candidateReportId changedAxis coverageLabel
      matchedCellCount matchedCollectionCount identityDifferences
      descriptiveDeltas humanEvidence unmatchedCells
      narratives {
        id version hypothesis conclusion rationale followUpAction
        createdById createdAt
      }
    }
  }
`)
const CreateComparisonOperation = adminGraphql(`
  mutation CreateManagerSubtitleEvalComparison(
    $input: ManagerSubtitleEvalCreateComparisonInput!
  ) {
    createManagerSubtitleEvalComparison(input: $input) {
      id status digest replayed
    }
  }
`)
const AppendNarrativeOperation = adminGraphql(`
  mutation AppendManagerSubtitleEvalNarrative(
    $input: ManagerSubtitleEvalAppendNarrativeInput!
  ) {
    appendManagerSubtitleEvalNarrative(input: $input) {
      id status digest replayed
    }
  }
`)
const ReferenceIssuesOperation = adminGraphql(`
  query ManagerSubtitleEvalReferenceIssues(
    $status: String
    $limit: Int
    $after: String
  ) {
    managerSubtitleEvalReferenceIssues(
      status: $status
      limit: $limit
      after: $after
    ) {
      nodes {
        id status reviewId corpusCellId caseId collectionKey
        targetLanguageId targetLanguageSlug dispositionReason
        correctedCorpusVersionId createdAt
      }
      nextCursor
    }
  }
`)
const DispositionReferenceIssueOperation = adminGraphql(`
  mutation DispositionManagerSubtitleEvalReferenceIssue(
    $input: ManagerSubtitleEvalDispositionReferenceIssueInput!
  ) {
    dispositionManagerSubtitleEvalReferenceIssue(input: $input) {
      id status digest replayed
    }
  }
`)
const OperatorReviewerCandidatesOperation = adminGraphql(`
  query ManagerSubtitleEvalOperatorReviewerCandidates(
    $targetLanguageId: ID!
    $targetLanguageSlug: String!
    $specialistDimension: String
    $limit: Int
    $after: String
  ) {
    managerSubtitleEvalOperatorReviewerCandidates(
      targetLanguageId: $targetLanguageId
      targetLanguageSlug: $targetLanguageSlug
      specialistDimension: $specialistDimension
      limit: $limit
      after: $after
    ) {
      nodes {
        membershipId displayName email targetLanguageId targetLanguageSlug
        qualificationVersion rubricDimensions specialistCapabilities
        activeAssignmentCount
      }
      nextCursor
    }
  }
`)
const OperatorAssignmentsOperation = adminGraphql(`
  query ManagerSubtitleEvalOperatorAssignments(
    $runId: ID!
    $runCellId: ID
    $limit: Int
    $after: String
  ) {
    managerSubtitleEvalOperatorAssignments(
      runId: $runId
      runCellId: $runCellId
      limit: $limit
      after: $after
    ) {
      nodes {
        id runCellId status kind round specialistDimension
        reviewerMembershipId reviewerDisplayName reviewerEmail
        assignedAt submittedAt latestVerdict
      }
      nextCursor
    }
  }
`)
const OperatorAssignmentOperation = adminGraphql(`
  query ManagerSubtitleEvalOperatorAssignment($assignmentId: ID!) {
    managerSubtitleEvalOperatorAssignment(assignmentId: $assignmentId) {
      id status kind round specialistDimension targetLanguageId
      targetLanguageSlug reviewerMembershipId reviewerDisplayName
      reviewerEmail caseId collectionKey videoId editionIdentity
      clipStartSeconds clipEndSeconds machineAssessment reviews
      sourceTrack { label contentId mediaType }
      referenceTrack { label contentId mediaType }
      candidateTrack { label contentId mediaType }
      referenceTrackLabel candidateTrackLabel
    }
  }
`)
const AssignSpecialistOperation = adminGraphql(`
  mutation AssignManagerSubtitleEvalSpecialist(
    $input: ManagerSubtitleEvalAssignSpecialistInput!
  ) {
    assignManagerSubtitleEvalSpecialist(input: $input) {
      id status digest replayed
    }
  }
`)
const SubmitReviewOperation = adminGraphql(`
  mutation SubmitManagerSubtitleEvalReview(
    $input: ManagerSubtitleEvalSubmitReviewInput!
  ) {
    submitManagerSubtitleEvalReview(input: $input) { id status digest replayed }
  }
`)
const ClaimMachineRecoveryOperation = adminGraphql(`
  mutation ClaimManagerSubtitleEvalMachineRecovery(
    $runId: ID!
    $leaseSeconds: Int!
  ) {
    claimManagerSubtitleEvalMachineRecovery(
      runId: $runId
      leaseSeconds: $leaseSeconds
    ) { id status digest replayed }
  }
`)
const RecoverMachineRunOperation = adminGraphql(`
  mutation RecoverManagerSubtitleEvalMachineRun(
    $input: ManagerSubtitleEvalMachineRecoverRunInput!
  ) {
    recoverManagerSubtitleEvalMachineRun(input: $input) {
      id status digest replayed
    }
  }
`)
const VideoContextOperation = adminGraphql(`
  query ManagerSubtitleEvalVideoContext($videoId: ID!, $editionIdentity: String!) {
    managerSubtitleEvalVideoContext(
      videoId: $videoId
      editionIdentity: $editionIdentity
    ) {
      muxAssetId playbackId durationSeconds
    }
  }
`)

const corpusCellSchema = z
  .object({
    id: z.string(),
    caseId: z.string(),
    collectionKey: z.string(),
    videoId: z.string(),
    editionIdentity: z.string(),
    sourceLanguageId: z.string(),
    sourceLanguageSlug: z.string(),
    sourceTrackIdentity: z.string(),
    targetLanguageId: z.string(),
    targetLanguageSlug: z.string(),
    referenceTrackIdentity: z.string(),
    sourceSnapshotDigest: z.string(),
    sourceSnapshotRawDigest: z.string(),
    sourceSnapshotClippedDigest: z.string().nullable(),
    referenceSnapshotDigest: z.string(),
    referenceSnapshotRawDigest: z.string(),
    referenceSnapshotClippedDigest: z.string().nullable(),
    metadata: z.unknown(),
  })
  .strict()
export const subtitleEvalCorpusVersionSchema = z
  .object({
    id: z.string(),
    status: z.string(),
    identityDigest: z.string(),
    manifestDigest: z.string(),
    lockDigest: z.string(),
    authority: z.string(),
    certification: z.unknown(),
    supersedesVersionId: z.string().nullable(),
    approvedById: z.string().nullable(),
    approvedAt: z.string().nullable(),
    createdAt: z.string(),
    cells: z.array(corpusCellSchema).max(20),
  })
  .strict()

const terminalReportSchema = z
  .object({
    id: z.string(),
    status: z.string(),
    reportDigest: z.string(),
    reportArtifactDigest: z.string().nullable(),
    corpusIdentityDigest: z.string(),
    sourceReferenceDigests: z.unknown(),
    providerIdentities: z.unknown(),
    runtimeIdentity: z.unknown(),
    usage: z.unknown(),
    languageMetrics: z.unknown(),
    collectionMetrics: z.unknown(),
    artifactInventory: z.unknown(),
    reproducibilityLimits: z.array(z.string()),
    partialFailures: z.unknown(),
    completedAt: z.string(),
  })
  .strict()
const runCellSchema = z
  .object({
    id: z.string(),
    status: z.string(),
    attemptCount: z.number().int(),
    leaseGeneration: z.number().int(),
    errorCode: z.string().nullable(),
    errorRetryable: z.boolean().nullable(),
    resultDigest: z.string().nullable(),
    caseId: z.string(),
    collectionKey: z.string(),
    videoId: z.string(),
    targetLanguageId: z.string(),
    targetLanguageSlug: z.string(),
    machineMetrics: z.unknown().nullable(),
    providerRequestId: z.string().nullable(),
    providerResponseId: z.string().nullable(),
    assessmentDigest: z.string().nullable(),
    resolvedModel: z.string().nullable(),
    reproducibilityLimits: z.array(z.string().min(1).max(1_000)).max(100),
    artifactDigests: z.array(z.string()),
    assignmentCount: z.number().int(),
  })
  .strict()
export const subtitleEvalRunSchema = z
  .object({
    id: z.string(),
    status: z.string(),
    corpusVersionId: z.string(),
    requestedProvider: z.string(),
    requestedModel: z.string(),
    promptPolicyId: z.string(),
    workflowPolicyDigest: z.string(),
    codeRevision: z.string(),
    concurrency: z.number().int(),
    timeoutSeconds: z.number().int(),
    maxAttempts: z.number().int(),
    estimatedSpendMicros: z.string(),
    createdAt: z.string(),
    terminalAt: z.string().nullable(),
    cells: z.array(runCellSchema).max(20),
    terminalReport: terminalReportSchema.nullable(),
  })
  .strict()
const reviewerTrackSchema = z
  .object({
    label: z.enum(["SOURCE", "A", "B"]),
    contentId: z.string().min(1).max(191),
    mediaType: z.literal("text/vtt"),
  })
  .strict()
const postSubmitReceiptSchema = z
  .object({
    reviewId: z.string(),
    submittedAt: z.string(),
    referenceTrackLabel: z.enum(["A", "B"]),
    candidateTrackLabel: z.enum(["A", "B"]),
    machineAdvisoryRiskFlags: z.array(z.string().max(191)).max(100),
    resolvedModel: z.string().nullable(),
    assessmentDigest: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict()
const reviewerAssignmentSummarySchema = z
  .object({
    id: z.string().min(1).max(191),
    status: z.string().min(1).max(64),
    kind: z.string().min(1).max(64),
    round: z.number().int().positive().max(100),
    targetLanguageId: z.string().min(1).max(191),
    targetLanguageSlug: z.string().min(1).max(191),
    caseId: z.string().min(1).max(191),
    collectionKey: z.string().min(1).max(191),
    videoId: z.string().min(1).max(191),
    assignedAt: z.string().min(1).max(64),
    submittedAt: z.string().min(1).max(64).nullable(),
  })
  .strict()
const reviewerAssignmentPageSchema = z
  .object({
    nodes: z.array(reviewerAssignmentSummarySchema).max(50),
    nextCursor: z.string().min(1).max(191).nullable(),
  })
  .strict()
const runSummaryPageSchema = z
  .object({
    nodes: z
      .array(
        z
          .object({
            id: z.string().min(1).max(191),
            status: z.string().min(1).max(64),
            requestedProvider: z.string().min(1).max(40),
            requestedModel: z.string().min(1).max(160),
            promptPolicyId: z.string().min(1).max(191),
            codeRevision: z.string().min(1).max(191),
            cellCount: z.number().int().nonnegative().max(20),
            createdAt: z.string().min(1).max(64),
            terminalAt: z.string().min(1).max(64).nullable(),
          })
          .strict(),
      )
      .max(50),
    nextCursor: z.string().min(1).max(191).nullable(),
  })
  .strict()
const staleRunPageSchema = z
  .object({
    nodes: z
      .array(
        z
          .object({
            id: z.string().min(1).max(191),
            status: z.string().min(1).max(64),
            leaseGeneration: z.number().int().nonnegative(),
            leaseExpiresAt: z.string().min(1).max(64).nullable(),
            cellCount: z.number().int().nonnegative().max(20),
            updatedAt: z.string().min(1).max(64),
          })
          .strict(),
      )
      .max(50),
    nextCursor: z.string().min(1).max(191).nullable(),
  })
  .strict()
export const reviewerAssignmentDetailSchema = z
  .object({
    id: z.string(),
    status: z.string(),
    kind: z.string(),
    round: z.number().int(),
    targetLanguageId: z.string(),
    targetLanguageSlug: z.string(),
    caseId: z.string(),
    collectionKey: z.string(),
    videoId: z.string(),
    editionIdentity: z.string().min(1).max(191),
    clipStartSeconds: z.number().nonnegative().nullable(),
    clipEndSeconds: z.number().positive().nullable(),
    submitted: z.boolean(),
    postSubmitReceipt: postSubmitReceiptSchema.nullable(),
    sourceTrack: reviewerTrackSchema,
    trackA: reviewerTrackSchema,
    trackB: reviewerTrackSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.submitted !== (value.postSubmitReceipt != null)) {
      context.addIssue({
        code: "custom",
        path: ["postSubmitReceipt"],
        message: "Receipt provenance is available only after submission",
      })
    }
  })

const comparisonSchema = z
  .object({
    id: z.string(),
    baselineReportId: z.string(),
    candidateReportId: z.string(),
    changedAxis: z.string(),
    coverageLabel: z.string(),
    matchedCellCount: z.number().int().nonnegative(),
    matchedCollectionCount: z.number().int().nonnegative(),
    identityDifferences: z.unknown(),
    descriptiveDeltas: z.unknown(),
    humanEvidence: z.unknown(),
    unmatchedCells: z.unknown(),
    narratives: z
      .array(
        z
          .object({
            id: z.string(),
            version: z.number().int().positive(),
            hypothesis: z.string(),
            conclusion: z.string().nullable(),
            rationale: z.string().nullable(),
            followUpAction: z.string().nullable(),
            createdById: z.string(),
            createdAt: z.string(),
          })
          .strict(),
      )
      .max(100),
  })
  .strict()
const referenceIssuePageSchema = z
  .object({
    nodes: z
      .array(
        z
          .object({
            id: z.string(),
            status: z.string(),
            reviewId: z.string(),
            corpusCellId: z.string(),
            caseId: z.string(),
            collectionKey: z.string(),
            targetLanguageId: z.string(),
            targetLanguageSlug: z.string(),
            dispositionReason: z.string().nullable(),
            correctedCorpusVersionId: z.string().nullable(),
            createdAt: z.string(),
          })
          .strict(),
      )
      .max(50),
    nextCursor: z.string().nullable(),
  })
  .strict()
const operatorReviewerCandidatePageSchema = z
  .object({
    nodes: z
      .array(
        z
          .object({
            membershipId: z.string(),
            displayName: z.string(),
            email: z.string(),
            targetLanguageId: z.string(),
            targetLanguageSlug: z.string(),
            qualificationVersion: z.number().int().positive(),
            rubricDimensions: z.array(z.string()).max(20),
            specialistCapabilities: z.array(z.string()).max(2),
            activeAssignmentCount: z.number().int().nonnegative(),
          })
          .strict(),
      )
      .max(50),
    nextCursor: z.string().nullable(),
  })
  .strict()
const operatorAssignmentPageSchema = z
  .object({
    nodes: z
      .array(
        z
          .object({
            id: z.string(),
            runCellId: z.string(),
            status: z.string(),
            kind: z.string(),
            round: z.number().int().positive(),
            specialistDimension: z.string().nullable(),
            reviewerMembershipId: z.string().nullable(),
            reviewerDisplayName: z.string().nullable(),
            reviewerEmail: z.string().nullable(),
            assignedAt: z.string(),
            submittedAt: z.string().nullable(),
            latestVerdict: z.string().nullable(),
          })
          .strict(),
      )
      .max(100),
    nextCursor: z.string().nullable(),
  })
  .strict()
const operatorNamedTrackSchema = z
  .object({
    label: z.enum(["SOURCE", "REFERENCE", "CANDIDATE"]),
    contentId: z.string().regex(/^[a-f0-9]{64}$/),
    mediaType: z.literal("text/vtt"),
  })
  .strict()
export const operatorAssignmentDetailSchema = z
  .object({
    id: z.string(),
    status: z.string(),
    kind: z.string(),
    round: z.number().int().positive(),
    specialistDimension: z.string().nullable(),
    targetLanguageId: z.string(),
    targetLanguageSlug: z.string(),
    reviewerMembershipId: z.string().nullable(),
    reviewerDisplayName: z.string().nullable(),
    reviewerEmail: z.string().nullable(),
    caseId: z.string(),
    collectionKey: z.string(),
    videoId: z.string(),
    editionIdentity: z.string(),
    clipStartSeconds: z.number().nonnegative().nullable(),
    clipEndSeconds: z.number().positive().nullable(),
    sourceTrack: operatorNamedTrackSchema,
    referenceTrack: operatorNamedTrackSchema,
    candidateTrack: operatorNamedTrackSchema,
    referenceTrackLabel: z.enum(["A", "B"]),
    candidateTrackLabel: z.enum(["A", "B"]),
    machineAssessment: z.unknown().nullable(),
    reviews: z.array(z.unknown()).max(100),
  })
  .strict()

type FetchLike = typeof fetch
type BearerProvider = string | ((resourceUrl: string) => Promise<string>)
type GraphqlResponse<T> = { data?: T; errors?: unknown[] }

export class SubtitleLabAdminClient {
  constructor(
    private readonly options: {
      graphqlUrl: string
      graphqlBearer: BearerProvider
      oauthBearer: BearerProvider
      fetchImpl?: FetchLike
    },
  ) {}

  static async configured(fetchImpl?: FetchLike) {
    if (!env.ADMIN_GRAPHQL_URL) {
      throw new Error("Admin GraphQL Manager backend is not configured.")
    }
    return new SubtitleLabAdminClient({
      graphqlUrl: env.ADMIN_GRAPHQL_URL,
      graphqlBearer: () => getAdminManagerServiceBearer(),
      oauthBearer: () => getAdminManagerOAuthBearer(),
      fetchImpl,
    })
  }

  async getCorpusVersion(id: string) {
    const data = await this.request(CorpusOperation, { id })
    const value = data.managerSubtitleEvalCorpusVersion
    return value ? subtitleEvalCorpusVersionSchema.parse(value) : null
  }

  async approveCorpus(
    session: ManagerSessionPrincipal,
    payload: Omit<
      AdminVariablesOf<typeof ApproveCorpusOperation>["input"],
      "assertion"
    >,
  ) {
    const assertion = await this.delegation(session, "APPROVE_CORPUS", payload)
    const data = await this.request(ApproveCorpusOperation, {
      input: { ...payload, assertion },
    })
    return operationResultSchema.parse(data.approveManagerSubtitleEvalCorpus)
  }

  async getRun(id: string) {
    const data = await this.request(RunOperation, { id })
    const value = data.managerSubtitleEvalRun
    return value ? subtitleEvalRunSchema.parse(value) : null
  }

  async listRuns(limit = 25, after?: string) {
    const data = await this.request(RunsOperation, { limit, after })
    return runSummaryPageSchema.parse(data.managerSubtitleEvalRuns)
  }

  async listStaleRuns(limit = 25, after?: string) {
    const data = await this.request(StaleRunsOperation, { limit, after })
    return staleRunPageSchema.parse(data.managerSubtitleEvalStaleRuns)
  }

  async getComparison(id: string) {
    const data = await this.request(ComparisonOperation, { id })
    const value = data.managerSubtitleEvalComparison
    return value ? comparisonSchema.parse(value) : null
  }

  async createComparison(
    session: ManagerSessionPrincipal,
    payload: Omit<
      AdminVariablesOf<typeof CreateComparisonOperation>["input"],
      "assertion"
    >,
  ) {
    const assertion = await this.delegation(
      session,
      "CREATE_COMPARISON",
      payload,
    )
    const data = await this.request(CreateComparisonOperation, {
      input: { ...payload, assertion },
    })
    return operationResultSchema.parse(data.createManagerSubtitleEvalComparison)
  }

  async appendNarrative(
    session: ManagerSessionPrincipal,
    payload: Omit<
      AdminVariablesOf<typeof AppendNarrativeOperation>["input"],
      "assertion"
    >,
  ) {
    const assertion = await this.delegation(
      session,
      "APPEND_NARRATIVE",
      payload,
    )
    const data = await this.request(AppendNarrativeOperation, {
      input: { ...payload, assertion },
    })
    return operationResultSchema.parse(data.appendManagerSubtitleEvalNarrative)
  }

  async listReferenceIssues(
    status?: "OPEN" | "ACCEPTED" | "REJECTED",
    limit = 25,
    after?: string,
  ) {
    const data = await this.request(ReferenceIssuesOperation, {
      status,
      limit,
      after,
    })
    return referenceIssuePageSchema.parse(
      data.managerSubtitleEvalReferenceIssues,
    )
  }

  async dispositionReferenceIssue(
    session: ManagerSessionPrincipal,
    payload: Omit<
      AdminVariablesOf<typeof DispositionReferenceIssueOperation>["input"],
      "assertion"
    >,
  ) {
    const assertion = await this.delegation(
      session,
      "DISPOSITION_REFERENCE_ISSUE",
      payload,
    )
    const data = await this.request(DispositionReferenceIssueOperation, {
      input: { ...payload, assertion },
    })
    return operationResultSchema.parse(
      data.dispositionManagerSubtitleEvalReferenceIssue,
    )
  }

  async listOperatorReviewerCandidates(
    targetLanguageId: string,
    targetLanguageSlug: string,
    specialistDimension?: string,
    limit = 25,
    after?: string,
  ) {
    const data = await this.request(OperatorReviewerCandidatesOperation, {
      targetLanguageId,
      targetLanguageSlug,
      specialistDimension,
      limit,
      after,
    })
    return operatorReviewerCandidatePageSchema.parse(
      data.managerSubtitleEvalOperatorReviewerCandidates,
    )
  }

  async listOperatorAssignments(
    runId: string,
    runCellId?: string,
    limit = 50,
    after?: string,
  ) {
    const data = await this.request(OperatorAssignmentsOperation, {
      runId,
      runCellId,
      limit,
      after,
    })
    return operatorAssignmentPageSchema.parse(
      data.managerSubtitleEvalOperatorAssignments,
    )
  }

  async getOperatorAssignment(assignmentId: string) {
    const data = await this.request(OperatorAssignmentOperation, {
      assignmentId,
    })
    const value = data.managerSubtitleEvalOperatorAssignment
    return value ? operatorAssignmentDetailSchema.parse(value) : null
  }

  async assignSpecialist(
    session: ManagerSessionPrincipal,
    payload: Omit<
      AdminVariablesOf<typeof AssignSpecialistOperation>["input"],
      "assertion"
    >,
  ) {
    const assertion = await this.delegation(
      session,
      "ASSIGN_SPECIALIST",
      payload,
    )
    const data = await this.request(AssignSpecialistOperation, {
      input: { ...payload, assertion },
    })
    return operationResultSchema.parse(data.assignManagerSubtitleEvalSpecialist)
  }

  async importCorpus(
    session: ManagerSessionPrincipal,
    payload: Omit<
      AdminVariablesOf<typeof ImportCorpusOperation>["input"],
      "assertion"
    >,
  ) {
    const assertion = await this.delegation(session, "IMPORT_CORPUS", payload)
    const data = await this.request(ImportCorpusOperation, {
      input: { ...payload, assertion },
    })
    return operationResultSchema.parse(data.importManagerSubtitleEvalCorpus)
  }

  async createRun(
    session: ManagerSessionPrincipal,
    payload: Omit<
      AdminVariablesOf<typeof CreateRunOperation>["input"],
      "assertion"
    >,
  ) {
    const assertion = await this.delegation(session, "CREATE_RUN", payload)
    const data = await this.request(CreateRunOperation, {
      input: { ...payload, assertion },
    })
    return operationResultSchema.parse(data.createManagerSubtitleEvalRun)
  }

  async claimCell(runCellId: string, leaseSeconds: number) {
    const data = await this.request(ClaimCellOperation, {
      runCellId,
      leaseSeconds,
    })
    return operationResultSchema.parse(data.claimManagerSubtitleEvalCell)
  }

  async finalizeCell(
    input: AdminVariablesOf<typeof FinalizeCellOperation>["input"],
  ) {
    const data = await this.request(FinalizeCellOperation, { input })
    return operationResultSchema.parse(data.finalizeManagerSubtitleEvalCell)
  }

  async failCell(input: AdminVariablesOf<typeof FailCellOperation>["input"]) {
    const data = await this.request(FailCellOperation, { input })
    return operationResultSchema.parse(data.failManagerSubtitleEvalCell)
  }

  async finalizeRun(
    input: AdminVariablesOf<typeof FinalizeRunOperation>["input"],
  ) {
    const data = await this.request(FinalizeRunOperation, { input })
    return operationResultSchema.parse(data.finalizeManagerSubtitleEvalRun)
  }

  async createAssignment(
    session: ManagerSessionPrincipal,
    payload: Omit<
      AdminVariablesOf<typeof CreateAssignmentOperation>["input"],
      "assertion"
    >,
  ) {
    const assertion = await this.delegation(
      session,
      "CREATE_ASSIGNMENT",
      payload,
    )
    const data = await this.request(CreateAssignmentOperation, {
      input: { ...payload, assertion },
    })
    return operationResultSchema.parse(data.createManagerSubtitleEvalAssignment)
  }

  async reviewerQueue(
    session: ManagerSessionPrincipal,
    limit = 25,
    after?: string,
  ) {
    const payload = { limit, after: after ?? null }
    const assertion = await this.delegation(
      session,
      "REVIEWER_QUEUE",
      payload,
      "GET",
    )
    const data = await this.request(ReviewerQueueOperation, {
      assertion,
      limit,
      after,
    })
    return reviewerAssignmentPageSchema.parse(
      data.managerSubtitleEvalReviewerAssignments,
    )
  }

  async reviewerDetail(session: ManagerSessionPrincipal, assignmentId: string) {
    const assertion = await this.reviewAssertion(
      session,
      assignmentId,
      "GET",
      sha256Bytes(""),
    )
    const data = await this.request(ReviewerDetailOperation, {
      assignmentId,
      assertion,
    })
    const value = data.managerSubtitleEvalReviewerAssignment
    return value ? reviewerAssignmentDetailSchema.parse(value) : null
  }

  async submitReview(session: ManagerSessionPrincipal, rawInput: unknown) {
    const input = normalizeReviewSubmission(rawInput)
    const bodyDigest = canonicalReviewSubmissionDigest(input)
    const assertion = await this.reviewAssertion(
      session,
      input.assignmentId,
      "POST",
      bodyDigest,
    )
    const data = await this.request(SubmitReviewOperation, {
      input: { ...input, bodyDigest, assertion },
    })
    return operationResultSchema.parse(data.submitManagerSubtitleEvalReview)
  }

  async reviewerTrackLocator(
    session: ManagerSessionPrincipal,
    assignmentId: string,
    contentId: string,
  ) {
    const logicalBody = { assignmentId, contentId }
    const assertion = await this.reviewAssertion(
      session,
      assignmentId,
      "GET",
      canonicalDigest(logicalBody),
    )
    const locatorUrl = new URL(
      "/api/manager/subtitle-eval/reviewer-track",
      this.options.graphqlUrl,
    ).toString()
    const response = await (this.options.fetchImpl ?? fetch)(locatorUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${await this.oauthBearer(locatorUrl)}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ ...logicalBody, assertion }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) return null
    const rawPayload = await readBoundedJson(
      response,
      MAX_ADMIN_LOCATOR_RESPONSE_BYTES,
    ).catch(() => undefined)
    const parsed = z
      .object({
        locator: z
          .object({
            objectKey: z.string().min(1).max(1_024),
            mediaType: z.string().min(1).max(191),
            byteLength: z.string().regex(/^\d+$/),
            sha256: z.string().regex(/^[a-f0-9]{64}$/),
          })
          .strict(),
      })
      .strict()
      .safeParse(rawPayload)
    if (!parsed.success) return null
    const byteLength = Number(parsed.data.locator.byteLength)
    if (
      !Number.isSafeInteger(byteLength) ||
      byteLength > MAX_SUBTITLE_EVAL_ARTIFACT_BYTES
    ) {
      return null
    }
    return parsed.data.locator
  }

  async operatorTrackLocator(assignmentId: string, contentId: string) {
    const locatorUrl = new URL(
      "/api/manager/subtitle-eval/operator-track",
      this.options.graphqlUrl,
    ).toString()
    const response = await (this.options.fetchImpl ?? fetch)(locatorUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${await this.oauthBearer(locatorUrl)}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ assignmentId, contentId }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) return null
    const rawPayload = await readBoundedJson(
      response,
      MAX_ADMIN_LOCATOR_RESPONSE_BYTES,
    ).catch(() => undefined)
    const parsed = z
      .object({
        locator: z
          .object({
            objectKey: z.string().min(1).max(1_024),
            mediaType: z.literal("text/vtt"),
            byteLength: z.string().regex(/^\d+$/),
            sha256: z.string().regex(/^[a-f0-9]{64}$/),
          })
          .strict(),
      })
      .strict()
      .safeParse(rawPayload)
    if (!parsed.success) return null
    const byteLength = Number(parsed.data.locator.byteLength)
    if (
      !Number.isSafeInteger(byteLength) ||
      byteLength > MAX_SUBTITLE_EVAL_ARTIFACT_BYTES
    ) {
      return null
    }
    return parsed.data.locator
  }

  async claimMachineRecovery(runId: string, leaseSeconds: number) {
    const data = await this.request(ClaimMachineRecoveryOperation, {
      runId,
      leaseSeconds,
    })
    return operationResultSchema.parse(
      data.claimManagerSubtitleEvalMachineRecovery,
    )
  }

  async recoverMachineRun(input: {
    runId: string
    leaseGeneration: number
    leaseToken: string
    dispatchFailed?: boolean
  }) {
    const data = await this.request(RecoverMachineRunOperation, { input })
    return operationResultSchema.parse(
      data.recoverManagerSubtitleEvalMachineRun,
    )
  }

  async getVideoPlaybackCandidate(videoId: string, editionIdentity: string) {
    const data = await this.request(VideoContextOperation, {
      videoId,
      editionIdentity,
    })
    const value = data.managerSubtitleEvalVideoContext
    return value
      ? z
          .object({
            muxAssetId: z.string().min(1).max(191),
            playbackId: z.string().min(1).max(191),
            durationSeconds: z.number().nonnegative().nullable(),
          })
          .strict()
          .parse(value)
      : null
  }

  private async delegation(
    session: ManagerSessionPrincipal,
    operation: string,
    payload: unknown,
    method: "GET" | "POST" = "POST",
  ) {
    const bodyDigest = canonicalDigest(payload)
    const managerSessionProof = await createSubtitleEvalSessionProof({
      actorId: session.id,
      authSubject: session.subject,
      operation,
      method,
      bodyDigest,
    })
    const response = await this.exchangeSession(session, {
      subtitleEvalDelegationRequest: {
        operation,
        method,
        bodyDigest,
        requestId: randomUUID(),
        managerSessionProof,
      },
    })
    const assertion = response.subtitleEvalDelegation
    if (typeof assertion !== "string") throw new Error("Delegation was denied.")
    return assertion
  }

  private async reviewAssertion(
    session: ManagerSessionPrincipal,
    assignmentId: string,
    method: "GET" | "POST",
    bodyDigest: string,
  ) {
    const managerSessionProof = await createSubtitleEvalSessionProof({
      actorId: session.id,
      authSubject: session.subject,
      assignmentId,
      method,
      bodyDigest,
    })
    const response = await this.exchangeSession(session, {
      reviewerAssertionRequest: {
        assignmentId,
        method,
        bodyDigest,
        requestId: randomUUID(),
        managerSessionProof,
      },
    })
    const assertion = response.reviewerAssertion
    if (typeof assertion !== "string")
      throw new Error("Review access was denied.")
    return assertion
  }

  private async exchangeSession(
    session: ManagerSessionPrincipal,
    request: Record<string, unknown>,
  ) {
    const sessionUrl = new URL(
      "/api/manager/session",
      this.options.graphqlUrl,
    ).toString()
    const response = await (this.options.fetchImpl ?? fetch)(sessionUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${await this.oauthBearer(sessionUrl)}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        subject: session.subject,
        email: session.email,
        ...(session.name ? { name: session.name } : {}),
        ...request,
      }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) throw new Error("Fresh Manager session proof was denied.")
    return z
      .object({
        reviewerAssertion: z.string().optional(),
        subtitleEvalDelegation: z.string().optional(),
      })
      .passthrough()
      .parse(await readBoundedJson(response, MAX_ADMIN_SESSION_RESPONSE_BYTES))
  }

  private oauthBearer(resourceUrl: string) {
    return typeof this.options.oauthBearer === "string"
      ? Promise.resolve(this.options.oauthBearer)
      : this.options.oauthBearer(resourceUrl)
  }

  private graphqlBearer() {
    return typeof this.options.graphqlBearer === "string"
      ? Promise.resolve(this.options.graphqlBearer)
      : this.options.graphqlBearer(this.options.graphqlUrl)
  }

  private async request<TDocument extends Parameters<typeof print>[0]>(
    operation: TDocument,
    variables: Record<string, unknown>,
  ): Promise<AdminResultOf<TDocument>> {
    const response = await (this.options.fetchImpl ?? fetch)(
      this.options.graphqlUrl,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${await this.graphqlBearer()}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ query: print(operation), variables }),
        signal: AbortSignal.timeout(15_000),
      },
    )
    if (!response.ok)
      throw new Error(`Admin GraphQL returned ${response.status}.`)
    const payload = (await readBoundedJson(
      response,
      MAX_ADMIN_GRAPHQL_RESPONSE_BYTES,
    )) as GraphqlResponse<AdminResultOf<TDocument>>
    if (payload.errors?.length || !payload.data) {
      throw new Error("Admin GraphQL request failed.")
    }
    return payload.data
  }
}

async function readBoundedJson(response: Response, maximumBytes: number) {
  const contentLength = response.headers.get("content-length")
  if (contentLength != null) {
    const declaredLength = Number(contentLength)
    if (
      !Number.isSafeInteger(declaredLength) ||
      declaredLength > maximumBytes
    ) {
      await response.body?.cancel().catch(() => undefined)
      throw new Error("Admin response exceeded the byte ceiling.")
    }
  }
  if (!response.body) throw new Error("Admin response body was empty.")
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let byteLength = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    byteLength += value.byteLength
    if (byteLength > maximumBytes) {
      await reader.cancel().catch(() => undefined)
      throw new Error("Admin response exceeded the byte ceiling.")
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(byteLength)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown
}

export function parseLeaseDigest(digest: string | null | undefined) {
  if (!digest) return null
  const [leaseDigest, executionAttempt] = digest.split("#")
  if (!leaseDigest) return null
  const [generation, token, ...expires] = leaseDigest.split(":")
  const parsed = z
    .object({
      generation: z.coerce.number().int().positive(),
      executionAttempt: z.coerce.number().int().positive(),
      token: z.string().min(1).max(191),
      expiresAt: z.string().datetime(),
    })
    .safeParse({
      generation,
      executionAttempt: executionAttempt ?? generation,
      token,
      expiresAt: expires.join(":"),
    })
  return parsed.success ? parsed.data : null
}
