import { spawn } from "node:child_process"
import { readFile, writeFile } from "node:fs/promises"
import { isAbsolute, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { z } from "zod"

import { createLocalCodexAccountReader } from "../services/precomputed-recommendations/codex-local-account"
import { createCodexSubscriptionAstraModel } from "../services/precomputed-recommendations/codex-subscription-astra"
import {
  ContextBudgetSchema,
  FullLibraryError,
  loadFullLibraryCorpus,
  planFullLibrary,
  runFullLibrary,
  sha256,
  type TokenCounter,
} from "../services/precomputed-recommendations/full-library-v1"

const absolute = z.string().refine(isAbsolute, "Absolute path required")
export const FullLibraryConfigSchema = z
  .object({
    corpusPath: absolute,
    corpusSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    sourceIds: z.array(z.string().min(1)).min(1),
    context: ContextBudgetSchema,
    tokenizer: z
      .object({
        executable: absolute,
        args: z.array(z.string()),
        /** Hash of the operator-reviewed local tokenizer script. */
        scriptPath: absolute,
        scriptSha256: z.string().regex(/^[a-f0-9]{64}$/u),
      })
      .strict(),
    runDirectory: absolute,
    planPath: absolute,
    admission: z
      .object({
        /** Explicit coordinator admission of complete corpus/eligibility and pilot sources. */
        admitted: z.literal(true),
        evidencePath: absolute,
        evidenceSha256: z.string().regex(/^[a-f0-9]{64}$/u),
      })
      .strict()
      .optional(),
    codexExecutable: absolute.optional(),
    minimumRemainingPercent: z.union([z.literal(0), z.literal(25)]).default(25),
    readingConcurrency: z.union([z.literal(1), z.literal(2)]).default(1),
  })
  .strict()
export type FullLibraryConfig = z.output<typeof FullLibraryConfigSchema>

/** Local tokenizer protocol: raw UTF-8 stdin -> one positive integer token count. No shell. */
export function commandTokenCounter(
  executable: string,
  args: string[],
): TokenCounter {
  const cache = new Map<string, number>()
  return async (text) => {
    const key = sha256(text)
    const cached = cache.get(key)
    if (cached !== undefined) return cached
    const measured = await new Promise<number>((resolveCount, reject) => {
      const child = spawn(executable, args, {
        stdio: ["pipe", "pipe", "ignore"],
        shell: false,
      })
      let output = "",
        settled = false
      const finish = (error?: FullLibraryError, count?: number) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (error) reject(error)
        else resolveCount(count!)
      }
      const timer = setTimeout(() => {
        child.kill("SIGKILL")
        finish(new FullLibraryError("tokenizer_timeout"))
      }, 60_000)
      child.on("error", () =>
        finish(new FullLibraryError("tokenizer_unavailable")),
      )
      child.stdin.on("error", () =>
        finish(new FullLibraryError("tokenizer_input_failed")),
      )
      child.stdout.on("data", (bytes: Buffer) => {
        output += bytes.toString("utf8")
        if (output.length > 64) {
          child.kill("SIGKILL")
          finish(new FullLibraryError("tokenizer_invalid"))
        }
      })
      child.on("close", (code) => {
        const count = Number(output.trim())
        if (
          code !== 0 ||
          !/^\d+\s*$/u.test(output) ||
          !Number.isSafeInteger(count) ||
          count < 1
        )
          finish(new FullLibraryError("tokenizer_invalid"))
        else finish(undefined, count)
      })
      child.stdin.end(text)
    })
    cache.set(key, measured)
    return measured
  }
}
async function verifyFile(path: string, digest: string): Promise<void> {
  if (sha256(await readFile(path)) !== digest)
    throw new FullLibraryError("evidence_digest_mismatch")
}
export async function fullLibraryCli(args: string[]): Promise<void> {
  if (
    args.length !== 3 ||
    !["plan", "run"].includes(args[0]) ||
    args[1] !== "--config" ||
    !isAbsolute(args[2])
  )
    throw new FullLibraryError("usage_plan_or_run_--config_absolute_path")
  const config = FullLibraryConfigSchema.parse(
    JSON.parse(await readFile(args[2], "utf8")),
  )
  await verifyFile(config.tokenizer.scriptPath, config.tokenizer.scriptSha256)
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
    const plan = await planFullLibrary({
      corpus,
      sourceIds: config.sourceIds,
      context: config.context,
      countTokens,
    })
    await writeFile(config.planPath, JSON.stringify(plan, null, 2) + "\n", {
      flag: "wx",
      mode: 0o600,
    })
    process.stdout.write(
      JSON.stringify({
        mode: plan.mode,
        readingCalls: plan.batches.length,
        fullLibraryMeasurement: plan.fullLibraryMeasurement,
        targetCount: plan.coverage.eligibleTargetIds.length,
        informationLoss: plan.informationLoss,
      }) + "\n",
    )
    return
  }
  if (!config.admission || !config.codexExecutable)
    throw new FullLibraryError("coordinator_admission_required")
  await verifyFile(
    config.admission.evidencePath,
    config.admission.evidenceSha256,
  )
  const saved = JSON.parse(await readFile(config.planPath, "utf8")) as Awaited<
    ReturnType<typeof planFullLibrary>
  >
  if (
    JSON.stringify(saved.sourceIds) !== JSON.stringify(config.sourceIds) ||
    JSON.stringify(saved.context) !== JSON.stringify(config.context)
  )
    throw new FullLibraryError("saved_plan_config_mismatch")
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
  })
  const result = await runFullLibrary({
    corpus,
    plan: saved,
    countTokens,
    model,
    runDirectory: config.runDirectory,
    readingConcurrency: config.readingConcurrency,
    executionManifest: {
      config,
      nodeVersion: process.version,
      cliSourceSha256: sha256(await readFile(fileURLToPath(import.meta.url))),
      generatorSourceSha256: sha256(
        await readFile(
          new URL(
            "../services/precomputed-recommendations/full-library-v1.ts",
            import.meta.url,
          ),
        ),
      ),
      transportSourceSha256: sha256(
        await readFile(
          new URL(
            "../services/precomputed-recommendations/codex-subscription-astra.ts",
            import.meta.url,
          ),
        ),
      ),
      accountRef: attestation.identity.accountRef,
      authMethod: "chatgpt",
      billingBasis: "included_subscription",
    },
  })
  process.stdout.write(
    JSON.stringify({
      version: result.version,
      runDirectory: config.runDirectory,
      sources: result.sources.map((source) => ({
        sourceVideoId: source.sourceVideoId,
        recommendations: source.recommendations.length,
      })),
    }) + "\n",
  )
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  void fullLibraryCli(process.argv.slice(2)).catch((error: unknown) => {
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
