export const WATCH_SEARCH_CANDIDATE_REQUIRED_EVIDENCE_GATES = [
  "relevance",
  "fixedLoadResources",
  "exactKeyRam",
  "incrementalNonVectorDisk",
  "steadyCapacity",
  "peakCapacity",
  "swapAndFreeDisk",
  "buildImportDuration",
  "currentInterference",
  "operatorReview",
] as const

export type CandidateQualificationEvidenceGate =
  (typeof WATCH_SEARCH_CANDIDATE_REQUIRED_EVIDENCE_GATES)[number]

export type CandidateQualificationEvidenceStatus = "PASS" | "FAIL" | "NOT_RUN"

export const WATCH_SEARCH_CANDIDATE_OPERATOR_ACCEPTANCE_SCHEMA =
  "watch-search-candidate-operator-acceptance/v1" as const
export const WATCH_SEARCH_CANDIDATE_OPERATOR_ACCEPTANCE_MAX_BYTES =
  8 * 1024 * 1024

export type CandidateOperatorAcceptanceBundle = Readonly<{
  schemaVersion: typeof WATCH_SEARCH_CANDIDATE_OPERATOR_ACCEPTANCE_SCHEMA
  decisionId: string
  status: "OPERATOR_ACCEPTED"
  identity: Readonly<{
    generationId: string
    indexContractRevision: string
    rankingRevision: string
    transcriptCollection: string
    contentEmbeddingContractId: string
    transcriptChunkingVersion: string
    transcriptProjectionRevision: string
    qrelsRevision: string
    currentBindings: readonly string[]
    candidateBindings: Readonly<{
      catalog: string
      availability: string
      lexical: string
      transcript: string
    }>
  }>
  measurements: Readonly<{
    relevance: Readonly<{
      cases: number
      usefulOrExcellentPercent: number
      unacceptablePercent: number
    }>
    latency: Readonly<{
      callerP95Ms: number
      adminP95Ms: number
    }>
  }>
  waivedGates: readonly Readonly<{
    gate: string
    observed: string
    reason: string
  }>[]
  knownLimitations: readonly string[]
  acceptanceReason: string
  rawMastraOutputs: Readonly<Record<string, unknown>>
  userAcceptance: Readonly<{
    acceptedAt: string
    reviewerIdentity: string
    statement: string
  }>
  reviewTrail: Readonly<{
    pullRequest: Readonly<{
      number: number
      url: string
      mergedAt: string
      mergeCommitSha: string
    }>
    commits: readonly Readonly<{ sha: string }>[]
  }>
}>

export type CandidateQualificationEvidence = Record<
  CandidateQualificationEvidenceGate,
  CandidateQualificationEvidenceStatus
> & {
  artifacts?: Readonly<
    Partial<Record<CandidateQualificationEvidenceGate, string>>
  >
}

export const DEFAULT_CANDIDATE_QUALIFICATION_EVIDENCE: CandidateQualificationEvidence =
  {
    relevance: "NOT_RUN",
    fixedLoadResources: "NOT_RUN",
    exactKeyRam: "NOT_RUN",
    incrementalNonVectorDisk: "NOT_RUN",
    steadyCapacity: "NOT_RUN",
    peakCapacity: "NOT_RUN",
    swapAndFreeDisk: "NOT_RUN",
    buildImportDuration: "NOT_RUN",
    currentInterference: "NOT_RUN",
    operatorReview: "NOT_RUN",
  }

export class CandidateQualificationConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "CandidateQualificationConfigurationError"
  }
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function acceptanceError(message: string): never {
  throw new CandidateQualificationConfigurationError(
    `operator acceptance bundle ${message}`,
  )
}

function acceptanceObject(
  value: unknown,
  name: string,
): Record<string, unknown> {
  return recordValue(value) ?? acceptanceError(`${name} must be an object`)
}

function acceptanceString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    return acceptanceError(`${name} is required`)
  }
  const normalized = value.trim()
  if (/\p{Cc}/u.test(normalized)) {
    return acceptanceError(`${name} contains control characters`)
  }
  return normalized
}

function acceptanceDate(value: unknown, name: string): string {
  const normalized = acceptanceString(value, name)
  if (!Number.isFinite(Date.parse(normalized))) {
    return acceptanceError(`${name} must be a valid date`)
  }
  return normalized
}

