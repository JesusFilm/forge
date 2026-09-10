/** Run from apps/admin: pnpm exec tsx --env-file=.env scripts/import-recommendation-pools.ts ... */
import { readFile, stat, writeFile } from "node:fs/promises"
import { parseArgs } from "node:util"
import { PrismaClient } from "@prisma/client"
import { z } from "zod"
import { env } from "../src/config/env"
import { CuratedPoolsService } from "../src/services/recommendations/curated-pools.service"
import {
  CURATED_POOL_MAX_SOURCE_BYTES,
  CuratedPoolCoverageError,
} from "../src/services/recommendations/curated-pools.types"

const contextSchema = z
  .array(
    z.object({
      locale: z.string(),
      audioLanguageSlug: z.string(),
      coreLanguageId: z.string(),
    }),
  )
  .min(1)
  .max(10_000)

async function readJson(path: string | undefined): Promise<unknown> {
  if (!path) throw new Error("An explicit input file is required")
  if ((await stat(path)).size > CURATED_POOL_MAX_SOURCE_BYTES)
    throw new Error("Input file exceeds 8 MiB")
  return JSON.parse(await readFile(path, "utf8"))
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      source: { type: "string" },
      contexts: { type: "string" },
      report: { type: "string" },
      version: { type: "string" },
      "expected-active": { type: "string" },
      "requested-count": { type: "string", default: "6" },
      "excluded-reserve": { type: "string", default: "24" },
      execute: { type: "boolean", default: false },
    },
  })
  const command = positionals[0] ?? "audit"
  if (
    positionals.length > 1 ||
    !["audit", "import", "promote", "rollback"].includes(command)
  ) {
    throw new Error(
      "Use audit, import --execute, promote --execute, or rollback --execute",
    )
  }
  if (command !== "audit" && !values.execute)
    throw new Error("Mutation requires --execute")
  const prisma = new PrismaClient({ datasourceUrl: env.DATABASE_URL })
  const service = new CuratedPoolsService({ prisma })
  try {
    if (command === "promote" || command === "rollback") {
      if (!values["expected-active"])
        throw new Error(
          "Provide --expected-active=<version>, or none for the first promotion",
        )
      const expectedCurrentVersion =
        values["expected-active"] === "none" ? null : values["expected-active"]
      if (command === "rollback" && expectedCurrentVersion === null)
        throw new Error("Rollback requires a current version")
      const result =
        command === "rollback"
          ? await service.rollback({
              expectedCurrentVersion: expectedCurrentVersion!,
            })
          : await service.promote({
              version: values.version ?? "",
              expectedCurrentVersion,
            })
      console.log(JSON.stringify(result))
      return
    }
    if (!values.report)
      throw new Error("Provide --report=<path> to preserve validation evidence")
    const input = {
      source: await readJson(values.source),
      contexts: contextSchema.parse(await readJson(values.contexts)),
      requirement: {
        requestedCount: Number(values["requested-count"]),
        excludedReserve: Number(values["excluded-reserve"]),
      },
    }
    let report
    try {
      report =
        command === "import"
          ? await service.importGeneration(input)
          : await service.audit(input)
    } catch (error) {
      if (!(error instanceof CuratedPoolCoverageError)) throw error
      report = error.report
    }
    await writeFile(values.report, `${JSON.stringify(report, null, 2)}\n`)
    console.log(
      JSON.stringify({
        command,
        version: report.version,
        passed: report.passed,
        contexts: report.contexts.length,
        passingContexts: report.contexts.filter((context) => context.passed)
          .length,
        unknownCoreVideoIds: report.unknownCoreVideoIds.length,
        report: values.report,
      }),
    )
    if (!report.passed) process.exitCode = 2
  } finally {
    await prisma.$disconnect()
  }
}

void main().catch((error: unknown) => {
  // Prisma connection errors can contain credentials; never echo their payload.
  console.error(
    error instanceof Error && !error.constructor.name.startsWith("Prisma")
      ? error.message
      : "Curated pool operation failed; inspect database availability and validation inputs",
  )
  process.exitCode = 1
})
