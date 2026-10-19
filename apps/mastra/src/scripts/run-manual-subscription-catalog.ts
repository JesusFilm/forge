import { subscriptionModelIdSchema } from "../services/precomputed-recommendations/subscription-model"
import { execFile } from "node:child_process"
import { readFile, stat } from "node:fs/promises"
import { isAbsolute } from "node:path"
import { promisify } from "node:util"

import { z } from "zod"

import { createLocalCodexAccountReader } from "../services/precomputed-recommendations/codex-local-account"
import { createCodexSubscriptionAstraModel } from "../services/precomputed-recommendations/codex-subscription-astra"
import { createContentProfilePersistence } from "../services/precomputed-recommendations/content-profile-client"
import { createEdgeBatchPersistence } from "../services/precomputed-recommendations/edge-batch-client"
import {
  createGaCaptureImportClient,
  gaImportDestinationSchema,
} from "../services/precomputed-recommendations/ga-capture-import-client"
import { loadImportedGaWatchHistory } from "../services/precomputed-recommendations/ga-capture-import-reader"
import { createAdminGaCaptureTransport } from "../services/precomputed-recommendations/ga-watch-capture-transport"
import {
  runManualSubscriptionCatalog,
  type ManualSubscriptionCatalogInput,
} from "../services/precomputed-recommendations/manual-subscription-catalog"
import { createAdminSourceDependencies } from "../services/precomputed-recommendations/source-generation"
import { loadFrozenCatalog } from "../services/precomputed-recommendations/frozen-catalog"

const runFile = promisify(execFile)
const id = z.string().trim().min(1).max(191)
const digest = z.string().regex(/^[a-f0-9]{64}$/u)
const localPath = z.string().min(1).refine(isAbsolute)
const baseInputSchema = z
  .object({
    invocation: z.enum(["start", "resume"]),
    modelId: subscriptionModelIdSchema.optional(),
    generationId: id,
    generationInputDigest: digest,
    attemptId: z.uuid(),
    inputCutoff: z.string().datetime(),
    initiatingAccountRef: z.string().regex(/^[A-Za-z0-9:_-]{8,128}$/u),
    reviewed: z
      .object({
        sourceVideoIds: z.array(id).min(1).max(20_000),
        sourceSetDigest: digest,
        selectedCorpusDigest: digest,
        candidatePoolDigest: digest,
      })
      .strict(),
    profileReplacement: z
      .object({
        videoId: id,
        cacheKey: digest,
        partIndex: z.number().int().min(0).max(63),
        originalCallId: z.uuid(),
        originalReceiptDigest: digest,
        replacementCallId: z.uuid(),
        oldProcessExitedAttested: z.literal(true),
      })
      .strict()
      .optional(),
    recovery: z
      .object({
        originalCallId: z.uuid(),
        replacementCallId: z.uuid(),
        oldProcessExitedAttested: z.literal(true),
      })
      .strict()
      .optional(),
    work: z.discriminatedUnion("mode", [
      z.object({ mode: z.literal("full") }).strict(),
      z
        .object({
          mode: z.literal("pilot"),
          sources: z
            .array(
              z
                .object({
                  sourceVideoId: id,
                  exclusiveEndRank: z.number().int().nonnegative().max(128),
                })
                .strict(),
            )
            .min(1)
            .max(20_000),
        })
        .strict(),
    ]),
  })
  .strict()
const inputSchema: z.ZodType<ManualSubscriptionCatalogInput> = z
  .union([
    baseInputSchema
      .extend({
        destination: gaImportDestinationSchema,
        originGenerationId: id,
      })
      .strict(),
    baseInputSchema
      .extend({
        analyticsPolicy: z.literal("disabled_by_operator_v1"),
        modelId: z.literal("gpt-6.1-sol"),
        recovery: z.never().optional(),
      })
      .strict(),
  ])
  .refine(
    (value) =>
      !value.profileReplacement ||
      (value.invocation === "resume" &&
        !value.recovery &&
        value.profileReplacement.originalCallId !==
          value.profileReplacement.replacementCallId),
  )
const capacityMeasurement = z
  .object({
    measuredAt: z.string().datetime(),
    clusterSystemId: z.string().regex(/^\d{1,20}$/u),
    observedDbBytes: z.number().int().nonnegative().safe(),
    availableBytes: z.number().int().nonnegative().safe(),
    reserveBytes: z.number().int().nonnegative().safe(),
    projectedBytes: z.number().int().nonnegative().safe(),
    sampleSourceCount: z.number().int().positive().safe(),
    sampleBytes: z.number().int().positive().safe(),
    source: z.literal("operator_verified_pgdata_df"),
  })
  .strict()
