export type SubtitleLabCorpusCell = {
  id: string
  caseId: string
  collectionKey: string
  videoId: string
  editionIdentity: string
  sourceLanguageId: string
  sourceLanguageSlug: string
  sourceTrackIdentity: string
  targetLanguageId: string
  targetLanguageSlug: string
  referenceTrackIdentity: string
  sourceSnapshotDigest: string
  sourceSnapshotRawDigest: string
  sourceSnapshotClippedDigest: string | null
  referenceSnapshotDigest: string
  referenceSnapshotRawDigest: string
  referenceSnapshotClippedDigest: string | null
  metadata: unknown
}

export type SubtitleLabCorpusVersion = {
  id: string
  status: string
  identityDigest: string
  manifestDigest: string
  lockDigest: string
  authority: string
  certification: unknown
  supersedesVersionId: string | null
  approvedById: string | null
  approvedAt: string | null
  createdAt: string
  cells: SubtitleLabCorpusCell[]
}

export type SubtitleLabRunSummary = {
  id: string
  status: string
  requestedProvider: string
  requestedModel: string
  promptPolicyId: string
  codeRevision: string
  cellCount: number
  createdAt: string
  terminalAt: string | null
}

export type SubtitleLabRunCell = {
  id: string
  status: string
  attemptCount: number
  leaseGeneration: number
  errorCode: string | null
  errorRetryable: boolean | null
  resultDigest: string | null
  caseId: string
  collectionKey: string
  videoId: string
  targetLanguageId: string
  targetLanguageSlug: string
  machineMetrics: unknown | null
  providerRequestId: string | null
  providerResponseId: string | null
  assessmentDigest: string | null
  resolvedModel: string | null
  artifactDigests: string[]
  assignmentCount: number
}

export type SubtitleLabTerminalReport = {
  id: string
  status: string
  reportDigest: string
  reportArtifactDigest: string | null
  corpusIdentityDigest: string
  sourceReferenceDigests: unknown
  providerIdentities: unknown
  runtimeIdentity: unknown
  usage: unknown
  languageMetrics: unknown
  collectionMetrics: unknown
  artifactInventory: unknown
  reproducibilityLimits: string[]
  partialFailures: unknown
  completedAt: string
}

export type SubtitleLabRun = {
  id: string
  status: string
  corpusVersionId: string
  requestedProvider: string
  requestedModel: string
  promptPolicyId: string
  workflowPolicyDigest: string
  codeRevision: string
  concurrency: number
  timeoutSeconds: number
  maxAttempts: number
  estimatedSpendMicros: string
  createdAt: string
  terminalAt: string | null
  cells: SubtitleLabRunCell[]
  terminalReport: SubtitleLabTerminalReport | null
}

export type SubtitleLabNarrative = {
  id: string
  version: number
  hypothesis: string
  conclusion: string | null
  rationale: string | null
  followUpAction: string | null
  createdById: string
  createdAt: string
}

export type SubtitleLabComparison = {
  id: string
  baselineReportId: string
  candidateReportId: string
  changedAxis: string
  coverageLabel: string
  matchedCellCount: number
  matchedCollectionCount: number
  descriptiveDeltas: unknown
  humanEvidence: unknown
  identityDifferences: unknown
  unmatchedCells: unknown
  narratives: SubtitleLabNarrative[]
}

export type SubtitleLabReferenceIssue = {
  id: string
  status: string
  corpusCellId: string
  reviewId: string
  caseId: string
  collectionKey: string
  targetLanguageId: string
  targetLanguageSlug: string
  dispositionReason: string | null
  correctedCorpusVersionId: string | null
  createdAt: string
}

export type SubtitleLabAssignmentProgress = {
  id: string
  runCellId: string
  status: string
  kind: string
  round: number
  reviewerMembershipId: string | null
  reviewerDisplayName: string | null
  reviewerEmail: string | null
  assignedAt: string
  submittedAt: string | null
  latestVerdict: string | null
  specialistDimension: string | null
}

export type SubtitleLabReviewerCandidate = {
  membershipId: string
  displayName: string
  email: string
  targetLanguageId: string
  targetLanguageSlug: string
  qualificationVersion: number
  rubricDimensions: string[]
  specialistCapabilities: string[]
  activeAssignmentCount: number
}
