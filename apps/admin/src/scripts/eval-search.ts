#!/usr/bin/env tsx
/**
 * Semantic-search eval harness CLI.
 *
 * Runs end-to-end against admin's `/api/search` endpoint and an
 * OpenRouter judge. Produces a console summary and a per-run JSON
 * file under `apps/admin/.tmp/eval/runs/`.
 *
 * Subcommands (first positional arg, defaults to `run`):
 *
 *   run                     run the eval against the saved baseline
 *   rebaseline              capture a fresh baseline (writes to
 *                           apps/admin/eval/baselines/{name}.json)
 *   regenerate-queries      regenerate one locale's synthetic-queries
 *                           file (--locale=<bcp47> required)
 *   calibrate               run only the calibration set (no eval)
 *
 * Flags:
 *   --name=<baseline-name>     default: "default"
 *   --quick                    quick locale set (~6 high-resource)
 *   --full                     full locale set (all 30; default)
 *   --locale=<bcp47>           single-locale run (overrides --quick/--full)
 *   --base-url=<url>           admin URL; defaults to ADMIN_BASE_URL
 *                              env or http://localhost:3003
 *   --yes                      skip interactive confirmation on
 *                              rebaseline
 *
 * Required env: OPENROUTER_API_KEY, DATABASE_URL.
 *
 * Plan: docs/plans/2026-05-07-001-feat-semantic-search-eval-harness-plan.md
 */

import type { RunMode } from "@/services/search-eval/types"

type Subcommand = "run" | "rebaseline" | "regenerate-queries" | "calibrate"

function isSubcommand(v: string): v is Subcommand {
  return (
    v === "run" ||
    v === "rebaseline" ||
    v === "regenerate-queries" ||
    v === "calibrate"
  )
}

