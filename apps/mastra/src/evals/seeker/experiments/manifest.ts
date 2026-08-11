import { z } from "zod"

import {
  ComparisonAxisSchema,
  ExperimentLifecycleSchema,
  HypothesisCriterionSchema,
  RepositoryRelativePathSchema,
  ResolvedIdentitySchema,
  SafeIdSchema,
  type ComparisonAxis,
  type ExperimentManifestInput,
  type ResolvedIdentity,
} from "./types"

function comparable(value: unknown): string {
  return JSON.stringify(value)
}

export function resolvedIdentityMismatch(
  baseline: ResolvedIdentity,
  candidate: ResolvedIdentity,
  axis: ComparisonAxis,
): string[] {
  const mismatches: string[] = []
  if (baseline.prompt.provider !== candidate.prompt.provider)
    mismatches.push("prompt provider")
  if (baseline.prompt.name !== candidate.prompt.name)
    mismatches.push("prompt name")
  if (axis !== "prompt") {
    if (baseline.prompt.revision !== candidate.prompt.revision)
      mismatches.push("prompt revision")
    if (baseline.prompt.contentHash !== candidate.prompt.contentHash)
      mismatches.push("prompt content hash")
  }
  if (
    axis !== "model" &&
    comparable(baseline.model) !== comparable(candidate.model)
  )
    mismatches.push("model route identity")
  if (comparable(baseline.decoding) !== comparable(candidate.decoding))
    mismatches.push("decoding parameters")
  if (comparable(baseline.questionSet) !== comparable(candidate.questionSet))
    mismatches.push("question set")
  if (comparable(baseline.criteria) !== comparable(candidate.criteria))
    mismatches.push("criteria")
  if (comparable(baseline.judge) !== comparable(candidate.judge))
    mismatches.push("judge")
  if (comparable(baseline.retrieval) !== comparable(candidate.retrieval))
    mismatches.push("retrieval fixtures")
  if (comparable(baseline.runtime) !== comparable(candidate.runtime))
    mismatches.push("runtime configuration")
  return mismatches
}

const BaseManifestSchema = z
  .object({
    schemaVersion: z.literal("seeker-experiment/v1"),
    id: SafeIdSchema,
    owner: z.string().min(1).max(256),
    hypothesis: z.string().min(1).max(10_000),
    criterion: HypothesisCriterionSchema,
    comparisonAxis: ComparisonAxisSchema,
    productionBenchmark: z
      .object({
        path: RepositoryRelativePathSchema,
        identity: ResolvedIdentitySchema,
        // Bootstrap the first managed canonical benchmark without pretending
        // the legacy fallback artifact already carries managed provenance.
        // The coordinator exact-resolves and freshly executes this identity
        // before generating or comparing any candidate.
        captureExactManaged: z.literal(true).optional(),
      })
      .strict(),
    candidates: z
      .array(
        z
          .object({ id: SafeIdSchema, identity: ResolvedIdentitySchema })
          .strict(),
      )
      .min(1),
    lifecycle: ExperimentLifecycleSchema,
  })
  .strict()

export const ExperimentManifestSchema: z.ZodType<ExperimentManifestInput> =
  BaseManifestSchema.superRefine((manifest, context) => {
    const candidateIds = new Set<string>()
    const candidateAxisIdentities = new Set<string>()
    for (const [index, candidate] of manifest.candidates.entries()) {
      if (candidateIds.has(candidate.id))
        context.addIssue({
          code: "custom",
          path: ["candidates", index, "id"],
          message: "candidate IDs must be unique",
        })
      candidateIds.add(candidate.id)

      const axisIdentity = comparable(
        manifest.comparisonAxis === "prompt"
          ? {
              revision: candidate.identity.prompt.revision,
              contentHash: candidate.identity.prompt.contentHash,
            }
          : candidate.identity.model,
      )
      if (candidateAxisIdentities.has(axisIdentity))
        context.addIssue({
          code: "custom",
          path: ["candidates", index, "identity"],
          message: `candidate ${manifest.comparisonAxis} identities must be unique`,
        })
      candidateAxisIdentities.add(axisIdentity)

      const mismatches = resolvedIdentityMismatch(
        manifest.productionBenchmark.identity,
        candidate.identity,
        manifest.comparisonAxis,
      )
      if (mismatches.length > 0)
        context.addIssue({
          code: "custom",
          path: ["candidates", index, "identity"],
          message: `candidate drifts outside the ${manifest.comparisonAxis} axis: ${mismatches.join(", ")}`,
        })

      const axisChanged =
        manifest.comparisonAxis === "prompt"
          ? manifest.productionBenchmark.identity.prompt.revision !==
              candidate.identity.prompt.revision ||
            manifest.productionBenchmark.identity.prompt.contentHash !==
              candidate.identity.prompt.contentHash
          : comparable(manifest.productionBenchmark.identity.model) !==
            comparable(candidate.identity.model)
      if (!axisChanged)
        context.addIssue({
          code: "custom",
          path: ["candidates", index, "identity"],
          message: `candidate must change the declared ${manifest.comparisonAxis} axis`,
        })
    }
  })

const allowedTransitions = {
  draft: new Set(["executing"]),
  executing: new Set(["executing", "review-ready"]),
  "review-ready": new Set<string>(),
} as const

export function validateLifecycleTransition(
  from: z.infer<typeof ExperimentLifecycleSchema>,
  to: z.infer<typeof ExperimentLifecycleSchema>,
): { ok: true } | { ok: false; reason: string } {
  if (allowedTransitions[from].has(to)) return { ok: true }
  return {
    ok: false,
    reason: `invalid experiment lifecycle transition: ${from} -> ${to}`,
  }
}
