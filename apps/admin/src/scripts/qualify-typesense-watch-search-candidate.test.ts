import { createHash } from "node:crypto"
import { describe, expect, it, vi } from "vitest"
import { WATCH_SEARCH_CANDIDATE_REQUIRED_EVIDENCE_GATES } from "@/services/typesense-watch-search-candidate-qualification"
import {
  QualificationOperatorError,
  runWatchSearchCandidateQualificationOperator,
  typesenseOperatorIdentity,
  type QualificationOperatorDependencies,
} from "./qualify-typesense-watch-search-candidate"

const currentBindings = [
  "watch_catalog_current_42",
  "watch_availability_current_42",
  "watch_lexical_current_42",
  "watch_transcripts_current_42",
]

const candidateBindings = {
  catalog: "candidate-1_catalog",
  availability: "candidate-1_availability",
  lexical: "candidate-1_lexical",
  transcript: "watch_transcripts_current_42",
}

function report(overrides: Record<string, unknown> = {}) {
  const evidence = Object.fromEntries(
    WATCH_SEARCH_CANDIDATE_REQUIRED_EVIDENCE_GATES.map((gate) => [
      gate,
      "PASS",
    ]),
  )
  const artifacts = Object.fromEntries(
    WATCH_SEARCH_CANDIDATE_REQUIRED_EVIDENCE_GATES.map((gate) => [
      gate,
      `s3://reviewed/candidate-1/${gate}.json`,
    ]),
  )
  return {
    schemaVersion: "watch-search-candidate-qualification/v2",
    generatedAt: "2026-08-16T00:00:00.000Z",
    status: "QUALIFIED",
    reasons: [],
    identity: {
      generationId: "candidate-1",
      applicationRevision: "watch-search-candidate/v3",
      rankingRevision: "title-and-brand-v2",
      transcriptCollection: "watch_transcripts_current_42",
      transcriptProjectionRevision: "17",
      qrelsRevision: "public-watch-qrels/reviewed-v2",
      currentBindings,
      candidateBindings,
    },
    evidence: { ...evidence, artifacts },
    attempts: [],
    ...overrides,
  }
}

function operatorAcceptanceBundle(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: "watch-search-candidate-operator-acceptance/v1",
    decisionId: "candidate-launch-2026-08-16",
    status: "OPERATOR_ACCEPTED",
    identity: {
      generationId: "candidate-1",
      applicationRevision: "watch-search-candidate/v3",
      rankingRevision: "title-and-brand-v2",
      transcriptCollection: "watch_transcripts_current_42",
      transcriptProjectionRevision: "17",
      qrelsRevision: "none:operator-accepted:candidate-launch-2026-08-16",
      currentBindings,
      candidateBindings,
    },
    measurements: {
      relevance: {
        cases: 104,
        usefulOrExcellentPercent: 43.3,
        unacceptablePercent: 13.5,
      },
      latency: { callerP95Ms: 2689, adminP95Ms: 683 },
    },
    waivedGates: [
      {
        gate: "relevance",
        observed: "FAIL",
        reason: "Reviewer accepted stronger multilingual results.",
      },
    ],
    knownLimitations: ["The existing judge rubric underrates catalog intent."],
    acceptanceReason:
      "Manual comparison showed materially better native-language retrieval.",
    rawMastraOutputs: {
      development: { runId: "development-1", results: [{ score: 0.8 }] },
      heldOut: { runId: "held-out-1", results: [{ score: 0.7 }] },
    },
    userAcceptance: {
      acceptedAt: "2026-08-16T12:00:00.000Z",
      reviewerIdentity: "user:nisal",
      statement: "Ship the new Candidate and redo the baselines.",
    },
    reviewTrail: {
      pullRequest: {
        number: 1944,
        url: "https://github.com/JesusFilm/forge/pull/1944",
        mergedAt: "2026-08-16T11:30:00.000Z",
        mergeCommitSha: "a".repeat(40),
      },
      commits: [{ sha: "a".repeat(40) }, { sha: "b".repeat(40) }],
    },
    ...overrides,
  }
}

