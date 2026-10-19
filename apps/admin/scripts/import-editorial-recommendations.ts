/** Run from apps/admin with its normal environment; prepare is strictly read-only. */
import { readFile, writeFile } from "node:fs/promises"
import { parseArgs } from "node:util"
import { z } from "zod"
import { prisma } from "../src/db/client"
import { env } from "../src/config/env"
import {
  EditorialImportError,
  editorialImportManifest,
  executeEditorialImport,
  prepareEditorialImport,
  type EditorialImportPlan,
} from "../src/services/recommendations/precomputed/editorial-import"
import {
  PrecomputedRecommendationError,
  validatePrecomputedChoices,
} from "../src/services/recommendations/precomputed/contract"

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      source: { type: "string" },
      generation: { type: "string" },
      cutoff: { type: "string" },
      plan: { type: "string" },
      endpoint: { type: "string" },
      report: { type: "string" },
      execute: { type: "boolean", default: false },
    },
  })
  if (positionals.length || !values.plan || !values.report)
    throw new EditorialImportError(
      "Provide --plan and --report; --execute also requires --endpoint",
    )
  try {
    if (!values.execute) {
      if (!values.source || !values.generation || !values.cutoff)
        throw new EditorialImportError(
          "Prepare requires --source, --generation and --cutoff",
        )
      const plan = await prepareEditorialImport({
        raw: await readFile(values.source, "utf8"),
        generationId: values.generation,
        inputCutoff: values.cutoff,
        validate: async (source, choices) => {
          try {
            await validatePrecomputedChoices(prisma, source, choices)
            return null
          } catch (cause) {
            if (
              cause instanceof PrecomputedRecommendationError &&
              cause.code === "invalid"
            )
              return cause.message
            throw cause
          }
        },
      })
      await writeFile(values.plan, JSON.stringify(plan, null, 2) + "\n", {
        flag: "wx",
      })
      const report = {
        ...editorialImportManifest(plan),
        sources: plan.sources.length,
        choices: plan.sources.reduce(
          (sum, source) => sum + source.choices.length,
          0,
        ),
        completeSixSources: plan.sources.filter(
          (source) => source.choices.length === 6,
        ).length,
        emptySources: plan.sources
          .filter((source) => !source.choices.length)
          .map((source) => source.sourceVideoId),
        exclusions: plan.sources
          .filter((source) => source.exclusions.length)
          .map((source) => ({
            sourceVideoId: source.sourceVideoId,
            exclusions: source.exclusions,
          })),
        productionWrites: 0,
      }
      await writeFile(values.report, JSON.stringify(report, null, 2) + "\n", {
        flag: "wx",
      })
      console.log(
        JSON.stringify({
          sources: report.sources,
          choices: report.choices,
          completeSixSources: report.completeSixSources,
          emptySources: report.emptySources.length,
        }),
      )
      return
    }
    if (!values.endpoint)
      throw new EditorialImportError("Execute requires --endpoint")
    const endpoint = new URL(values.endpoint)
    if (
      endpoint.protocol !== "https:" ||
      endpoint.username ||
      endpoint.password ||
      endpoint.search ||
      endpoint.hash ||
      endpoint.pathname !== "/api/internal/mastra/precomputed-recommendations"
    )
      throw new EditorialImportError("Use the exact HTTPS Admin ingest URL")
    if (
      !env.ADMIN_BASE_URL ||
      endpoint.origin !== new URL(env.ADMIN_BASE_URL).origin
    )
      throw new EditorialImportError(
        "Endpoint must match the configured Admin origin",
      )
    const key = env.MASTRA_RECOMMENDATION_INGEST_API_KEYS?.split(",")[0]?.trim()
    if (!key)
      throw new EditorialImportError(
        "Recommendation ingest credentials required",
      )
    const plan = JSON.parse(
      await readFile(values.plan, "utf8"),
    ) as EditorialImportPlan
    const result = await executeEditorialImport(plan, async (payload) => {
      const response = await fetch(endpoint, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(45_000),
        headers: {
          authorization: `Bearer ${key}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
      })
      const body = (await response.json()) as {
        result?: unknown
        reason?: string
        error?: string
      }
      if (!response.ok)
        throw new EditorialImportError(
          `Ingest rejected (${response.status}): ${body.reason ?? "unknown"}: ${body.error ?? "unknown"}`,
        )
      const result = z
        .object({ generationId: z.string(), state: z.string() })
        .passthrough()
        .parse(body.result)
      if (result.generationId !== plan.generationId)
        throw new EditorialImportError("Ingest returned another generation")
      return result
    })
    if (
      !result ||
      typeof result !== "object" ||
      !("state" in result) ||
      result.state !== "complete"
    )
      throw new EditorialImportError("Generation completion was not confirmed")
    const report = {
      manifest: editorialImportManifest(plan),
      result,
      completedAt: new Date().toISOString(),
    }
    await writeFile(values.report, JSON.stringify(report, null, 2) + "\n", {
      flag: "wx",
    })
    console.log(JSON.stringify(report))
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((cause) => {
  // Never print connection strings, fetch internals or environment values.
  console.error(
    cause instanceof EditorialImportError
      ? cause.message
      : "Editorial import failed; no generation was activated",
  )
  process.exitCode = 1
})
