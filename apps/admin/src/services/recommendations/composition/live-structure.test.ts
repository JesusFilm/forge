import { describe, expect, it } from "vitest"
import { composeStructurallyValidMmrSlate } from "./live-structure"
import { MMR_SLATE_POLICY_VERSION } from "./mmr"
import { slate } from "./test-helpers"
import { COWATCH_OWNER_LIVE_MODE } from "../promotion/manifest"

const valid = () => ({
  slate: slate(),
  historyAvailable: true,
  composerVersion: MMR_SLATE_POLICY_VERSION,
  graphGenerationId: "a".repeat(64),
  graphGeneratorVersion: COWATCH_OWNER_LIVE_MODE,
})
describe("shared live MMR structural checks", () => {
  it("accepts known empty history with complete real inputs", () => {
    const result = composeStructurallyValidMmrSlate(valid())
    expect(result.status).toBe("composed")
    expect(result).not.toHaveProperty("compositionInputDiagnostic")
  })
  it("refuses unavailable history rather than treating it as an empty history", () => {
    expect(
      composeStructurallyValidMmrSlate({ ...valid(), historyAvailable: false }),
    ).toEqual({
      status: "fallback",
      reason: "composition_required_input_unavailable",
      compositionInputDiagnostic: {
        version: "composition-input-availability-v1",
        missingSource: false,
        missingInterest: false,
        missingTheme: false,
        missingHistory: true,
        candidateCount: 3,
        selectedCount: 2,
        themedSelectedCount: 2,
      },
    })
  })
  it("reports exact missing theme and interest flags from the attempted slate", () => {
    const input = valid()
    input.slate.ordered = input.slate.ordered.map((candidate) => ({
      ...candidate,
      presentation: { ...candidate.presentation, themes: [] },
      sources: candidate.sources.map((source) => ({
        ...source,
        evidence: {},
      })),
    }))
    expect(composeStructurallyValidMmrSlate(input)).toEqual({
      status: "fallback",
      reason: "composition_required_input_unavailable",
      compositionInputDiagnostic: {
        version: "composition-input-availability-v1",
        missingSource: false,
        missingInterest: true,
        missingTheme: true,
        missingHistory: false,
        candidateCount: 3,
        selectedCount: 2,
        themedSelectedCount: 0,
      },
    })
  })
  it("reports an empty attempted pool without inventing source or interest coverage", () => {
    const input = valid()
    input.slate.ordered = []
    expect(composeStructurallyValidMmrSlate(input)).toMatchObject({
      compositionInputDiagnostic: {
        missingSource: true,
        missingInterest: true,
        missingTheme: true,
        missingHistory: false,
        candidateCount: 0,
        selectedCount: 0,
        themedSelectedCount: 0,
      },
    })
  })
  it("bounds the aggregate to the actual 64-candidate, six-item composition", () => {
    const input = valid()
    const original = input.slate.ordered[0]!
    input.slate.ordered = Array.from({ length: 70 }, (_, index) => ({
      ...original,
      candidateKey: `bounded-${index}`,
      targetMediaId: `bounded-${index}`,
      presentation: { ...original.presentation, themes: [] },
    }))
    input.slate.limit = 70
    expect(composeStructurallyValidMmrSlate(input)).toMatchObject({
      compositionInputDiagnostic: {
        missingSource: false,
        missingInterest: false,
        missingTheme: true,
        missingHistory: false,
        candidateCount: 64,
        selectedCount: 6,
        themedSelectedCount: 0,
      },
    })
  })
  it("rejects another composer version even when its candidates are eligible", () => {
    expect(
      composeStructurallyValidMmrSlate({
        ...valid(),
        composerVersion: "other-policy",
      }),
    ).toEqual({ status: "fallback", reason: "composition_version_mismatch" })
  })
  it.each(["other-graph", "trial-mode"])(
    "rejects co-watch provenance from %s",
    (mismatch) => {
      const input = valid()
      const first = input.slate.ordered[0]!
      const source = {
        ...first.nominations[0]!.source,
        generator: "directional-cowatch",
        generatorVersion:
          mismatch === "trial-mode"
            ? "frozen-source-controlled-trial-v1"
            : COWATCH_OWNER_LIVE_MODE,
        evidence: {
          generation:
            mismatch === "other-graph"
              ? "b".repeat(64)
              : input.graphGenerationId,
        },
      }
      const mismatched = {
        ...input,
        slate: {
          ...input.slate,
          ordered: input.slate.ordered.map((candidate, index) =>
            index === 0
              ? {
                  ...first,
                  nominations: [
                    { ...first.nominations[0]!, source },
                    ...first.nominations.slice(1),
                  ],
                }
              : candidate,
          ),
        },
      }
      expect(composeStructurallyValidMmrSlate(mismatched)).toEqual({
        status: "fallback",
        reason: "composition_candidate_graph_mismatch",
      })
    },
  )
})
