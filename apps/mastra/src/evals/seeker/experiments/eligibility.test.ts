import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

import { ExperimentManifestSchema } from "./manifest"
import { EligibilityRecordSchema } from "./types"
import { evaluateEligibility } from "./eligibility"

const criterion = {
  id: "minimum-run-score",
  version: "1",
  parameters: { minimum: 0.8 },
}

describe("evaluateEligibility", () => {
  it.each([
    ["green", "passed", true],
    ["green", "failed", false],
    ["green", "unknown", false],
    ["green", "unavailable", false],
    ["red", "passed", false],
    ["refused", "passed", false],
  ] as const)(
    "combines a %s gate and %s criterion without a bypass",
    (gate, expectedCriterion, eligible) => {
      const result = evaluateEligibility({
        gateReport: { verdict: gate },
        criterion:
          expectedCriterion === "unknown"
            ? { ...criterion, id: "not-registered" }
            : criterion,
        score:
          expectedCriterion === "unavailable"
            ? {}
            : { runScore: expectedCriterion === "failed" ? 0.79 : 0.8 },
        evidence: [
          "attempts/attempt-1/gate-report.json",
          "attempts/attempt-1/score.json",
        ],
      })

      expect(result).toMatchObject({
        gate: { outcome: gate },
        criterion: { outcome: expectedCriterion },
        eligible,
      })
    },
  )

  it("evaluates the named score-delta criterion from the persisted gate measurement", () => {
    expect(
      evaluateEligibility({
        gateReport: { verdict: "green", scoreDelta: { delta: 0.05 } },
        criterion: {
          id: "minimum-score-delta",
          version: "1",
          parameters: { minimumDelta: 0.05 },
        },
        score: {},
        evidence: ["attempts/attempt-1/gate-report.json"],
      }).criterion.outcome,
    ).toBe("passed")
  })

  it("parses the shipped template criterion and can derive eligibility", async () => {
    const template = ExperimentManifestSchema.parse(
      JSON.parse(
        await readFile(
          resolve(
            import.meta.dirname,
            "../../../../evals/experiments/seeker/experiment.template.json",
          ),
          "utf8",
        ),
      ),
    )
    expect(
      evaluateEligibility({
        gateReport: { verdict: "green" },
        criterion: template.criterion,
        score: { runScore: 0.95 },
        evidence: ["attempts/attempt-1/score.json"],
      }),
    ).toMatchObject({
      criterion: { id: "minimum-run-score", outcome: "passed" },
      eligible: true,
    })
  })

  it("distinguishes unsupported evaluators from malformed parameters", () => {
    const evaluate = (candidate: unknown) =>
      evaluateEligibility({
        gateReport: { verdict: "green" },
        criterion: candidate,
        score: { runScore: 1 },
        evidence: ["attempts/attempt-1/gate-report.json"],
      }).criterion.outcome
    expect(evaluate({ ...criterion, version: "2" })).toBe("unknown")
    expect(evaluate({ ...criterion, parameters: { minimum: "high" } })).toBe(
      "unavailable",
    )
  })

  it("rejects a persisted eligibility flag that disagrees with its inputs", () => {
    expect(
      EligibilityRecordSchema.safeParse({
        gate: { outcome: "red" },
        criterion: {
          id: "minimum-run-score",
          version: "1",
          outcome: "passed",
        },
        eligible: true,
        evidence: ["attempts/attempt-1/gate-report.json"],
      }).success,
    ).toBe(false)
  })
})
