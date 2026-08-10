import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { basename, resolve } from "node:path"
import { z } from "zod"

import {
  boundedDiagnostic,
  createAttemptWriter,
  scanExperimentPackage,
} from "./artifacts"
import {
  asExperimentExecutionError,
  ExperimentExecutionError,
  type ExperimentFailureStage,
} from "./errors"
import { ExperimentManifestSchema } from "./manifest"
import { sha256 } from "../hashes"
import {
  AttemptCompletionSchema,
  ResolvedIdentitySchema,
  SafeIdSchema,
  type ResolvedIdentity,
} from "./types"

export type OfficialPromptResolution =
  | { ok: true; revision: string; contentHash: string; text?: string }
  | { ok: false; reason: string }

const aggregateEvidence = (schemaVersion: string) =>
  z
    .object({
      schemaVersion: z.literal(schemaVersion),
      productionBenchmark: z.unknown().optional(),
      candidates: z.record(z.string(), z.unknown()),
    })
    .strict()

const GeneratedEvidenceSchema = z
  .object({
    "answers.json": aggregateEvidence("seeker-experiment-answers/v1"),
    "transcripts.json": aggregateEvidence("seeker-experiment-transcripts/v1"),
    "judged.json": aggregateEvidence("seeker-experiment-judged/v1"),
    "score.json": aggregateEvidence("seeker-experiment-scores/v1"),
    "comparison.md": z.string().min(1),
    "gate-report.json": aggregateEvidence("seeker-experiment-gates/v1"),
  })
  .strict()

export type GeneratedEvidence = z.infer<typeof GeneratedEvidenceSchema>

export type RunExperimentInput = {
  experimentsRoot: string
  experimentDir: string
  attemptId: string
  reuseAttemptId?: string
  loadBenchmarkIdentity?: (path: string) => Promise<ResolvedIdentity>
  resolvePrompt: (input: {
    provider: string
    name: string
    revision: string
    contentHash: string
  }) => Promise<OfficialPromptResolution>
  generate: (input: {
    attemptDir: string
    manifest: ReturnType<typeof ExperimentManifestSchema.parse>
    resolvedIdentities: Record<string, ResolvedIdentity>
    resolvedPromptTexts: Record<string, string>
    resolvedProductionPromptText?: string
    reuseAttemptDir?: string
  }) => Promise<GeneratedEvidence>
}

const REQUIRED_EVIDENCE = [
  "resolved-identity.json",
  "answers.json",
  "transcripts.json",
  "judged.json",
  "score.json",
  "comparison.md",
  "gate-report.json",
] as const