function acceptanceStrings(value: unknown, name: string): readonly string[] {
  if (!Array.isArray(value) || value.length === 0) {
    return acceptanceError(`${name} must be a non-empty array`)
  }
  return value.map((entry, index) =>
    acceptanceString(entry, `${name}[${index}]`),
  )
}

function acceptanceNumber(
  value: unknown,
  name: string,
  options: { integer?: boolean; min: number; max?: number },
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < options.min ||
    (options.max !== undefined && value > options.max) ||
    (options.integer === true && !Number.isSafeInteger(value))
  ) {
    return acceptanceError(`${name} is invalid`)
  }
  return value
}

function acceptanceIdentity(value: unknown, decisionId: string) {
  const identity = acceptanceObject(value, "identity")
  const currentBindings = acceptanceStrings(
    identity.currentBindings,
    "identity.currentBindings",
  )
  if (currentBindings.length !== 4 || new Set(currentBindings).size !== 4) {
    return acceptanceError(
      "identity.currentBindings must contain four distinct collections",
    )
  }
  const candidateBindings = acceptanceObject(
    identity.candidateBindings,
    "identity.candidateBindings",
  )
  const expectedCandidateBindingKeys = [
    "availability",
    "catalog",
    "lexical",
    "transcript",
  ]
  if (
    Object.keys(candidateBindings).sort().join(",") !==
    expectedCandidateBindingKeys.join(",")
  ) {
    return acceptanceError(
      "identity.candidateBindings must contain catalog, availability, lexical, and transcript",
    )
  }
  const transcriptProjectionRevision = acceptanceString(
    identity.transcriptProjectionRevision,
    "identity.transcriptProjectionRevision",
  )
  if (!/^\d+$/.test(transcriptProjectionRevision)) {
    return acceptanceError(
      "identity.transcriptProjectionRevision must be a non-negative integer",
    )
  }
  const qrelsRevision = acceptanceString(
    identity.qrelsRevision,
    "identity evaluation revision",
  )
  if (qrelsRevision !== `none:operator-accepted:${decisionId}`) {
    return acceptanceError(
      "identity evaluation revision must bind the exact decision ID",
    )
  }
  return {
    generationId: acceptanceString(
      identity.generationId,
      "identity.generationId",
    ),
    indexContractRevision: acceptanceString(
      identity.indexContractRevision,
      "identity.indexContractRevision",
    ),
    rankingRevision: acceptanceString(
      identity.rankingRevision,
      "identity.rankingRevision",
    ),
    transcriptCollection: acceptanceString(
      identity.transcriptCollection,
      "identity.transcriptCollection",
    ),
    contentEmbeddingContractId: acceptanceString(
      identity.contentEmbeddingContractId,
      "identity.contentEmbeddingContractId",
    ),
    transcriptChunkingVersion: acceptanceString(
      identity.transcriptChunkingVersion,
      "identity.transcriptChunkingVersion",
    ),
    transcriptProjectionRevision,
    qrelsRevision,
    currentBindings,
    candidateBindings: {
      catalog: acceptanceString(
        candidateBindings.catalog,
        "identity.candidateBindings.catalog",
      ),
      availability: acceptanceString(
        candidateBindings.availability,
        "identity.candidateBindings.availability",
      ),
      lexical: acceptanceString(
        candidateBindings.lexical,
        "identity.candidateBindings.lexical",
      ),
      transcript: acceptanceString(
        candidateBindings.transcript,
        "identity.candidateBindings.transcript",
      ),
    },
  }
}