function parseSingle(name: string): string | undefined {
  const flag = `--${name}=`
  const arg = process.argv.find((a) => a.startsWith(flag))
  return arg ? arg.slice(flag.length) : undefined
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`)
}

async function main(): Promise<void> {
  // First non-`--` positional after the script path is the subcommand.
  const positional = process.argv.slice(2).find((a) => !a.startsWith("--"))
  const subcommand: Subcommand =
    positional && isSubcommand(positional) ? positional : "run"

  // Lazy-import so missing env produces a clean stderr from this file
  // rather than a zod stack at module-load.
  const { env } = await import("@/config/env")
  const baseUrl =
    parseSingle("base-url") ?? env.ADMIN_BASE_URL ?? "http://localhost:3003"

  if (!env.OPENROUTER_API_KEY) {
    process.stderr.write("[eval-search] OPENROUTER_API_KEY is required\n")
    process.exit(2)
  }

  const baselineName = parseSingle("name") ?? "default"

  switch (subcommand) {
    case "run":
      await runSubcommand({ baselineName, baseUrl })
      break
    case "rebaseline":
      await rebaselineSubcommand({ baselineName, baseUrl })
      break
    case "regenerate-queries":
      await regenerateQueriesSubcommand()
      break
    case "calibrate":
      await calibrateSubcommand()
      break
  }
}

async function runSubcommand(args: {
  baselineName: string
  baseUrl: string
}): Promise<void> {
  const filterLocale = parseSingle("locale")
  const quickFlag = hasFlag("quick")
  const fullFlag = hasFlag("full")

  // Reject conflicting flag combinations up-front so operators get a
  // loud signal rather than silent precedence-based behavior.
  if (filterLocale && quickFlag) {
    process.stderr.write(
      "[eval-search] --quick and --locale=<bcp47> are mutually exclusive\n",
    )
    process.exit(2)
  }
  if (filterLocale && fullFlag) {
    process.stderr.write(
      "[eval-search] --full and --locale=<bcp47> are mutually exclusive\n",
    )
    process.exit(2)
  }
  if (quickFlag && fullFlag) {
    process.stderr.write(
      "[eval-search] --quick and --full are mutually exclusive\n",
    )
    process.exit(2)
  }

  let mode: RunMode
  if (filterLocale) {
    mode = "locale"
  } else if (quickFlag) {
    mode = "quick"
  } else {
    mode = "full"
  }

  const { env } = await import("@/config/env")
  const { prisma } = await import("@/db/client")
  const { createSearchClient } =
    await import("@/services/search-eval/search-client")
  const { createJudge } = await import("@/services/search-eval/judge")
  const { runEval } = await import("@/services/search-eval/runner")
  const { renderConsoleSummary, writeRunJson } =
    await import("@/services/search-eval/reporter")

  const searchClient = createSearchClient({
    baseUrl: args.baseUrl,
    bearer: env.SEARCH_API_KEY,
  })
  const judge = createJudge()

  const onSignal = createSignalHandler(prisma)
  process.once("SIGINT", onSignal)
  process.once("SIGTERM", onSignal)

  try {
    process.stdout.write(
      JSON.stringify({
        event: "eval-search.start",
        subcommand: "run",
        mode,
        filterLocale: filterLocale ?? null,
        baselineName: args.baselineName,
        baseUrl: args.baseUrl,
        judgeModel: judge.model,
      }) + "\n",
    )

    const report = await runEval({
      mode,
      filterLocale,
      baselineName: args.baselineName,
      prisma,
      searchClient,
      judge,
      searchConcurrency: env.EVAL_SEARCH_CONCURRENCY,
      judgeConcurrency: env.EVAL_JUDGE_CONCURRENCY,
      gitSha: env.EVAL_GIT_SHA ?? "unknown",
      logger: { info: () => {}, warn: (m) => process.stderr.write(m + "\n") },
    })

    const { path: jsonPath } = await writeRunJson(report)

    process.stdout.write("\n" + renderConsoleSummary(report) + "\n")
    process.stdout.write(
      JSON.stringify({
        event: "eval-search.complete",
        runId: report.runId,
        netWinRate: report.totals.netWinRate,
        wins: report.totals.wins,
        losses: report.totals.losses,
        ties: report.totals.ties,
        bothIrrelevant: report.totals.bothIrrelevant,
        calibrationPassed: report.calibration.passed,
        driftDetected: report.drift.detected,
        costUsd: report.cost.totalUsd,
        jsonPath,
      }) + "\n",
    )

    // Exit non-zero if calibration failed — operator should re-run
    // before trusting; CI gating could pick this up later.
    if (!report.calibration.passed) {
      process.exit(3)
    }
  } finally {
    process.off("SIGINT", onSignal)
    process.off("SIGTERM", onSignal)
    await prisma.$disconnect()
  }
}

async function rebaselineSubcommand(args: {
  baselineName: string
  baseUrl: string
}): Promise<void> {
  if (!hasFlag("yes")) {
    process.stderr.write(
      `[eval-search] rebaseline overwrites apps/admin/eval/baselines/${args.baselineName}.json. Pass --yes to confirm.\n`,
    )
    process.exit(2)
  }

  const { env } = await import("@/config/env")
  const { prisma } = await import("@/db/client")
  const { createSearchClient } =
    await import("@/services/search-eval/search-client")
  const { createSyntheticQueryLoader, createQueryGenerator } =
    await import("@/services/search-eval/query-generator")
  const { loadRegressions } = await import("@/services/search-eval/regressions")
  const { saveBaseline } = await import("@/services/search-eval/baseline")
  const { readFingerprint } = await import("@/services/search-eval/fingerprint")
  const { HARNESS_LOCALES } = await import("@/services/search-eval/locales")
  const pLimit = (await import("p-limit")).default

  const searchClient = createSearchClient({
    baseUrl: args.baseUrl,
    bearer: env.SEARCH_API_KEY,
  })
  const generator = createQueryGenerator()
  const queryLoader = createSyntheticQueryLoader({ generator })

  const searchConcurrency = env.EVAL_SEARCH_CONCURRENCY ?? 4

  const onSignal = createSignalHandler(prisma)
  process.once("SIGINT", onSignal)
  process.once("SIGTERM", onSignal)

  try {
    process.stdout.write(
      JSON.stringify({
        event: "eval-search.rebaseline.start",
        baselineName: args.baselineName,
        baseUrl: args.baseUrl,
        locales: HARNESS_LOCALES,
        searchConcurrency,
      }) + "\n",
    )

    const fingerprint = await readFingerprint(prisma)

    // Synthetic queries: load-or-generate per locale, with bounded
    // parallelism + per-locale error isolation. A single transient
    // OpenRouter failure for one locale must not abort the run for
    // the other 29.
    const queryGenLimit = pLimit(searchConcurrency)
    const syntheticSettled = await Promise.allSettled(
      HARNESS_LOCALES.map((locale) =>
        queryGenLimit(() => queryLoader.loadOrGenerate(locale)),
      ),
    )
    const syntheticAll = syntheticSettled.flatMap((r, idx) => {
      if (r.status === "fulfilled") return r.value
      const locale = HARNESS_LOCALES[idx]
      process.stderr.write(
        JSON.stringify({
          event: "eval-search.rebaseline.query_gen_error",
          locale,
          error:
            r.reason instanceof Error ? r.reason.message : String(r.reason),
        }) + "\n",
      )
      return []
    })

    const regressions = await loadRegressions({ prisma })

    const allQueries = [...syntheticAll, ...regressions]

    process.stdout.write(
      JSON.stringify({
        event: "eval-search.rebaseline.queries_loaded",
        synthetic: syntheticAll.length,
        regression: regressions.length,
        total: allQueries.length,
        queryGenFailures: syntheticSettled.filter(
          (r) => r.status === "rejected",
        ).length,
      }) + "\n",
    )

    // Run searches with concurrency cap. Per-query try/catch absorbs
    // individual failures; allSettled prevents one rejection from
    // taking down the batch.
    const searchLimit = pLimit(searchConcurrency)
    const baselineQueries = await Promise.all(
      allQueries.map((q) =>
        searchLimit(async () => {
          try {
            const results = await searchClient.search(q.query, q.locale)
            return {
              locale: q.locale,
              query: q.query,
              source: q.source,
              results,
            }
          } catch (err) {
            process.stderr.write(
              JSON.stringify({
                event: "eval-search.rebaseline.search_error",
                locale: q.locale,
                query: q.query,
                error: err instanceof Error ? err.message : String(err),
              }) + "\n",
            )
            return {
              locale: q.locale,
              query: q.query,
              source: q.source,
              results: [],
            }
          }
        }),
      ),
    )

    const { path: written } = await saveBaseline({
      schemaVersion: "1",
      name: args.baselineName,
      capturedAt: new Date().toISOString(),
      gitSha: env.EVAL_GIT_SHA ?? "unknown",
      contentFingerprint: fingerprint,
      queries: baselineQueries,
    })

    process.stdout.write(
      JSON.stringify({
        event: "eval-search.rebaseline.complete",
        baselineName: args.baselineName,
        path: written,
        totalQueries: baselineQueries.length,
      }) + "\n",
    )
  } finally {
    process.off("SIGINT", onSignal)
    process.off("SIGTERM", onSignal)
    await prisma.$disconnect()
  }
}

async function regenerateQueriesSubcommand(): Promise<void> {
  const locale = parseSingle("locale")
  if (!locale) {
    process.stderr.write(
      "[eval-search] regenerate-queries requires --locale=<bcp47>\n",
    )
    process.exit(2)
  }
  const { createSyntheticQueryLoader, createQueryGenerator } =
    await import("@/services/search-eval/query-generator")
  const generator = createQueryGenerator()
  const loader = createSyntheticQueryLoader({ generator })

  const queries = await loader.regenerate(locale)
  process.stdout.write(
    JSON.stringify({
      event: "eval-search.regenerate-queries.complete",
      locale,
      count: queries.length,
    }) + "\n",
  )
}

async function calibrateSubcommand(): Promise<void> {
  const { createJudge } = await import("@/services/search-eval/judge")
  const { runCalibration } = await import("@/services/search-eval/calibration")

  const judge = createJudge()
  const report = await runCalibration(judge, {
    logger: {
      warn: (m) => process.stderr.write(m + "\n"),
      info: (m) => process.stdout.write(m + "\n"),
    },
  })

  process.stdout.write(
    JSON.stringify({
      event: "eval-search.calibrate.complete",
      passed: report.passed,
      matched: report.matched,
      total: report.total,
    }) + "\n",
  )
  if (!report.passed) {
    process.exit(3)
  }
}

function createSignalHandler(prisma: {
  $disconnect: () => Promise<void>
}): (signal: NodeJS.Signals) => void {
  let interrupted = false
  return (signal: NodeJS.Signals) => {
    if (interrupted) return
    interrupted = true
    process.stderr.write(
      JSON.stringify({ event: "eval-search.interrupted", signal }) + "\n",
    )
    void prisma.$disconnect().finally(() => process.exit(130))
  }
}

if (
  typeof process.argv[1] === "string" &&
  import.meta.url === `file://${process.argv[1]}`
) {
  main().catch((err) => {
    process.stderr.write(
      JSON.stringify({
        event: "eval-search.fatal",
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      }) + "\n",
    )
    process.exit(1)
  })
}