function fixture(
  input: {
    bytes?: Buffer
    pointerVersion?: number
    generationApplicationRevision?: string
  } = {},
) {
  const bytes = input.bytes ?? Buffer.from(JSON.stringify(report()))
  let servingPointer = {
    kind: "SERVING",
    generationId: null as string | null,
    version: input.pointerVersion ?? 4,
  }
  const service = {
    getGeneration: vi.fn(async () => ({
      id: "candidate-1",
      state: "READY",
      applicationRevision:
        input.generationApplicationRevision ?? "watch-search-candidate/v3",
      catalogCollection: candidateBindings.catalog,
      availabilityCollection: candidateBindings.availability,
      lexicalCollection: candidateBindings.lexical,
      transcriptCollection: candidateBindings.transcript,
      transcriptProjectionRevision: 17n,
    })),
    getPointer: vi.fn(async () => ({ ...servingPointer })),
    recordQualification: vi.fn(async () => ({ id: "qualification-1" })),
    pinServingGeneration: vi.fn(async () => {
      servingPointer = {
        kind: "SERVING",
        generationId: "candidate-1",
        version: servingPointer.version + 1,
      }
      return { ...servingPointer }
    }),
  }
  const dependencies: QualificationOperatorDependencies = {
    readFile: vi.fn(async () => bytes),
    freezeCurrentBindings: vi.fn(async () => currentBindings),
    service,
  }
  return { bytes, dependencies, service }
}

