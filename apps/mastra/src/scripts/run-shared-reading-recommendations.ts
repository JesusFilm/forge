import { readFile, writeFile } from "node:fs/promises"
import { isAbsolute, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { z } from "zod"

import { createLocalCodexAccountReader } from "../services/precomputed-recommendations/codex-local-account"
import { createCodexSubscriptionAstraModel } from "../services/precomputed-recommendations/codex-subscription-astra"
import {
  FullLibraryError,
  loadFullLibraryCorpus,
  sha256,
} from "../services/precomputed-recommendations/full-library-v1"
import {
  planSharedReading,
  prepareSharedReadingReuse,
  SharedReadingReuseSchema,
  runSharedReading,
  type SharedReadingPlan,
} from "../services/precomputed-recommendations/shared-reading-v1"
import {
  commandTokenCounter,
  FullLibraryConfigSchema,
} from "./run-full-library-recommendations"

export const SharedReadingConfigSchema = FullLibraryConfigSchema.extend({
  readingReuse: SharedReadingReuseSchema.optional(),
  sourceIds: z.array(z.string().min(1)).min(1).optional(),
  maxSourcesPerGroup: z.number().int().min(1).max(4).default(4),
  readingConcurrency: z.union([z.literal(1), z.literal(2)]).default(2),
})
export type SharedReadingConfig = z.output<typeof SharedReadingConfigSchema>
function validatePlanConfig(
  plan: SharedReadingPlan,
  config: SharedReadingConfig,
  allIds: string[],
) {
  if (
    JSON.stringify(plan.sourceIds) !==
      JSON.stringify(config.sourceIds ?? allIds) ||
    JSON.stringify(plan.context) !== JSON.stringify(config.context) ||
    plan.maxSourcesPerGroup !== config.maxSourcesPerGroup ||
    JSON.stringify(
      plan.readingReuse
        ? {
            parentRunDirectory: plan.readingReuse.parentRunDirectory,
            parentManifestSha256: plan.readingReuse.parentManifestSha256,
          }
        : undefined,
    ) !== JSON.stringify(config.readingReuse)
  )
    throw new FullLibraryError("saved_plan_config_mismatch")
}
async function verify(path: string, digest: string) {
  if (sha256(await readFile(path)) !== digest)
    throw new FullLibraryError("evidence_digest_mismatch")
}
export async function sharedReadingCli(args: string[]) {
  if (
    args.length !== 3 ||
    !["plan", "run"].includes(args[0]) ||
    args[1] !== "--config" ||
    !isAbsolute(args[2])
  )
    throw new FullLibraryError("usage_plan_or_run_--config_absolute_path")
  const config = SharedReadingConfigSchema.parse(
    JSON.parse(await readFile(args[2], "utf8")),
  )
  await verify(config.tokenizer.scriptPath, config.tokenizer.scriptSha256)
  if (!config.tokenizer.args.includes(config.tokenizer.scriptPath))
    throw new FullLibraryError("tokenizer_script_not_invoked")
  const corpus = await loadFullLibraryCorpus(
    config.corpusPath,
    config.corpusSha256,
  )
  const countTokens = commandTokenCounter(
    config.tokenizer.executable,
    config.tokenizer.args,
  )
  if (args[0] === "plan") {
    const plan = config.readingReuse
      ? (
          await prepareSharedReadingReuse({
            corpus,
            readingReuse: config.readingReuse,
            countTokens,
          })
        ).plan
      : await planSharedReading({
          corpus,
          sourceIds: config.sourceIds,
          context: config.context,
          countTokens,
          maxSourcesPerGroup: config.maxSourcesPerGroup,
        })
    validatePlanConfig(
      plan,
      config,
      corpus.entries.map((e) => e.video.id).sort(),
    )
    await writeFile(config.planPath, JSON.stringify(plan, null, 2) + "\n", {
      flag: "wx",
      mode: 0o600,
    })
    process.stdout.write(
      JSON.stringify({
        version: plan.version,
        sources: plan.sourceIds.length,
        groups: plan.groups.length,
        readingCalls: plan.groups.reduce((n, g) => n + g.readings.length, 0),
        targetCount: plan.coverage.eligibleTargetIds.length,
        warning:
          "Offline plan only. Output-driven splits/usage/quality/allowance fit unmeasured.",
      }) + "\n",
    )
    return
  }
  if (!config.admission || !config.codexExecutable)
    throw new FullLibraryError("coordinator_admission_required")
  await verify(config.admission.evidencePath, config.admission.evidenceSha256)
  const plan = JSON.parse(
    await readFile(config.planPath, "utf8"),
  ) as SharedReadingPlan
  validatePlanConfig(plan, config, corpus.entries.map((e) => e.video.id).sort())
  const account = createLocalCodexAccountReader({
    codexExecutable: config.codexExecutable,
    minimumRemainingPercent: config.minimumRemainingPercent,
  })
  const attestation = await account.readAttestation()
  if (attestation.admission !== "admitted")
    throw new FullLibraryError("included_allowance_unavailable")
  const model = createCodexSubscriptionAstraModel({
    codexExecutable: config.codexExecutable,
    initiatingAccountRef: attestation.identity.accountRef,
    readAllowance: account.readAllowance,
    readOperatorIdentity: account.readOperatorIdentity,
    minimumRemainingPercent: config.minimumRemainingPercent,
    concurrency: config.readingConcurrency,
    timeoutMs: config.timeoutMs,
  })
  const sourceFiles = [
    new URL("./run-shared-reading-recommendations.ts", import.meta.url),
    new URL("./run-full-library-recommendations.ts", import.meta.url),
    new URL(
      "../services/precomputed-recommendations/shared-reading-v1.ts",
      import.meta.url,
    ),
    new URL(
      "../services/precomputed-recommendations/full-library-v1.ts",
      import.meta.url,
    ),
    new URL(
      "../services/precomputed-recommendations/codex-subscription-astra.ts",
      import.meta.url,
    ),
    new URL(
      "../services/precomputed-recommendations/codex-local-account.ts",
      import.meta.url,
    ),
    new URL(
      "../services/precomputed-recommendations/selected-transcript.ts",
      import.meta.url,
    ),
    new URL(
      "../services/precomputed-recommendations/source-generation.ts",
      import.meta.url,
    ),
  ]
  const sourceHashes = Object.fromEntries(
    await Promise.all(
      sourceFiles.map(async (url) => [
        fileURLToPath(url),
        sha256(await readFile(url)),
      ]),
    ),
  )
  const result = await runSharedReading({
    corpus,
    plan,
    countTokens,
    model,
    runDirectory: config.runDirectory,
    readingConcurrency: config.readingConcurrency,
    executionManifest: {
      config,
      sourceHashes,
      nodeVersion: process.version,
      accountRef: attestation.identity.accountRef,
      authMethod: "chatgpt",
      billingBasis: "included_subscription",
    },
  })
  process.stdout.write(
    JSON.stringify({
      version: result.version,
      runDirectory: config.runDirectory,
      sources: result.sources.map((s) => ({
        sourceVideoId: s.sourceVideoId,
        recommendations: s.recommendations.length,
      })),
    }) + "\n",
  )
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  void sharedReadingCli(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(
      JSON.stringify({
        status: "stopped",
        code:
          error instanceof FullLibraryError
            ? error.code
            : "validation_or_transport_failed",
      }) + "\n",
    )
    process.exitCode = 1
  })
}