export function parseCandidateOperatorAcceptanceBundle(
  value: unknown,
): CandidateOperatorAcceptanceBundle {
  const bundle = acceptanceObject(value, "root")
  if (
    bundle.schemaVersion !== WATCH_SEARCH_CANDIDATE_OPERATOR_ACCEPTANCE_SCHEMA
  ) {
    return acceptanceError(
      `schemaVersion must be ${WATCH_SEARCH_CANDIDATE_OPERATOR_ACCEPTANCE_SCHEMA}`,
    )
  }
  if (bundle.status !== "OPERATOR_ACCEPTED") {
    return acceptanceError("status must be OPERATOR_ACCEPTED")
  }
  const decisionId = acceptanceString(bundle.decisionId, "decisionId")
  // qrels_revision is varchar(128); the fixed prefix consumes 23 bytes.
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,104}$/.test(decisionId)) {
    return acceptanceError("decisionId has an invalid format")
  }
  const measurements = acceptanceObject(bundle.measurements, "measurements")
  const relevance = acceptanceObject(
    measurements.relevance,
    "measurements.relevance",
  )
  const latency = acceptanceObject(measurements.latency, "measurements.latency")
  const normalizedRelevance = {
    cases: acceptanceNumber(relevance.cases, "measurements.relevance.cases", {
      integer: true,
      min: 1,
    }),
    usefulOrExcellentPercent: acceptanceNumber(
      relevance.usefulOrExcellentPercent,
      "measurements.relevance.usefulOrExcellentPercent",
      { min: 0, max: 100 },
    ),
    unacceptablePercent: acceptanceNumber(
      relevance.unacceptablePercent,
      "measurements.relevance.unacceptablePercent",
      { min: 0, max: 100 },
    ),
  }
  const normalizedLatency = {
    callerP95Ms: acceptanceNumber(
      latency.callerP95Ms,
      "measurements.latency.callerP95Ms",
      { min: 0 },
    ),
    adminP95Ms: acceptanceNumber(
      latency.adminP95Ms,
      "measurements.latency.adminP95Ms",
      { min: 0 },
    ),
  }
  if (!Array.isArray(bundle.waivedGates) || bundle.waivedGates.length === 0) {
    return acceptanceError("waivedGates must be a non-empty array")
  }
  const waivedGates = bundle.waivedGates.map((entry, index) => {
    const gate = acceptanceObject(entry, `waivedGates[${index}]`)
    const observed = acceptanceString(
      gate.observed,
      `waivedGates[${index}].observed`,
    )
    if (observed !== "FAIL" && observed !== "NOT_RUN") {
      return acceptanceError(
        `waivedGates[${index}].observed must be FAIL or NOT_RUN`,
      )
    }
    return {
      gate: acceptanceString(gate.gate, `waivedGates[${index}].gate`),
      observed,
      reason: acceptanceString(gate.reason, `waivedGates[${index}].reason`),
    }
  })
  const rawMastraOutputs = acceptanceObject(
    bundle.rawMastraOutputs,
    "rawMastraOutputs",
  )
  if (Object.keys(rawMastraOutputs).length === 0) {
    return acceptanceError("rawMastraOutputs must be non-empty")
  }
  for (const run of ["development", "heldOut"] as const) {
    const output = acceptanceObject(
      rawMastraOutputs[run],
      `rawMastraOutputs.${run}`,
    )
    if (Object.keys(output).length === 0) {
      return acceptanceError(`rawMastraOutputs.${run} must be non-empty`)
    }
  }
  const userAcceptance = acceptanceObject(
    bundle.userAcceptance,
    "userAcceptance",
  )
  const reviewTrail = acceptanceObject(bundle.reviewTrail, "reviewTrail")
  const pullRequest = acceptanceObject(
    reviewTrail.pullRequest,
    "reviewTrail.pullRequest",
  )
  if (
    typeof pullRequest.number !== "number" ||
    !Number.isSafeInteger(pullRequest.number) ||
    pullRequest.number <= 0
  ) {
    return acceptanceError(
      "reviewTrail.pullRequest.number must be a positive safe integer",
    )
  }
  const pullRequestUrl = acceptanceString(
    pullRequest.url,
    "reviewTrail.pullRequest.url",
  )
  if (!/^https:\/\/github\.com\//.test(pullRequestUrl)) {
    return acceptanceError("reviewTrail.pullRequest.url must be a GitHub URL")
  }
  if (
    !new RegExp(
      `^https://github\\.com/[^/]+/[^/]+/pull/${pullRequest.number}/?$`,
    ).test(pullRequestUrl)
  ) {
    return acceptanceError(
      "reviewTrail.pullRequest.url must match its pull request number",
    )
  }
  const mergeCommitSha = acceptanceString(
    pullRequest.mergeCommitSha,
    "reviewTrail.pullRequest.mergeCommitSha",
  ).toLowerCase()
  if (!/^[a-f0-9]{40}$/.test(mergeCommitSha)) {
    return acceptanceError(
      "reviewTrail.pullRequest.mergeCommitSha must be a full commit SHA",
    )
  }
  if (!Array.isArray(reviewTrail.commits) || reviewTrail.commits.length === 0) {
    return acceptanceError("reviewTrail.commits must be a non-empty array")
  }
  const commits = reviewTrail.commits.map((entry, index) => {
    const commit = acceptanceObject(entry, `reviewTrail.commits[${index}]`)
    const sha = acceptanceString(
      commit.sha,
      `reviewTrail.commits[${index}].sha`,
    ).toLowerCase()
    if (!/^[a-f0-9]{40}$/.test(sha)) {
      return acceptanceError(
        `reviewTrail.commits[${index}].sha must be a full commit SHA`,
      )
    }
    return { sha }
  })
  if (!commits.some(({ sha }) => sha === mergeCommitSha)) {
    return acceptanceError(
      "reviewTrail.commits must include the pull request merge commit",
    )
  }
  return {
    schemaVersion: WATCH_SEARCH_CANDIDATE_OPERATOR_ACCEPTANCE_SCHEMA,
    decisionId,
    status: "OPERATOR_ACCEPTED",
    identity: acceptanceIdentity(bundle.identity, decisionId),
    measurements: {
      relevance: normalizedRelevance,
      latency: normalizedLatency,
    },
    waivedGates,
    knownLimitations: acceptanceStrings(
      bundle.knownLimitations,
      "knownLimitations",
    ),
    acceptanceReason: acceptanceString(
      bundle.acceptanceReason,
      "acceptanceReason",
    ),
    rawMastraOutputs,
    userAcceptance: {
      acceptedAt: acceptanceDate(
        userAcceptance.acceptedAt,
        "userAcceptance.acceptedAt",
      ),
      reviewerIdentity: acceptanceString(
        userAcceptance.reviewerIdentity,
        "userAcceptance.reviewerIdentity",
      ),
      statement: acceptanceString(
        userAcceptance.statement,
        "userAcceptance.statement",
      ),
    },
    reviewTrail: {
      pullRequest: {
        number: pullRequest.number,
        url: pullRequestUrl,
        mergedAt: acceptanceDate(
          pullRequest.mergedAt,
          "reviewTrail.pullRequest.mergedAt",
        ),
        mergeCommitSha,
      },
      commits,
    },
  }
}