function digest(bytes: Buffer) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`
}

function args(action: "record" | "pin", bytes: Buffer) {
  return [
    action,
    "--report=/secure/reviewed-candidate.json",
    "--reviewer=reviewer@example.org",
    "--operator=operator@example.org",
    `--sha256=${digest(bytes)}`,
    ...(action === "pin" ? ["--expected-pointer-version=4"] : []),
  ]
}

function acceptedArgs(action: "record" | "pin", bytes: Buffer) {
  return [
    action,
    "--report=/secure/operator-acceptance.json",
    `--sha256=${digest(bytes)}`,
    `--byte-length=${bytes.byteLength}`,
    ...(action === "pin" ? ["--expected-pointer-version=4"] : []),
  ]
}

describe("watch search Candidate qualification operator", () => {
  it("derives a stable non-secret identity from the operator credential", () => {
    const identity = typesenseOperatorIdentity("operator-secret-value")
    expect(identity).toMatch(/^typesense-operator:sha256:[a-f0-9]{64}$/)
    expect(identity).not.toContain("operator-secret-value")
    expect(typesenseOperatorIdentity("operator-secret-value")).toBe(identity)
    expect(typesenseOperatorIdentity("another-secret")).not.toBe(identity)
  })

  it("records truthful operator acceptance using authenticated operator context", async () => {
    const bytes = Buffer.from(JSON.stringify(operatorAcceptanceBundle()))
    const { dependencies, service } = fixture({ bytes })
    Object.assign(dependencies, {
      operatorIdentity: `typesense-operator:sha256:${"c".repeat(64)}`,
    })

    await expect(
      runWatchSearchCandidateQualificationOperator(
        acceptedArgs("record", bytes),
        dependencies,
      ),
    ).resolves.toMatchObject({
      action: "record",
      authorizationStatus: "OPERATOR_ACCEPTED",
      reviewerIdentity: "user:nisal",
      operatorIdentity: `typesense-operator:sha256:${"c".repeat(64)}`,
      evidenceBundleByteLength: bytes.byteLength,
    })
    expect(service.recordQualification).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "OPERATOR_ACCEPTED",
        qrelsRevision: "none:operator-accepted:candidate-launch-2026-08-16",
        qualificationAudit: {
          reviewerIdentity: "user:nisal",
          operatorIdentity: `typesense-operator:sha256:${"c".repeat(64)}`,
          evidenceBundleSha256: digest(bytes),
          evidenceBundleByteLength: bytes.byteLength,
        },
      }),
    )
  })

  it.each(["record", "pin"] as const)(
    "rejects altered byte length for operator acceptance during %s",
    async (action) => {
      const bytes = Buffer.from(JSON.stringify(operatorAcceptanceBundle()))
      const { dependencies, service } = fixture({ bytes })
      Object.assign(dependencies, {
        operatorIdentity: `typesense-operator:sha256:${"c".repeat(64)}`,
      })
      const badLength = acceptedArgs(action, bytes).map((argument) =>
        argument.startsWith("--byte-length=")
          ? `--byte-length=${bytes.byteLength + 1}`
          : argument,
      )

      await expect(
        runWatchSearchCandidateQualificationOperator(badLength, dependencies),
      ).rejects.toThrow(/byte length/i)
      expect(service.recordQualification).not.toHaveBeenCalled()
      expect(service.pinServingGeneration).not.toHaveBeenCalled()
    },
  )

  it("rejects caller-supplied identity for operator acceptance", async () => {
    const bytes = Buffer.from(JSON.stringify(operatorAcceptanceBundle()))
    const { dependencies, service } = fixture({ bytes })
    Object.assign(dependencies, {
      operatorIdentity: `typesense-operator:sha256:${"c".repeat(64)}`,
    })

    await expect(
      runWatchSearchCandidateQualificationOperator(
        [...acceptedArgs("record", bytes), "--operator=someone@example.org"],
        dependencies,
      ),
    ).rejects.toThrow(/caller-supplied/i)
    expect(service.recordQualification).not.toHaveBeenCalled()
  })

  it("rejects operator acceptance without authenticated operator context", async () => {
    const bytes = Buffer.from(JSON.stringify(operatorAcceptanceBundle()))
    const { dependencies, service } = fixture({ bytes })

    await expect(
      runWatchSearchCandidateQualificationOperator(
        acceptedArgs("record", bytes),
        dependencies,
      ),
    ).rejects.toThrow(/authenticated Typesense operator identity/i)
    expect(service.recordQualification).not.toHaveBeenCalled()
  })

  it("rejects an operator acceptance bundle larger than 8 MiB", async () => {
    const bytes = Buffer.alloc(8 * 1024 * 1024 + 1, 0x20)
    const { dependencies, service } = fixture({ bytes })
    Object.assign(dependencies, {
      operatorIdentity: `typesense-operator:sha256:${"c".repeat(64)}`,
    })

    await expect(
      runWatchSearchCandidateQualificationOperator(
        acceptedArgs("record", bytes),
        dependencies,
      ),
    ).rejects.toThrow(/8 MiB/i)
    expect(service.recordQualification).not.toHaveBeenCalled()
  })

  it("records the exact qualified report with audit attribution but does not pin", async () => {
    const { bytes, dependencies, service } = fixture()

    await expect(
      runWatchSearchCandidateQualificationOperator(
        args("record", bytes),
        dependencies,
      ),
    ).resolves.toMatchObject({
      action: "record",
      status: "recorded",
      generationId: "candidate-1",
      qualificationId: "qualification-1",
      evidenceBundleSha256: digest(bytes),
    })
    expect(service.recordQualification).toHaveBeenCalledWith(
      expect.objectContaining({
        generationId: "candidate-1",
        status: "PASSED",
        qualificationAudit: {
          reviewerIdentity: "reviewer@example.org",
          operatorIdentity: "operator@example.org",
          evidenceBundleSha256: digest(bytes),
        },
        evidence: expect.objectContaining({
          audit: {
            reviewerIdentity: "reviewer@example.org",
            operatorIdentity: "operator@example.org",
            evidenceBundleSha256: digest(bytes),
          },
        }),
      }),
    )
    expect(service.pinServingGeneration).not.toHaveBeenCalled()
  })

  it("rejects failed, incomplete, or stale reports", async () => {
    const cases = [
      report({
        status: "NOT_QUALIFIED",
        reasons: ["candidate_p95_regression"],
      }),
      report({ evidence: { relevance: "PASS", artifacts: {} } }),
      report({
        identity: {
          ...report().identity,
          generationId: "candidate-stale",
        },
      }),
      report({
        identity: {
          ...report().identity,
          applicationRevision: "watch-search-candidate/stale",
        },
      }),
      report({
        identity: {
          ...report().identity,
          rankingRevision: "previous-ranker-v1",
        },
      }),
      report({
        identity: {
          ...report().identity,
          transcriptProjectionRevision: "16",
        },
      }),
      report({
        identity: {
          ...report().identity,
          candidateBindings: {
            ...candidateBindings,
            lexical: "candidate-stale_lexical",
          },
        },
      }),
      report({
        identity: {
          ...report().identity,
          currentBindings: ["stale-current"],
        },
      }),
    ]

    for (const candidateReport of cases) {
      const bytes = Buffer.from(JSON.stringify(candidateReport))
      const { dependencies, service } = fixture({ bytes })
      await expect(
        runWatchSearchCandidateQualificationOperator(
          args("record", bytes),
          dependencies,
        ),
      ).rejects.toBeInstanceOf(QualificationOperatorError)
      expect(service.recordQualification).not.toHaveBeenCalled()
    }
  })

  it.each(["record", "pin"] as const)(
    "computes the digest from the exact bytes again for %s",
    async (action) => {
      const original = Buffer.from(JSON.stringify(report()))
      const changed = Buffer.concat([original, Buffer.from("\n")])
      const { dependencies, service } = fixture({ bytes: changed })

      await expect(
        runWatchSearchCandidateQualificationOperator(
          args(action, original),
          dependencies,
        ),
      ).rejects.toThrow(/digest/i)
      expect(service.recordQualification).not.toHaveBeenCalled()
      expect(service.pinServingGeneration).not.toHaveBeenCalled()
    },
  )

  it("pins only after re-reading the exact report and verifying audit fields", async () => {
    const { bytes, dependencies, service } = fixture()

    await expect(
      runWatchSearchCandidateQualificationOperator(
        args("pin", bytes),
        dependencies,
      ),
    ).resolves.toMatchObject({
      action: "pin",
      status: "pinned",
      generationId: "candidate-1",
      pointerVersion: 5,
    })
    expect(service.pinServingGeneration).toHaveBeenCalledWith({
      generationId: "candidate-1",
      applicationRevision: "watch-search-candidate/v3",
      expectedPointerVersion: 4,
      currentBindings,
      qrelsRevision: "public-watch-qrels/reviewed-v2",
      rankingRevision: "title-and-brand-v2",
      qualificationAudit: {
        reviewerIdentity: "reviewer@example.org",
        operatorIdentity: "operator@example.org",
        evidenceBundleSha256: digest(bytes),
      },
    })
    expect(service.recordQualification).not.toHaveBeenCalled()
  })

  it("rejects changed attribution, digest, or concurrent pointer expectations", async () => {
    const { bytes, dependencies, service } = fixture({ pointerVersion: 5 })

    await expect(
      runWatchSearchCandidateQualificationOperator(
        args("pin", bytes),
        dependencies,
      ),
    ).rejects.toThrow(/pointer version/i)
    expect(service.pinServingGeneration).not.toHaveBeenCalled()

    const badAudit = args("record", bytes).map((value) =>
      value.startsWith("--reviewer=") ? "--reviewer= " : value,
    )
    await expect(
      runWatchSearchCandidateQualificationOperator(badAudit, dependencies),
    ).rejects.toBeInstanceOf(QualificationOperatorError)
  })

  it("rejects a report and generation for a stale application revision", async () => {
    const bytes = Buffer.from(
      JSON.stringify(
        report({
          identity: {
            ...report().identity,
            applicationRevision: "watch-search-candidate/stale",
          },
        }),
      ),
    )
    const { dependencies, service } = fixture({
      bytes,
      generationApplicationRevision: "watch-search-candidate/stale",
    })

    await expect(
      runWatchSearchCandidateQualificationOperator(
        args("record", bytes),
        dependencies,
      ),
    ).rejects.toThrow(/application revision/i)
    expect(service.recordQualification).not.toHaveBeenCalled()
  })

  it.each(["+4", " 4", "04", "0x4", "4.0", "4e0", "-0"])(
    "rejects non-canonical pointer version %s",
    async (pointerVersion) => {
      const { bytes, dependencies, service } = fixture()
      const malformed = args("pin", bytes).map((value) =>
        value.startsWith("--expected-pointer-version=")
          ? `--expected-pointer-version=${pointerVersion}`
          : value,
      )

      await expect(
        runWatchSearchCandidateQualificationOperator(malformed, dependencies),
      ).rejects.toThrow(/pointer version/i)
      expect(service.pinServingGeneration).not.toHaveBeenCalled()
    },
  )

  it.each(["reviewer", "operator", "sha256"])(
    "rejects a missing %s audit field",
    async (field) => {
      const { bytes, dependencies, service } = fixture()
      const incomplete = args("record", bytes).filter(
        (value) => !value.startsWith(`--${field}=`),
      )

      await expect(
        runWatchSearchCandidateQualificationOperator(incomplete, dependencies),
      ).rejects.toBeInstanceOf(QualificationOperatorError)
      expect(service.recordQualification).not.toHaveBeenCalled()
    },
  )
})