const configSchema = z
  .object({
    input: inputSchema,
    concurrency: z.number().int().min(1).max(16).optional(),
    minCallStartIntervalMs: z.number().int().min(0).max(30_000).optional(),
    minimumRemainingPercent: z.union([z.literal(0), z.literal(25)]).optional(),
    frozenCatalog: z
      .object({ path: localPath, sha256: digest })
      .strict()
      .optional(),
    codexExecutable: localPath,
    stagingDirectory: localPath,
    capacityProbe: z
      .object({
        executable: localPath,
        args: z.array(z.string().max(256)).max(16),
      })
      .strict(),
  })
  .strict()
  .refine(
    (value) => !value.frozenCatalog || value.input.invocation === "resume",
  )
  .refine(
    (value) =>
      value.input.analyticsPolicy !== "disabled_by_operator_v1" ||
      (value.minimumRemainingPercent ?? 25) === 25,
  )

export function parseManualCatalogCommand(raw: unknown, args: string[]) {
  if (
    args.length !== 3 ||
    args[0] !== "--config" ||
    !isAbsolute(args[1] ?? "") ||
    args[2] !== "--execute" ||
    process.platform === "win32" ||
    process.env.CI ||
    process.env.RAILWAY_ENVIRONMENT ||
    process.env.RAILWAY_ENVIRONMENT_NAME ||
    process.env.RAILWAY_SERVICE_ID
  )
    throw new Error("manual_operator_only")
  return configSchema.parse(raw)
}

async function main(args: string[]) {
  if (args.length !== 3 || args[0] !== "--config" || args[2] !== "--execute")
    throw new Error("manual_operator_only")
  const path = args[1] ?? ""
  if (!isAbsolute(path) || (await stat(path)).size > 2_000_000)
    throw new Error("manual_config_invalid")
  const config = parseManualCatalogCommand(
    JSON.parse(await readFile(path, "utf8")) as unknown,
    args,
  )
  const [codexFile, capacityFile, staging] = await Promise.all([
    stat(config.codexExecutable),
    stat(config.capacityProbe.executable),
    stat(config.stagingDirectory),
  ])
  if (!codexFile.isFile() || !capacityFile.isFile() || !staging.isDirectory())
    throw new Error("manual_config_invalid")
  const account = createLocalCodexAccountReader({
    codexExecutable: config.codexExecutable,
    modelId: config.input.modelId,
    minimumRemainingPercent: config.minimumRemainingPercent,
  })
  const model = createCodexSubscriptionAstraModel({
    codexExecutable: config.codexExecutable,
    modelId: config.input.modelId,
    initiatingAccountRef: config.input.initiatingAccountRef,
    readOperatorIdentity: account.readOperatorIdentity,
    readAllowance: account.readAllowance,
    concurrency: config.concurrency,
    minCallStartIntervalMs: config.minCallStartIntervalMs,
    minimumRemainingPercent: config.minimumRemainingPercent,
  })
  const admin = createAdminSourceDependencies()
  const catalog = config.frozenCatalog
    ? await loadFrozenCatalog({ ...config.frozenCatalog, scope: config.input })
    : admin.catalog
  // Intentionally do not construct GA/import/auth capabilities in content-only mode.
  const historyPorts =
    config.input.analyticsPolicy === "disabled_by_operator_v1"
      ? {}
      : (() => {
          const importClient = createGaCaptureImportClient(admin.ingest)
          const transport = createAdminGaCaptureTransport()
          return {
            importClient,
            loadImport: (
              destination: import("../services/precomputed-recommendations/ga-capture-import-client").GaImportDestination,
            ) =>
              loadImportedGaWatchHistory({
                destination,
                client: importClient,
                transport,
                directory: config.stagingDirectory,
              }),
          }
        })()
  const controller = new AbortController()
  const pause = () => controller.abort()
  process.on("SIGINT", pause)
  process.on("SIGTERM", pause)
  const result = await runManualSubscriptionCatalog(
    config.input,
    {
      catalog,
      ingest: admin.ingest,
      model,
      readAttestation: account.readAttestation,
      profilePersistence: createContentProfilePersistence(admin.ingest),
      edgePersistence: createEdgeBatchPersistence(admin.ingest),
      ...historyPorts,
      async measureCapacity(probe) {
        const { stdout } = await runFile(
          config.capacityProbe.executable,
          [...config.capacityProbe.args, JSON.stringify(probe)],
          { timeout: 30_000, maxBuffer: 4_096, windowsHide: true },
        )
        return capacityMeasurement.parse(JSON.parse(stdout) as unknown)
      },
    },
    {
      concurrency: config.concurrency,
      signal: controller.signal,
      minimumRemainingPercent: config.minimumRemainingPercent,
    },
  ).finally(() => {
    process.off("SIGINT", pause)
    process.off("SIGTERM", pause)
  })
  process.stdout.write(JSON.stringify(result) + "\n")
  if (result.state !== "completed" && result.reason !== "pilot_boundary")
    process.exitCode = 1
}

if (process.argv[1]?.endsWith("run-manual-subscription-catalog.ts")) {
  void main(process.argv.slice(2)).catch((error: unknown) => {
    const code =
      error && typeof error === "object" && "code" in error
        ? error.code
        : "manual_command_failed"
    process.stderr.write(JSON.stringify({ state: "stopped", code }) + "\n")
    process.exitCode = 1
  })
}
