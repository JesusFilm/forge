import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import {
  METRIC_IMPLEMENTATION_ID,
  CONTROL_CASE_COUNT,
  caseSetRevision,
  compareReceipts,
  contentRevision,
  writeReceiptAtomic,
  type EvaluationReceipt,
} from "../scripts/lib/evaluation/identity.js"

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

const controlCaseIds = Array.from(
  { length: CONTROL_CASE_COUNT },
  (_, index) => `case-${index}`,
)

const identity = {
  goldenRevision: contentRevision("golden"),
  caseSetRevision: caseSetRevision(controlCaseIds),
  caseCount: CONTROL_CASE_COUNT,
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
  environment: EvaluationReceipt["environment"] = "control",
): EvaluationReceipt {
  return {
    schemaVersion: 1,
    runId: crypto.randomUUID(),
    environment,
    completedAt: new Date(0).toISOString(),
    identity,
    metrics: {
      cases: CONTROL_CASE_COUNT,
      recall_at_3: 1,
      recall_at_10: 1,
      coverage: 1,
      mrr: 1,
      precision_at_1: 1,
      ...metrics,
    },
    diagnostics: { sources: [], languages: [], evidenceTiers: [] },
    cases: controlCaseIds.map((id) => ({
      id,
      firstRelevantRank: 1,
      relevantReturned: 1,
      relevantTotal: 1,
    })),
  }
}

function receiptWithMisses(missCount: number): EvaluationReceipt {
  const hitCount = CONTROL_CASE_COUNT - missCount
  const cases = controlCaseIds.map((id, index) => ({
    id,
    firstRelevantRank: index < hitCount ? 1 : null,
    relevantReturned: index < hitCount ? 1 : 0,
    relevantTotal: 1,
  }))
  const rate = hitCount / CONTROL_CASE_COUNT
  const value = receipt(
    {
      recall_at_3: rate,
      recall_at_10: rate,
      coverage: rate,
      mrr: rate,
      precision_at_1: rate,
    },
    "local",
  )
  value.cases = cases
  return value
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
    const dispositions = Object.fromEntries(
      controlCaseIds.slice(-8).map((id) => [id, "ranking-only" as const]),
    )
    expect(
      compareReceipts(receipt(), receiptWithMisses(8), dispositions).state,
    ).toBe("pass")
    expect(
      compareReceipts(receipt(), receiptWithMisses(9), {
        ...dispositions,
        [controlCaseIds.at(-9)!]: "ranking-only",
      }).state,
    ).toBe("fail")
  })

  it("refuses the same run and a non-retained or weak control", () => {
    const same = receipt()
    expect(compareReceipts(same, same)).toEqual({
      state: "refused",
      reasons: ["same-run"],
    })

    expect(compareReceipts(receipt({}, "local"), receipt())).toEqual({
      state: "refused",
      reasons: ["non-retained-control"],
    })

    const weak = receiptWithMisses(50)
    weak.environment = "control"
    expect(compareReceipts(weak, receipt())).toEqual({
      state: "refused",
      reasons: ["weak-control"],
    })
  })

  it("distinguishes rank jitter and requires a closed disposition", () => {
    const candidate = receipt()
    candidate.environment = "local"
    candidate.cases[0].firstRelevantRank = 2
    candidate.metrics.mrr = (CONTROL_CASE_COUNT - 1 + 0.5) / CONTROL_CASE_COUNT
    candidate.metrics.precision_at_1 =
      (CONTROL_CASE_COUNT - 1) / CONTROL_CASE_COUNT
    expect(compareReceipts(receipt(), candidate).state).toBe("fail")
    expect(
      compareReceipts(receipt(), candidate, {
        [controlCaseIds[0]]: "ranking-only",
      }).state,
    ).toBe("pass")
    expect(() =>
      compareReceipts(receipt(), candidate, {
        [controlCaseIds[0]]: "explained" as never,
      }),
    ).toThrow()
  })

  it("refuses corrupt or incomplete reports", () => {
    expect(compareReceipts(receipt(), {})).toEqual({
      state: "refused",
      reasons: ["incomplete-or-corrupt-report"],
    })
  })

  it("refuses impossible case counts and tampered aggregate metrics", () => {
    const impossible = receipt()
    impossible.cases[0].relevantReturned = 2
    expect(compareReceipts(receipt(), impossible).state).toBe("refused")

    for (const key of [
      "recall_at_3",
      "recall_at_10",
      "coverage",
      "mrr",
      "precision_at_1",
    ] as const) {
      const tampered = receipt()
      tampered.metrics[key] = 0.5
      expect(compareReceipts(receipt(), tampered)).toEqual({
        state: "refused",
        reasons: ["incomplete-or-corrupt-report"],
      })
    }
  })
})

describe("writeReceiptAtomic", () => {
  it("publishes a complete receipt without leaving its temporary file", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rag-receipt-"))
    temporaryDirectories.push(directory)
    const destination = join(directory, "receipt.json")
    const value = receipt()

    await writeReceiptAtomic(destination, value)

    expect(JSON.parse(await readFile(destination, "utf8"))).toEqual(value)
    expect(await readdir(directory)).toEqual(["receipt.json"])
  })

  it("refuses a collision, preserves the winner, and cleans its temporary file", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rag-receipt-"))
    temporaryDirectories.push(directory)
    const destination = join(directory, "receipt.json")
    await writeFile(destination, "winner\n", { flag: "wx" })

    await expect(
      writeReceiptAtomic(destination, receipt()),
    ).rejects.toMatchObject({ code: "EEXIST" })

    expect(await readFile(destination, "utf8")).toBe("winner\n")
    expect(await readdir(directory)).toEqual(["receipt.json"])
  })
})
