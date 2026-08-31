import { createHash, randomUUID } from "node:crypto"
import { mkdir, rename, writeFile } from "node:fs/promises"
import { dirname } from "node:path"

import { z } from "zod"

export const METRIC_IMPLEMENTATION_ID =
  "jesusfilm-rag/eval-metrics@2026-08-06+forge-identity-v1"
export const CONTROL_CASE_COUNT = 416
export const CONTROL_RECALL_AT_10 = 1
export const CONTROL_COVERAGE = 0.887
export const RELATIVE_REGRESSION_LIMIT = 0.02

const sha256 = (value: string): string =>
  createHash("sha256").update(value).digest("hex")

export const evaluationIdentitySchema = z.object({
  goldenRevision: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  caseSetRevision: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  caseCount: z.number().int().positive(),
  registryRevision: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  corpusRevision: z.string().min(1),
  embeddingModel: z.string().min(1),
  queryInstruction: z.string(),
  topK: z.number().int().positive().max(100),
  minimumScore: z.number().finite(),
  metricImplementation: z.string().min(1),
})

export type EvaluationIdentity = z.infer<typeof evaluationIdentitySchema>

export function contentRevision(value: string): string {
  return `sha256:${sha256(value)}`
}

export function caseSetRevision(caseIds: string[]): string {
  return contentRevision(JSON.stringify([...caseIds]))
}

export function registryRevision(
  sources: ReadonlyArray<{ key: string; languages: readonly string[] }>,
): string {
  return contentRevision(
    JSON.stringify(
      sources
        .map(({ key, languages }) => ({
          key,
          languages: [...languages].sort(),
        }))
        .sort((left, right) => left.key.localeCompare(right.key)),
    ),
  )
}

export const aggregateMetricsSchema = z.object({
  cases: z.number().int().positive(),
  recall_at_3: z.number().min(0).max(1),
  recall_at_10: z.number().min(0).max(1),
  coverage: z.number().min(0).max(1),
  mrr: z.number().min(0).max(1),
  precision_at_1: z.number().min(0).max(1),
})

const diagnosticSchema = z.object({
  key: z.string().min(1),
  cases: z.number().int().positive(),
  recall_at_10: z.number().min(0).max(1),
  coverage: z.number().min(0).max(1),
})

export const evaluationReceiptSchema = z.object({
  schemaVersion: z.literal(1),
  runId: z.string().uuid(),
  environment: z.enum(["local", "production-read", "control"]),
  completedAt: z.string().datetime(),
  identity: evaluationIdentitySchema,
  metrics: aggregateMetricsSchema,
  diagnostics: z.object({
    sources: z.array(diagnosticSchema),
    languages: z.array(diagnosticSchema),
    evidenceTiers: z.array(diagnosticSchema),
  }),
  cases: z.array(
    z.object({
      id: z.string().min(1),
      firstRelevantRank: z.number().int().positive().max(10).nullable(),
      relevantReturned: z.number().int().nonnegative(),
      relevantTotal: z.number().int().positive(),
    }),
  ),
})

export type EvaluationReceipt = z.infer<typeof evaluationReceiptSchema>

export const lossDispositionSchema = z.enum([
  "ranking-only",
  "relevance-set-correction",
  "approved-corpus-change",
  "retrieval-regression",
  "unresolved",
])

export type LossDisposition = z.infer<typeof lossDispositionSchema>

export type Comparison =
  | { state: "refused"; reasons: string[] }
  | {
      state: "pass" | "fail"
      floors: { recall_at_10: number; coverage: number }
      losses: Array<{ id: string; disposition: LossDisposition }>
      reasons: string[]
    }

const IDENTITY_KEYS = Object.keys(evaluationIdentitySchema.shape) as Array<
  keyof EvaluationIdentity
>

export function compareReceipts(
  controlInput: unknown,
  candidateInput: unknown,
  dispositions: Record<string, LossDisposition> = {},
): Comparison {
  for (const disposition of Object.values(dispositions))
    lossDispositionSchema.parse(disposition)
  const control = evaluationReceiptSchema.safeParse(controlInput)
  const candidate = evaluationReceiptSchema.safeParse(candidateInput)
  if (!control.success || !candidate.success)
    return { state: "refused", reasons: ["incomplete-or-corrupt-report"] }
  for (const receipt of [control.data, candidate.data]) {
    const ids = receipt.cases.map(({ id }) => id)
    if (
      ids.length !== receipt.identity.caseCount ||
      receipt.metrics.cases !== receipt.identity.caseCount ||
      new Set(ids).size !== ids.length ||
      caseSetRevision(ids) !== receipt.identity.caseSetRevision
    )
      return { state: "refused", reasons: ["incomplete-or-corrupt-report"] }
  }

  const mismatches = IDENTITY_KEYS.filter(
    (key) => control.data.identity[key] !== candidate.data.identity[key],
  )
  if (mismatches.length)
    return {
      state: "refused",
      reasons: mismatches.map((key) => `identity-mismatch:${key}`),
    }

  const floors = {
    recall_at_10:
      control.data.metrics.recall_at_10 * (1 - RELATIVE_REGRESSION_LIMIT),
    coverage: control.data.metrics.coverage * (1 - RELATIVE_REGRESSION_LIMIT),
  }
  const before = new Map(control.data.cases.map((item) => [item.id, item]))
  const losses = candidate.data.cases
    .filter((item) => {
      const prior = before.get(item.id)
      return (
        prior &&
        (item.relevantReturned < prior.relevantReturned ||
          (prior.firstRelevantRank !== null &&
            (item.firstRelevantRank === null ||
              item.firstRelevantRank > prior.firstRelevantRank)))
      )
    })
    .map(({ id }) => ({ id, disposition: dispositions[id] ?? "unresolved" }))
  const reasons: string[] = []
  if (candidate.data.metrics.recall_at_10 < floors.recall_at_10)
    reasons.push("recall-at-10-regression")
  if (candidate.data.metrics.coverage < floors.coverage)
    reasons.push("coverage-regression")
  if (losses.some(({ disposition }) => disposition === "unresolved"))
    reasons.push("unresolved-case-loss")
  if (losses.some(({ disposition }) => disposition === "retrieval-regression"))
    reasons.push("confirmed-retrieval-regression")
  return { state: reasons.length ? "fail" : "pass", floors, losses, reasons }
}

export function createRunId(): string {
  return randomUUID()
}

export async function writeReceiptAtomic(
  destination: string,
  receipt: EvaluationReceipt,
): Promise<void> {
  evaluationReceiptSchema.parse(receipt)
  await mkdir(dirname(destination), { recursive: true })
  const temporary = `${destination}.${receipt.runId}.tmp`
  await writeFile(temporary, `${JSON.stringify(receipt, null, 2)}\n`, {
    flag: "wx",
    mode: 0o600,
  })
  await rename(temporary, destination)
}
