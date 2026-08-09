import { z } from "zod"

const SAFE_ID = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/
const SHA256 = /^[a-f0-9]{64}$/

export const SafeIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(SAFE_ID, "must be a lowercase path-safe repository identifier")

export const RepositoryRelativePathSchema = z
  .string()
  .min(1)
  .max(512)
  .refine(
    (value) =>
      !value.startsWith("/") &&
      !value.startsWith("\\") &&
      !value.includes("\\") &&
      value
        .split("/")
        .every((part) => part !== "" && part !== "." && part !== ".."),
    "must be a normalized repository-relative path without traversal",
  )

export const PromptIdentitySchema = z
  .object({
    provider: SafeIdSchema,
    name: SafeIdSchema,
    revision: z.string().min(1).max(128),
    contentHash: z.string().regex(SHA256, "must be a lowercase sha256 hash"),
    provenance: z
      .object({
        intakeSelector: z
          .object({
            kind: z.literal("label"),
            value: z.string().min(1).max(128),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict()

const ModelRouteSchema = z
  .object({
    provider: SafeIdSchema,
    model: z.string().min(1).max(256),
    endpoint: SafeIdSchema,
    maxRetries: z.number().int().nonnegative(),
    baseUrl: z.url().optional(),
    timeoutMs: z.number().int().positive().optional(),
    configurationHash: z.string().regex(SHA256).optional(),
  })
  .strict()

export const ModelIdentitySchema = z
  .object({
    routing: z.literal("ordered-fallback"),
    routes: z.array(ModelRouteSchema).min(1),
  })
  .strict()

const DecodingIdentitySchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("provider-default") }).strict(),
  z
    .object({
      mode: z.literal("parameters"),
      temperature: z.number().finite(),
      maxTokens: z.number().int().positive(),
    })
    .strict(),
])

export const ResolvedIdentitySchema = z
  .object({
    prompt: PromptIdentitySchema,
    model: ModelIdentitySchema,
    decoding: DecodingIdentitySchema,
    questionSet: z
      .object({
        id: z.string().min(1).max(128),
        questionIds: z.array(SafeIdSchema).min(1),
      })
      .strict(),
    criteria: z.object({ contentHash: z.string().regex(SHA256) }).strict(),
    judge: z
      .object({
        model: z.string().min(1).max(256),
        rubricHash: z.string().regex(SHA256),
      })
      .strict(),
    retrieval: z.discriminatedUnion("mode", [
      z.object({ mode: z.literal("none") }).strict(),
      z
        .object({
          mode: z.enum(["fixtures", "tool-loop"]),
          corpusHash: z.string().regex(SHA256),
          topK: z.number().int().positive(),
        })
        .strict(),
    ]),
    runtime: z.object({ configurationHash: z.string().regex(SHA256) }).strict(),
  })
  .strict()

export type ResolvedIdentity = z.infer<typeof ResolvedIdentitySchema>

export const HypothesisCriterionSchema = z
  .object({
    id: SafeIdSchema,
    version: z.string().min(1).max(64),
    parameters: z.record(z.string(), z.unknown()),
  })
  .strict()

export const ExperimentLifecycleSchema = z.enum([
  "draft",
  "executing",
  "review-ready",
])
export const TerminalVerdictSchema = z.enum([
  "successful",
  "failed",
  "inconclusive",
  "deferred",
])
export const ComparisonAxisSchema = z.enum(["prompt", "model"])
export type TerminalVerdict = z.infer<typeof TerminalVerdictSchema>
export type ComparisonAxis = z.infer<typeof ComparisonAxisSchema>

const ArtifactRecordSchema = z
  .object({
    kind: z.enum([
      "resolved-identity",
      "answers",
      "transcripts",
      "judged",
      "score",
      "comparison",
      "gate-report",
      "completion",
      "diagnostic",
    ]),
    path: RepositoryRelativePathSchema,
    sha256: z.string().regex(SHA256),
  })
  .strict()

export const ArtifactInventorySchema = z
  .object({
    experimentId: SafeIdSchema,
    attemptId: SafeIdSchema,
    artifacts: z.array(ArtifactRecordSchema).min(1),
  })
  .strict()
  .superRefine((inventory, context) => {
    const prefix = `attempts/${inventory.attemptId}/`
    const paths = new Set<string>()
    for (const [index, artifact] of inventory.artifacts.entries()) {
      if (!artifact.path.startsWith(prefix))
        context.addIssue({
          code: "custom",
          path: ["artifacts", index, "path"],
          message: `must remain within ${prefix}`,
        })
      if (paths.has(artifact.path))
        context.addIssue({
          code: "custom",
          path: ["artifacts", index, "path"],
          message: "artifact paths must be unique",
        })
      paths.add(artifact.path)
    }
  })

export const AttemptCompletionSchema = z
  .object({
    schemaVersion: z.literal("seeker-attempt/v1"),
    experimentId: SafeIdSchema,
    attemptId: SafeIdSchema,
    completedAt: z.iso.datetime(),
    inventory: ArtifactInventorySchema,
  })
  .strict()
  .superRefine((completion, context) => {
    if (
      completion.experimentId !== completion.inventory.experimentId ||
      completion.attemptId !== completion.inventory.attemptId
    )
      context.addIssue({
        code: "custom",
        path: ["inventory"],
        message: "completion and inventory identities must match",
      })
  })

export const EligibilityRecordSchema = z
  .object({
    gate: z.object({ outcome: z.enum(["green", "red", "refused"]) }).strict(),
    criterion: z
      .object({
        id: z.string().min(1).max(128),
        version: z.string().min(1).max(64),
        outcome: z.enum(["passed", "failed", "unknown", "unavailable"]),
      })
      .strict(),
    eligible: z.boolean(),
    evidence: z.array(RepositoryRelativePathSchema).min(1),
  })
  .strict()
  .superRefine((record, context) => {
    const derived =
      record.gate.outcome === "green" && record.criterion.outcome === "passed"
    if (record.eligible !== derived)
      context.addIssue({
        code: "custom",
        path: ["eligible"],
        message: "must equal the derived gate and criterion outcome",
      })
  })

export type EligibilityRecord = z.infer<typeof EligibilityRecordSchema>

export const VerdictRecordSchema = z
  .object({
    schemaVersion: z.literal("seeker-verdict/v1"),
    experimentId: SafeIdSchema,
    attemptId: SafeIdSchema,
    candidateId: SafeIdSchema,
    verdict: TerminalVerdictSchema,
    actor: z.string().min(1).max(256),
    recordedAt: z.iso.datetime(),
    reasoning: z.string().min(10).max(10_000),
    evidence: z.array(RepositoryRelativePathSchema).min(1),
    eligibility: EligibilityRecordSchema,
  })
  .strict()

export type ExperimentManifestInput = {
  schemaVersion: "seeker-experiment/v1"
  id: string
  owner: string
  hypothesis: string
  criterion: z.input<typeof HypothesisCriterionSchema>
  comparisonAxis: z.input<typeof ComparisonAxisSchema>
  productionBenchmark: { path: string; identity: ResolvedIdentity }
  candidates: Array<{ id: string; identity: ResolvedIdentity }>
  lifecycle: z.input<typeof ExperimentLifecycleSchema>
}
