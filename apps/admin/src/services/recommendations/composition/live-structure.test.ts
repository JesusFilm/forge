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
    expect(composeStructurallyValidMmrSlate(valid()).status).toBe("composed")
  })
  it("refuses unavailable history rather than treating it as an empty history", () => {
    expect(
      composeStructurallyValidMmrSlate({ ...valid(), historyAvailable: false }),
    ).toEqual({
      status: "fallback",
      reason: "composition_required_input_unavailable",
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