function sameIdentity(
  left: ResolvedIdentity,
  right: ResolvedIdentity,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function manifestPolicyHash(manifest: unknown): string {
  return sha256(JSON.stringify(manifest))
}

function safeDiagnostic(cause: ExperimentExecutionError): {
  stage: "preflight" | "pipeline"
  reason: string
} {
  return {
    stage: cause.stage,
    reason: boundedDiagnostic(cause),
  }
}

export async function runExperiment(
  input: RunExperimentInput,
): Promise<{ attemptDir: string; completed: true }> {
  let stage: ExperimentFailureStage = "preflight"
  let raw: unknown
  let manifestSource: string
  const manifestPath = resolve(input.experimentDir, "experiment.json")
  try {
    manifestSource = await readFile(manifestPath, "utf8")
    raw = JSON.parse(manifestSource)
  } catch (cause) {
    throw new ExperimentExecutionError(
      "preflight",
      new Error(
        `experiment manifest could not be loaded: ${cause instanceof Error ? cause.message : String(cause)}`,
      ),
    )
  }
  let manifest: ReturnType<typeof ExperimentManifestSchema.parse>
  let policyHash: string
  let writer: Awaited<ReturnType<typeof createAttemptWriter>>
  try {
    manifest = ExperimentManifestSchema.parse(raw)
    policyHash = manifestPolicyHash(manifest)
    if (
      basename(resolve(input.experimentDir)) !== manifest.id ||
      resolve(input.experimentDir) !==
        resolve(input.experimentsRoot, manifest.id)
    ) {
      throw new Error(
        "experiment directory does not match the manifest repository identity",
      )
    }
    writer = await createAttemptWriter(
      input.experimentsRoot,
      manifest.id,
      input.attemptId,
    )
  } catch (cause) {
    throw asExperimentExecutionError(cause, "preflight")
  }

  try {
    let resolvedProductionPromptText: string | undefined
    if (manifest.productionBenchmark.captureExactManaged) {
      const expected = manifest.productionBenchmark.identity.prompt
      const resolution = await input.resolvePrompt({
        provider: expected.provider,
        name: expected.name,
        revision: expected.revision,
        contentHash: expected.contentHash,
      })
      if (
        !resolution.ok ||
        resolution.revision !== expected.revision ||
        resolution.contentHash !== expected.contentHash ||
        resolution.text == null
      ) {
        const reason = resolution.ok
          ? "immutable identity mismatch"
          : resolution.reason
        throw new Error(
          `official prompt preflight refused production benchmark: ${reason}`,
        )
      }
      resolvedProductionPromptText = resolution.text
    } else {
      const loadedBaseline = input.loadBenchmarkIdentity
        ? await input.loadBenchmarkIdentity(manifest.productionBenchmark.path)
        : manifest.productionBenchmark.identity
      if (
        !sameIdentity(
          ResolvedIdentitySchema.parse(loadedBaseline),
          manifest.productionBenchmark.identity,
        )
      ) {
        throw new Error("benchmark identity mismatch during official preflight")
      }
    }

    const resolvedIdentities: Record<string, ResolvedIdentity> = {}
    const resolvedPromptTexts: Record<string, string> = {}
    for (const candidate of manifest.candidates) {
      const expected = candidate.identity.prompt
      const resolution = await input.resolvePrompt({
        provider: expected.provider,
        name: expected.name,
        revision: expected.revision,
        contentHash: expected.contentHash,
      })
      if (
        !resolution.ok ||
        resolution.revision !== expected.revision ||
        resolution.contentHash !== expected.contentHash
      ) {
        const reason = resolution.ok
          ? "immutable identity mismatch"
          : resolution.reason
        throw new Error(
          `official prompt preflight refused candidate ${candidate.id}: ${reason}`,
        )
      }
      resolvedIdentities[candidate.id] = candidate.identity
      if (resolution.text != null)
        resolvedPromptTexts[candidate.id] = resolution.text
    }
    writer.registerSensitiveValues([
      ...Object.values(resolvedPromptTexts),
      ...(resolvedProductionPromptText ? [resolvedProductionPromptText] : []),
    ])

    if ((await readFile(manifestPath, "utf8")) !== manifestSource) {
      throw new Error("experiment manifest changed during preflight")
    }

    let reuseAttemptDir: string | undefined
    if (input.reuseAttemptId != null) {
      SafeIdSchema.parse(input.reuseAttemptId)
      reuseAttemptDir = resolve(
        input.experimentDir,
        "attempts",
        input.reuseAttemptId,
      )
      const completion = AttemptCompletionSchema.parse(
        JSON.parse(
          await readFile(resolve(reuseAttemptDir, "completion.json"), "utf8"),
        ),
      )
      if (
        completion.experimentId !== manifest.id ||
        completion.attemptId !== input.reuseAttemptId
      )
        throw new Error("reuse attempt identity mismatch")
      for (const artifact of completion.inventory.artifacts) {
        const relativePath = artifact.path.replace(
          `attempts/${input.reuseAttemptId}/`,
          "",
        )
        const content = await readFile(resolve(reuseAttemptDir, relativePath))
        if (
          createHash("sha256").update(content).digest("hex") !== artifact.sha256
        )
          throw new Error(
            `reuse attempt artifact integrity mismatch: ${relativePath}`,
          )
      }
      const prior = JSON.parse(
        await readFile(
          resolve(reuseAttemptDir, "resolved-identity.json"),
          "utf8",
        ),
      ) as { candidates?: unknown; manifestPolicyHash?: unknown }
      if (prior.manifestPolicyHash !== policyHash)
        throw new Error("reuse attempt manifest policy mismatch")
      if (
        JSON.stringify(prior.candidates) !== JSON.stringify(resolvedIdentities)
      )
        throw new Error("reuse attempt resolved identity mismatch")
    }

    await writer.writeJson("resolved-identity.json", {
      schemaVersion: "seeker-resolved-identities/v1",
      experimentId: manifest.id,
      attemptId: input.attemptId,
      manifestPolicyHash: policyHash,
      productionBenchmark: manifest.productionBenchmark.identity,
      candidates: resolvedIdentities,
    })
    stage = "pipeline"
    const evidence = GeneratedEvidenceSchema.parse(
      await input.generate({
        attemptDir: writer.attemptDir,
        manifest,
        resolvedIdentities,
        resolvedPromptTexts,
        ...(resolvedProductionPromptText
          ? { resolvedProductionPromptText }
          : {}),
        ...(reuseAttemptDir ? { reuseAttemptDir } : {}),
      }),
    )
    for (const [path, value] of Object.entries(evidence)) {
      if (path === "resolved-identity.json" || path === "completion.json")
        throw new Error(
          `pipeline cannot overwrite coordinator artifact ${path}`,
        )
      if (typeof value === "string") await writer.writeText(path, value)
      else await writer.writeJson(path, value)
    }
    // complete() performs the sensitive-value and sensitive-key scan before
    // its final exclusive write of completion.json. The package scan then
    // verifies the published inventory and rejects any untracked sidecars.
    await writer.complete(REQUIRED_EVIDENCE)
    await scanExperimentPackage(
      input.experimentsRoot,
      manifest.id,
      input.attemptId,
      [
        ...Object.values(resolvedPromptTexts),
        ...(resolvedProductionPromptText ? [resolvedProductionPromptText] : []),
      ],
    )
    return { attemptDir: writer.attemptDir, completed: true }
  } catch (cause) {
    const error = asExperimentExecutionError(cause, stage)
    try {
      await writer.writeJson("diagnostic.json", safeDiagnostic(error))
    } catch {
      // The original failure remains authoritative; an immutable diagnostic may already exist.
    }
    throw error
  }
}