export function candidateQualificationEvidenceReason(
  gate: CandidateQualificationEvidenceGate,
) {
  return gate.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
}

export function hasCandidateQualificationEvidenceArtifact(
  evidence: Pick<CandidateQualificationEvidence, "artifacts">,
  gate: CandidateQualificationEvidenceGate,
) {
  const reference = evidence.artifacts?.[gate]
  return typeof reference === "string" && reference.trim().length > 0
}

export function hasPassingCandidateQualificationEvidence(value: unknown) {
  const evidence = recordValue(value)
  const artifacts = recordValue(evidence?.artifacts)
  return WATCH_SEARCH_CANDIDATE_REQUIRED_EVIDENCE_GATES.every(
    (gate) =>
      evidence?.[gate] === "PASS" &&
      typeof artifacts?.[gate] === "string" &&
      String(artifacts[gate]).trim().length > 0,
  )
}

export function parseCandidateQualificationEvidence(
  raw: string | undefined,
): CandidateQualificationEvidence {
  if (!raw) return DEFAULT_CANDIDATE_QUALIFICATION_EVIDENCE

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new CandidateQualificationConfigurationError(
      `WATCH_SEARCH_CANDIDATE_EVIDENCE_JSON is not valid JSON: ${
        error instanceof Error ? error.message : "unknown parse failure"
      }`,
    )
  }

  const evidence = recordValue(parsed)
  if (!evidence) {
    throw new CandidateQualificationConfigurationError(
      "WATCH_SEARCH_CANDIDATE_EVIDENCE_JSON must be an object",
    )
  }
  const artifacts = recordValue(evidence.artifacts)
  for (const gate of WATCH_SEARCH_CANDIDATE_REQUIRED_EVIDENCE_GATES) {
    const status = evidence[gate]
    if (status !== "PASS" && status !== "FAIL" && status !== "NOT_RUN") {
      throw new CandidateQualificationConfigurationError(
        `invalid evidence status for ${gate}`,
      )
    }
    if (
      status === "PASS" &&
      (typeof artifacts?.[gate] !== "string" ||
        String(artifacts[gate]).trim().length === 0)
    ) {
      throw new CandidateQualificationConfigurationError(
        `PASS evidence requires an artifact reference for ${gate}`,
      )
    }
  }
  return parsed as CandidateQualificationEvidence
}
