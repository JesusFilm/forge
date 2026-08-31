import { describe, expect, it } from "vitest"

import {
  METRIC_IMPLEMENTATION_ID,
  caseSetRevision,
  compareReceipts,
  contentRevision,
  type EvaluationReceipt,
} from "../scripts/lib/evaluation/identity.js"

const identity = {
  goldenRevision: contentRevision("golden"),
  caseSetRevision: caseSetRevision(["a"]),
  caseCount: 1,
  registryRevision: contentRevision("registry"),
  corpusRevision: "corpus-copy-130",
  embeddingModel: "model",
  queryInstruction: "",
  topK: 10 as const,
  minimumScore: 0.37,
  metricImplementation: METRIC_IMPLEMENTATION_ID,
}

function receipt(
  metrics: Partial<EvaluationReceipt["metrics"]> = {},
): EvaluationReceipt {
  return {
    schemaVersion: 1,
    runId: crypto.randomUUID(),
    environment: "control",
    completedAt: new Date(0).toISOString(),
    identity,
    metrics: {
      cases: 1,
      recall_at_3: 1,
      recall_at_10: 1,
      coverage: 0.887,
      mrr: 1,
      precision_at_1: 1,
      ...metrics,
    },
    diagnostics: { sources: [], languages: [], evidenceTiers: [] },
    cases: [
      { id: "a", firstRelevantRank: 1, relevantReturned: 1, relevantTotal: 1 },
    ],
  }
}

describe("identity-bound comparison", () => {
  it("refuses every unlike identity before scoring", () => {
    const alternatives: Record<keyof typeof identity, unknown> = {
      goldenRevision: contentRevision("other-golden"),
      caseSetRevision: contentRevision("other-case-set"),
      caseCount: 2,
      registryRevision: contentRevision("other-registry"),
      corpusRevision: "other-corpus",
      embeddingModel: "other-model",
      queryInstruction: "other-instruction",
      topK: 9,
      minimumScore: 0.4,
      metricImplementation: "other/metric@v2",
    }
    for (const key of Object.keys(identity) as Array<keyof typeof identity>) {
      const candidate = receipt()
      candidate.identity = { ...identity, [key]: alternatives[key] }
      const semanticAxis = key === "caseSetRevision" || key === "caseCount"
      expect(compareReceipts(receipt(), candidate)).toEqual({
        state: "refused",
        reasons: [
          semanticAxis
            ? "incomplete-or-corrupt-report"
            : `identity-mismatch:${key}`,
        ],
      })
    }
  })

  it("passes at the exact relative boundary and fails immediately below", () => {
    expect(
      compareReceipts(
        receipt(),
        receipt({ recall_at_10: 0.98, coverage: 0.86926 }),
      ).state,
    ).toBe("pass")
    expect(
      compareReceipts(
        receipt(),
        receipt({ recall_at_10: 0.979999, coverage: 0.869259 }),
      ).state,
    ).toBe("fail")
  })

  it("distinguishes rank jitter and requires a closed disposition", () => {
    const candidate = receipt()
    candidate.cases[0].firstRelevantRank = 2
    expect(compareReceipts(receipt(), candidate).state).toBe("fail")
    expect(
      compareReceipts(receipt(), candidate, { a: "ranking-only" }).state,
    ).toBe("pass")
    expect(() =>
      compareReceipts(receipt(), candidate, { a: "explained" as never }),
    ).toThrow()
  })

  it("refuses corrupt or incomplete reports", () => {
    expect(compareReceipts(receipt(), {})).toEqual({
      state: "refused",
      reasons: ["incomplete-or-corrupt-report"],
    })
  })
})
