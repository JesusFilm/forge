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
