import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { basename, resolve } from "node:path"

import { boundedDiagnostic, createAttemptWriter } from "./artifacts"
import { ExperimentManifestSchema } from "./manifest"
import {
  AttemptCompletionSchema,
  ResolvedIdentitySchema,
  SafeIdSchema,
  type ResolvedIdentity,
} from "./types"

export type OfficialPromptResolution =
  | { ok: true; revision: string; contentHash: string; text?: string }
  | { ok: false; reason: string }

export type GeneratedEvidence = Record<string, unknown | string>

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

function safeDiagnostic(cause: unknown): {
  stage: "preflight" | "pipeline"
  reason: string
} {
  const message = cause instanceof Error ? cause.message : String(cause)
  return {
    stage: /preflight|manifest|benchmark|prompt/i.test(message)
      ? "preflight"
      : "pipeline",
    reason: boundedDiagnostic(cause),
  }
}

export async function runExperiment(
  input: RunExperimentInput,
): Promise<{ attemptDir: string; completed: true }> {
  let raw: unknown
  let manifestSource: string
  const manifestPath = resolve(input.experimentDir, "experiment.json")
  try {
    manifestSource = await readFile(manifestPath, "utf8")
    raw = JSON.parse(manifestSource)
  } catch (cause) {
    throw new Error(
      `experiment manifest could not be loaded: ${cause instanceof Error ? cause.message : String(cause)}`,
    )
  }
  const manifest = ExperimentManifestSchema.parse(raw)
  if (
    basename(resolve(input.experimentDir)) !== manifest.id ||
    resolve(input.experimentDir) !== resolve(input.experimentsRoot, manifest.id)
  ) {
    throw new Error(
      "experiment directory does not match the manifest repository identity",
    )
  }
  const writer = await createAttemptWriter(
    input.experimentsRoot,
    manifest.id,
    input.attemptId,
  )

  try {
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
    writer.registerSensitiveValues(Object.values(resolvedPromptTexts))

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
      ) as { candidates?: unknown }
      if (
        JSON.stringify(prior.candidates) !== JSON.stringify(resolvedIdentities)
      )
        throw new Error("reuse attempt resolved identity mismatch")
    }

    await writer.writeJson("resolved-identity.json", {
      schemaVersion: "seeker-resolved-identities/v1",
      experimentId: manifest.id,
      attemptId: input.attemptId,
      productionBenchmark: manifest.productionBenchmark.identity,
      candidates: resolvedIdentities,
    })
    const evidence = await input.generate({
      attemptDir: writer.attemptDir,
      manifest,
      resolvedIdentities,
      resolvedPromptTexts,
      ...(reuseAttemptDir ? { reuseAttemptDir } : {}),
    })
    for (const [path, value] of Object.entries(evidence)) {
      if (path === "resolved-identity.json" || path === "completion.json")
        throw new Error(
          `pipeline cannot overwrite coordinator artifact ${path}`,
        )
      if (typeof value === "string") await writer.writeText(path, value)
      else await writer.writeJson(path, value)
    }
    await writer.complete(REQUIRED_EVIDENCE)
    return { attemptDir: writer.attemptDir, completed: true }
  } catch (cause) {
    try {
      await writer.writeJson("diagnostic.json", safeDiagnostic(cause))
    } catch {
      // The original failure remains authoritative; an immutable diagnostic may already exist.
    }
    throw cause
  }
}
