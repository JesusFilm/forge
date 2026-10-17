import { randomUUID } from "node:crypto"
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { z } from "zod"
import { RecommendationInputError } from "../services/recommendations/errors"
import {
  executeRetirementCampaign,
  makeRetirementCampaignPlan,
  validateRetirementCampaignPlan,
} from "../services/recommendations/legacy-detail-retirement-campaign"
import {
  freezeLegacyDetailRetirement,
  hasCompletedLegacyDetailRetirementReceipt,
  runLegacyDetailRetirement,
  type LegacyDetailRetirementManifest,
} from "../services/recommendations/legacy-detail-retirement.service"
import { conversionDatabaseHash } from "../services/recommendations/legacy-candidate-trace-conversion.service"

const Progress = z.object({
  planDigest: z.string().regex(/^[a-f0-9]{64}$/),
  nextBatch: z.number().int().nonnegative(),
  converted: z.number().int().nonnegative(),
  retired: z.number().int().nonnegative(),
  rows: z.number().int().nonnegative(),
  bytes: z.number().int().nonnegative(),
})

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"))
}

function writePrivate(path: string, value: unknown): void {
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n", {
    mode: 0o600,
    flag: "wx",
  })
}

function replacePrivate(path: string, value: unknown): void {
  const temporary = `${path}.${randomUUID()}.tmp`
  writePrivate(temporary, value)
  renameSync(temporary, path)
}

export function parseRetirementCampaignArguments(argv: string[]): {
  values: Map<string, string>
  execute: boolean
} {
  const values = new Map<string, string>()
  const execute = argv.filter((arg) => arg === "--execute").length === 1
  if (argv.filter((arg) => arg === "--execute").length > 1)
    throw new RecommendationInputError("Duplicate execute flag")
  const pairs = argv.filter((arg) => arg !== "--execute")
  const allowed = new Set([
    "--freeze-plan",
    "--run-ids",
    "--created-before",
    "--stop-after",
    "--min-free-bytes",
    "--max-wal-bytes",
    "--plan",
    "--holds",
    "--capacity",
    "--batch-dir",
    "--max-batches",
    "--confirm-plan",
    "--confirm-target",
  ])
  for (let i = 0; i < pairs.length; i += 2) {
    const key = pairs[i]
    const value = pairs[i + 1]
    if (
      !key ||
      !allowed.has(key) ||
      !value ||
      value.startsWith("--") ||
      values.has(key)
    )
      throw new RecommendationInputError("Invalid campaign option")
    values.set(key, value)
  }
  const freeze = values.has("--freeze-plan")
  const required = freeze
    ? [
        "--freeze-plan",
        "--run-ids",
        "--created-before",
        "--stop-after",
        "--min-free-bytes",
        "--max-wal-bytes",
      ]
    : [
        "--plan",
        "--holds",
        "--capacity",
        "--batch-dir",
        "--max-batches",
        "--confirm-plan",
        "--confirm-target",
      ]
  if (
    values.size !== required.length ||
    required.some((key) => !values.has(key)) ||
    execute === freeze
  )
    throw new RecommendationInputError("Incomplete campaign options")
  return { values, execute }
}

async function main(): Promise<void> {
  const { values: args } = parseRetirementCampaignArguments(
    process.argv.slice(2),
  )
  const { createPrismaClient } = await import("../db/client")
  const db = createPrismaClient("main")
  try {
    if (args.has("--freeze-plan")) {
      const runIds = z
        .array(z.string().min(1).max(191))
        .min(1)
        .max(300_000)
        .parse(readJson(args.get("--run-ids")!))
      const plan = makeRetirementCampaignPlan({
        version: 1,
        targetDatabaseHash: await conversionDatabaseHash(db),
        createdBefore: args.get("--created-before")!,
        frozenAt: new Date().toISOString(),
        stopAfter: args.get("--stop-after")!,
        minFilesystemAvailableBytes: Number(args.get("--min-free-bytes")),
        maxWalBytes: Number(args.get("--max-wal-bytes")),
        runIds: [...runIds].sort(),
      })
      writePrivate(args.get("--freeze-plan")!, plan)
      console.log(
        JSON.stringify({
          status: "frozen",
          digest: plan.digest,
          runs: plan.runIds.length,
          batches: Math.ceil(plan.runIds.length / 10),
        }),
      )
      return
    }

    const plan: unknown = readJson(args.get("--plan")!)
    validateRetirementCampaignPlan(plan)
    if (
      args.get("--confirm-plan") !== plan.digest ||
      args.get("--confirm-target") !== plan.targetDatabaseHash ||
      (await conversionDatabaseHash(db)) !== plan.targetDatabaseHash
    )
      throw new RecommendationInputError(
        "Campaign target or review digest mismatch",
      )
    const directory = args.get("--batch-dir")!
    if (!existsSync(directory)) mkdirSync(directory, { mode: 0o700 })
    const progressPath = join(directory, "progress.json")
    const batchPath = (index: number) =>
      join(directory, `batch-${String(index).padStart(6, "0")}.json`)
    const campaign = await executeRetirementCampaign(
      plan,
      Number(args.get("--max-batches")),
      {
        readCapacity: () => readJson(args.get("--capacity")!),
        readHolds: () => readJson(args.get("--holds")!),
        readProgress: () =>
          existsSync(progressPath)
            ? Progress.parse(readJson(progressPath))
            : undefined,
        saveProgress: (progress) => replacePrivate(progressPath, progress),
        readManifest: (index) =>
          existsSync(batchPath(index))
            ? (readJson(batchPath(index)) as LegacyDetailRetirementManifest)
            : undefined,
        hasCompletedReceipt: (manifest) =>
          hasCompletedLegacyDetailRetirementReceipt(db, manifest),
        saveManifest: (index, manifest) =>
          writePrivate(batchPath(index), manifest),
        freeze: (runIds, holds) =>
          freezeLegacyDetailRetirement(db, {
            runIds,
            createdBefore: plan.createdBefore,
            holds,
          }),
        execute: (manifest) =>
          runLegacyDetailRetirement(db, manifest, {
            execute: true,
            confirmTarget: plan.targetDatabaseHash,
          }),
      },
    )
    console.log(
      JSON.stringify({
        status: campaign.status,
        planDigest: plan.digest,
        completedBatches: campaign.progress.nextBatch,
        totalBatches: campaign.totalBatches,
        converted: campaign.progress.converted,
        retired: campaign.progress.retired,
        rows: campaign.progress.rows,
        bytes: campaign.progress.bytes,
      }),
    )
  } finally {
    await db.$disconnect()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch(() => {
    console.error(
      "Finite legacy detail campaign stopped; no private IDs were logged.",
    )
    process.exitCode = 1
  })
