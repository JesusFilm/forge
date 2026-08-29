import { describe, expect, it } from "vitest"
import {
  CandidateQualificationConfigurationError,
  parseCandidateOperatorAcceptanceBundle,
} from "./typesense-watch-search-candidate-qualification"

function operatorAcceptanceBundle(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: "watch-search-candidate-operator-acceptance/v1",
    decisionId: "candidate-launch-2026-08-16",
    status: "OPERATOR_ACCEPTED",
    identity: {
      generationId: "candidate-1",
      applicationRevision: "watch-search-candidate/v2",
      rankingRevision: "title-and-brand-v2",
      transcriptCollection: "watch_transcripts_current_42",
      transcriptProjectionRevision: "17",
      qrelsRevision: "none:operator-accepted:candidate-launch-2026-08-16",
      currentBindings: [
        "watch_catalog_current_42",
        "watch_availability_current_42",
        "watch_lexical_current_42",
        "watch_transcripts_current_42",
      ],
      candidateBindings: {
        catalog: "candidate-1_catalog",
        availability: "candidate-1_availability",
        lexical: "candidate-1_lexical",
        transcript: "watch_transcripts_current_42",
      },
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

describe("parseCandidateOperatorAcceptanceBundle", () => {
  it("accepts a truthful self-contained operator decision", () => {
    expect(
      parseCandidateOperatorAcceptanceBundle(operatorAcceptanceBundle()),
    ).toMatchObject({
      decisionId: "candidate-launch-2026-08-16",
      status: "OPERATOR_ACCEPTED",
      userAcceptance: { reviewerIdentity: "user:nisal" },
    })
  })

  it.each([
    ["measurements", { measurements: undefined }],
    ["waived gates", { waivedGates: [] }],
    ["limitations", { knownLimitations: [] }],
    ["rationale", { acceptanceReason: " " }],
    ["raw Mastra output", { rawMastraOutputs: {} }],
    ["user acceptance", { userAcceptance: undefined }],
    [
      "merged review trail",
      {
        reviewTrail: {
          pullRequest: {
            number: 1944,
            url: "https://github.com/JesusFilm/forge/pull/1944",
            mergedAt: "",
            mergeCommitSha: "a".repeat(40),
          },
          commits: [{ sha: "b".repeat(40) }],
        },
      },
    ],
  ])("rejects missing %s", (_name, patch) => {
    expect(() =>
      parseCandidateOperatorAcceptanceBundle(
        operatorAcceptanceBundle(patch as Record<string, unknown>),
      ),
    ).toThrow(CandidateQualificationConfigurationError)
  })

  it("does not allow operator acceptance to parse as automated PASSED evidence", () => {
    expect(() =>
      parseCandidateOperatorAcceptanceBundle(
        operatorAcceptanceBundle({ status: "PASSED" }),
      ),
    ).toThrow(/OPERATOR_ACCEPTED/)
  })

  it("requires the evaluation revision to bind the decision ID", () => {
    expect(() =>
      parseCandidateOperatorAcceptanceBundle(
        operatorAcceptanceBundle({
          identity: {
            ...(operatorAcceptanceBundle().identity as Record<string, unknown>),
            qrelsRevision: "none:operator-accepted:another-decision",
          },
        }),
      ),
    ).toThrow(/evaluation revision/i)
  })

  it("bounds the decision ID so its evaluation revision fits varchar(128)", () => {
    const decisionId = "a".repeat(106)
    expect(() =>
      parseCandidateOperatorAcceptanceBundle(
        operatorAcceptanceBundle({
          decisionId,
          identity: {
            ...(operatorAcceptanceBundle().identity as Record<string, unknown>),
            qrelsRevision: `none:operator-accepted:${decisionId}`,
          },
        }),
      ),
    ).toThrow(/decisionId/)
  })

  it("binds the pull request URL and merge commit coherently", () => {
    expect(() =>
      parseCandidateOperatorAcceptanceBundle(
        operatorAcceptanceBundle({
          reviewTrail: {
            pullRequest: {
              number: 1945,
              url: "https://github.com/JesusFilm/forge/pull/1944",
              mergedAt: "2026-08-16T11:30:00.000Z",
              mergeCommitSha: "a".repeat(40),
            },
            commits: [{ sha: "a".repeat(40) }],
          },
        }),
      ),
    ).toThrow(/match its pull request number/i)

    expect(() =>
      parseCandidateOperatorAcceptanceBundle(
        operatorAcceptanceBundle({
          reviewTrail: {
            pullRequest: {
              number: 1944,
              url: "https://github.com/JesusFilm/forge/pull/1944",
              mergedAt: "2026-08-16T11:30:00.000Z",
              mergeCommitSha: "a".repeat(40),
            },
            commits: [{ sha: "b".repeat(40) }],
          },
        }),
      ),
    ).toThrow(/include the pull request merge commit/i)
  })
})
