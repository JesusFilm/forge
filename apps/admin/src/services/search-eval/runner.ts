/**
 * Eval-harness runner.
 *
 * Composes the search client, judge, baseline ops, calibration, and
 * fingerprint reader into a single end-to-end run. Returns a
 * `RunReport` ready for the reporter (Unit 10) to write to disk and
 * summarise on the console.
 *
 * Concurrency uses `p-limit` (already a dep, mirrors the
 * sceneEmbeddingBackfill pattern). Two pools — one for search, one
 * for judge — so admin's 30/min REST rate-limit and OpenRouter's
 * judge-throughput limits are tracked independently.
 *
 * A/B swap rule (per plan §Net-win-rate computation):
 *   - Both verdicts say "current better" (B-better when A=baseline,
 *     A-better when A=current) → win
 *   - Both say "baseline better" → loss
 *   - Both `tie` → tie
 *   - Both `both-irrelevant` → both-irrelevant (excluded from
 *     net-win-rate denominator)
 *   - Otherwise (disagree on direction) → judge-disagreement,
 *     counted as tie for net-win-rate, surfaced separately for
 *     diagnostics.
 *
 * Per plan §Unit 9.
 */

import type { PrismaClient } from "@prisma/client"
import pLimit from "p-limit"

import { detectDrift, loadBaseline } from "./baseline"
import { runCalibration } from "./calibration"
import { readFingerprint } from "./fingerprint"
import type { Judge, JudgeVerdictResult } from "./judge"
import { LOCALE_TIER, QUICK_LOCALES } from "./locales"
import { loadRegressions } from "./regressions"
import { createSyntheticQueryLoader } from "./query-generator"
import type { SearchClient } from "./search-client"
import type {
  Baseline,
  BaselineQuery,
  CalibrationCase,
  Outcome,
  PerLocaleSummary,
  RunCost,
  RunMode,
  RunReport,
  RunTotals,
  SearchResult,
  Tier,
  Verdict,
} from "./types"

/** Token-cost constants for Haiku 4.5 on OpenRouter. Best-effort.
 *  Re-verify periodically — OpenRouter pricing is the source of truth.
 *  Per plan §Key Decision (cost tracking). */
export const HAIKU_INPUT_USD_PER_TOKEN = 1.0 / 1_000_000
export const HAIKU_OUTPUT_USD_PER_TOKEN = 5.0 / 1_000_000

/** When ≥X% of outcomes have ≥Y% baseline result IDs reappearing in
 *  current results AND net win rate > 0, flag as snippet-improvement
 *  heuristic. Caveat surfaced in console summary. */
const SNIPPET_HEURISTIC_OVERLAP_THRESHOLD = 0.8
const SNIPPET_HEURISTIC_QUERY_RATIO = 0.7
const SNIPPET_HEURISTIC_MIN_NET_WIN_RATE = 0.1

export type RunEvalOptions = {
  /** Baseline name (defaults to "default"). */
  baselineName?: string
  /** Run mode. */
  mode: RunMode
  /** Required when mode === "locale". */
  filterLocale?: string
  /** Git SHA, threaded into the report. Defaults to "unknown". */
  gitSha?: string
  /** ISO timestamp generator (test seam). Defaults to `new Date()`. */
  now?: () => Date
  /** Run-id generator (test seam). */
  runIdFor?: (now: Date, gitSha: string) => string
  /** ----- Injectables for tests / runner composition. */
  prisma?: PrismaClient
  judge?: Judge
  searchClient?: SearchClient
  /** Override the synthetic-query loader. Tests provide a fake to
   *  return canned queries without hitting OpenRouter. */
  syntheticQueryLoader?: ReturnType<typeof createSyntheticQueryLoader>
  /** Override the regression loader. Defaults to `loadRegressions`. */
  loadRegressionsImpl?: typeof loadRegressions
  /** Override the calibration runner. Tests provide a stub so the
   *  runner doesn't have to wire the calibration JSON file. */
  runCalibrationImpl?: (judge: Judge) => Promise<RunReport["calibration"]>
  /** Override the calibration cases (passed through to default
   *  runCalibration when `runCalibrationImpl` isn't provided). */
  calibrationCases?: CalibrationCase[]
  /** Override the fingerprint reader. Tests stub this to return a
   *  fixed shape. */
  readFingerprintImpl?: typeof readFingerprint
  /** Concurrency caps. Default 4 search / 8 judge per the plan. */
  searchConcurrency?: number
  judgeConcurrency?: number
  /** Optional logger. */
  logger?: { info: (m: string) => void; warn: (m: string) => void }
}

const noopLogger = { info: () => {}, warn: () => {} }

const defaultRunIdFor = (now: Date, gitSha: string): string => {
  // YYYY-MM-DD-HHMM-<sha8>
  const pad = (n: number) => n.toString().padStart(2, "0")
  const datePart = `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}`
  const timePart = `${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}`
  const shaPart = gitSha.slice(0, 8) || "unknown"
  return `${datePart}-${timePart}-${shaPart}`
}

/**
 * Run the eval pipeline end-to-end. Returns a fully populated
 * `RunReport`. Does NOT write to disk; the reporter handles that.
 */
export async function runEval(options: RunEvalOptions): Promise<RunReport> {
  const logger = options.logger ?? noopLogger
  const now = options.now ?? (() => new Date())
  const startedAt = now()
  const gitSha = options.gitSha ?? "unknown"
  const runId = (options.runIdFor ?? defaultRunIdFor)(startedAt, gitSha)

  // ----- Load baseline -----
  const baseline = await loadBaseline(options.baselineName ?? "default")

  // ----- Filter queries based on mode -----
  const queries = filterQueries(baseline, options.mode, options.filterLocale)

  // ----- Read current fingerprint + detect drift -----
  if (!options.prisma && !options.readFingerprintImpl) {
    throw new Error(
      "runEval requires either a prisma client or a readFingerprintImpl override",
    )
  }
  const readImpl =
    options.readFingerprintImpl ?? ((p: PrismaClient) => readFingerprint(p))
  const currentFingerprint = await readImpl(options.prisma as PrismaClient)
  const drift = detectDrift(baseline, currentFingerprint)
  if (drift.detected) {
    logger.warn(
      `[search-eval] event=fingerprint_drift_detected details="${drift.details}"`,
    )
  }

  // ----- Run calibration (judge required) -----
  if (!options.judge) {
    throw new Error("runEval requires a judge")
  }
  const calibration = options.runCalibrationImpl
    ? await options.runCalibrationImpl(options.judge)
    : await runCalibration(options.judge, {
        cases: options.calibrationCases,
        logger,
      })

  // ----- Search current for each query -----
  if (!options.searchClient) {
    throw new Error("runEval requires a searchClient")
  }
  const searchClient = options.searchClient
  const searchLimit = pLimit(options.searchConcurrency ?? 4)
  const judgeLimit = pLimit(options.judgeConcurrency ?? 8)

  type CurrentResultEntry = BaselineQuery & {
    currentResults: SearchResult[]
    searchError: Error | null
  }

  const currentResults: CurrentResultEntry[] = await Promise.all(
    queries.map((q) =>
      searchLimit(async () => {
        try {
          const results = await searchClient.search(q.query, q.locale)
          return { ...q, currentResults: results, searchError: null }
        } catch (err) {
          logger.warn(
            `[search-eval] event=search_error locale=${q.locale} query="${truncateForLog(q.query)}" error=${err instanceof Error ? err.message : String(err)}`,
          )
          return {
            ...q,
            currentResults: [],
            searchError: err instanceof Error ? err : new Error(String(err)),
          }
        }
      }),
    ),
  )

  // ----- Judge each query pairwise (A/B + B/A swap) -----
  let totalInputTokens = 0
  let totalOutputTokens = 0

  type JudgeAttempt = {
    entry: CurrentResultEntry
    forwardVerdict: Verdict
    swappedVerdict: Verdict
    rationale: string
  }

  const judgeAttempts: JudgeAttempt[] = await Promise.all(
    currentResults.map((entry) =>
      judgeLimit(async () => {
        // Skip judging when search failed for this query — outcome
        // collapses to a synthetic disagreement (counted as tie).
        if (entry.searchError) {
          return {
            entry,
            forwardVerdict: "tie" as Verdict,
            swappedVerdict: "tie" as Verdict,
            rationale: `search failed: ${entry.searchError.message}`,
          }
        }

        // A=baseline, B=current
        const forward = await safeJudge(options.judge as Judge, {
          query: entry.query,
          locale: entry.locale,
          listA: entry.results,
          listB: entry.currentResults,
        })
        // A=current, B=baseline (swapped)
        const swapped = await safeJudge(options.judge as Judge, {
          query: entry.query,
          locale: entry.locale,
          listA: entry.currentResults,
          listB: entry.results,
        })
        totalInputTokens += forward.tokens.input + swapped.tokens.input
        totalOutputTokens += forward.tokens.output + swapped.tokens.output
        return {
          entry,
          forwardVerdict: forward.verdict,
          swappedVerdict: swapped.verdict,
          rationale: forward.rationale,
        }
      }),
    ),
  )

  // ----- Combine A/B-swap verdicts → Outcome -----
  const outcomes: Outcome[] = judgeAttempts.map(
    ({ entry, forwardVerdict, swappedVerdict, rationale }) => {
      const tier =
        (LOCALE_TIER as Record<string, Tier | undefined>)[entry.locale] ?? null
      const kind = collapseSwapVerdicts(forwardVerdict, swappedVerdict)

      const baselineResults = entry.results
      const currentResultsList = entry.currentResults

      if (kind === "both-irrelevant") {
        return {
          kind,
          query: entry.query,
          locale: entry.locale,
          tier,
          source: entry.source,
          baselineResults,
          currentResults: currentResultsList,
          verdicts: [forwardVerdict, swappedVerdict],
        }
      }
      if (kind === "judge-disagreement") {
        return {
          kind,
          query: entry.query,
          locale: entry.locale,
          tier,
          source: entry.source,
          baselineResults,
          currentResults: currentResultsList,
          verdicts: [forwardVerdict, swappedVerdict],
        }
      }
      return {
        kind,
        query: entry.query,
        locale: entry.locale,
        tier,
        source: entry.source,
        baselineResults,
        currentResults: currentResultsList,
        verdicts: [forwardVerdict, swappedVerdict],
        rationale,
      }
    },
  )

  // ----- Aggregate totals + per-locale -----
  const totals = computeTotals(outcomes)
  const perLocale = computePerLocale(outcomes)
  const cost: RunCost = {
    inputTokens: totalInputTokens,
    outputTokens: totalOutputTokens,
    totalUsd:
      totalInputTokens * HAIKU_INPUT_USD_PER_TOKEN +
      totalOutputTokens * HAIKU_OUTPUT_USD_PER_TOKEN,
  }

  // ----- Snippet-improvement heuristic -----
  const snippetImprovementHeuristic = detectSnippetImprovementHeuristic(
    outcomes,
    totals.netWinRate,
  )

  const finishedAt = now()
  return {
    schemaVersion: "1",
    runId,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    gitSha,
    mode: options.mode,
    filterLocale: options.filterLocale ?? null,
    judgeModel: options.judge.model,
    baseline: {
      name: baseline.name,
      capturedAt: baseline.capturedAt,
      gitSha: baseline.gitSha,
    },
    contentFingerprint: currentFingerprint,
    drift,
    calibration,
    totals,
    perLocale,
    cost,
    snippetImprovementHeuristic,
    outcomes,
  }
}

// ----- internals -----

async function safeJudge(
  judge: Judge,
  input: Parameters<Judge["judgePair"]>[0],
): Promise<JudgeVerdictResult> {
  try {
    return await judge.judgePair(input)
  } catch {
    return {
      verdict: "tie",
      rationale: "judge call failed",
      tokens: { input: 0, output: 0 },
      attempts: 0,
      model: judge.model,
    }
  }
}

function filterQueries(
  baseline: Baseline,
  mode: RunMode,
  filterLocale: string | undefined,
): Baseline["queries"] {
  switch (mode) {
    case "quick": {
      const allowed = new Set<string>(QUICK_LOCALES as readonly string[])
      return baseline.queries.filter((q) => allowed.has(q.locale))
    }
    case "full":
      return baseline.queries
    case "locale":
      if (!filterLocale) {
        throw new Error('mode="locale" requires filterLocale')
      }
      return baseline.queries.filter((q) => q.locale === filterLocale)
  }
}

/**
 * Collapse the two A/B-swap verdicts into a single outcome.
 *
 * `forward` was judged with A=baseline, B=current — so a "B better"
 * verdict means current is better.
 * `swapped` was judged with A=current, B=baseline — so an "A better"
 * verdict means current is better.
 *
 * They must agree on direction. Disagreement collapses to
 * `judge-disagreement` (counted as tie in net-win-rate).
 */
function collapseSwapVerdicts(
  forward: Verdict,
  swapped: Verdict,
): "win" | "loss" | "tie" | "both-irrelevant" | "judge-disagreement" {
  if (forward === "both-irrelevant" || swapped === "both-irrelevant") {
    if (forward === "both-irrelevant" && swapped === "both-irrelevant") {
      return "both-irrelevant"
    }
    return "judge-disagreement"
  }

  const forwardCurrentBetter =
    forward === "clearly-B-better" || forward === "slightly-B-better"
  const forwardBaselineBetter =
    forward === "clearly-A-better" || forward === "slightly-A-better"
  const forwardTie = forward === "tie"

  const swappedCurrentBetter =
    swapped === "clearly-A-better" || swapped === "slightly-A-better"
  const swappedBaselineBetter =
    swapped === "clearly-B-better" || swapped === "slightly-B-better"
  const swappedTie = swapped === "tie"

  if (forwardCurrentBetter && swappedCurrentBetter) return "win"
  if (forwardBaselineBetter && swappedBaselineBetter) return "loss"
  if (forwardTie && swappedTie) return "tie"
  return "judge-disagreement"
}

function computeTotals(outcomes: Outcome[]): RunTotals {
  let wins = 0
  let losses = 0
  let ties = 0
  let bothIrrelevant = 0
  let judgeDisagreements = 0
  for (const o of outcomes) {
    switch (o.kind) {
      case "win":
        wins++
        break
      case "loss":
        losses++
        break
      case "tie":
        ties++
        break
      case "both-irrelevant":
        bothIrrelevant++
        break
      case "judge-disagreement":
        judgeDisagreements++
        ties++ // counted as tie for net-win-rate purposes
        break
    }
  }
  const total = outcomes.length
  const denom = total - bothIrrelevant
  const netWinRate = denom > 0 ? (wins - losses) / denom : 0
  return {
    queries: total,
    wins,
    losses,
    ties,
    bothIrrelevant,
    judgeDisagreements,
    netWinRate,
  }
}

function computePerLocale(
  outcomes: Outcome[],
): Record<string, PerLocaleSummary> {
  const perLocale: Record<string, PerLocaleSummary> = {}
  for (const o of outcomes) {
    const tier =
      (LOCALE_TIER as Record<string, Tier | undefined>)[o.locale] ?? null
    const summary =
      perLocale[o.locale] ??
      ({
        tier,
        queries: 0,
        wins: 0,
        losses: 0,
        ties: 0,
        bothIrrelevant: 0,
        netWinRate: 0,
      } satisfies PerLocaleSummary)
    summary.queries++
    switch (o.kind) {
      case "win":
        summary.wins++
        break
      case "loss":
        summary.losses++
        break
      case "tie":
      case "judge-disagreement":
        summary.ties++
        break
      case "both-irrelevant":
        summary.bothIrrelevant++
        break
    }
    perLocale[o.locale] = summary
  }
  // Recompute netWinRate per locale at end.
  for (const k of Object.keys(perLocale)) {
    const s = perLocale[k]
    if (!s) continue
    const denom = s.queries - s.bothIrrelevant
    s.netWinRate = denom > 0 ? (s.wins - s.losses) / denom : 0
  }
  return perLocale
}

function detectSnippetImprovementHeuristic(
  outcomes: Outcome[],
  netWinRate: number,
): boolean {
  if (netWinRate < SNIPPET_HEURISTIC_MIN_NET_WIN_RATE) return false
  const eligible = outcomes.filter((o) => o.kind !== "both-irrelevant")
  if (eligible.length === 0) return false

  let highOverlapCount = 0
  for (const o of eligible) {
    const baselineIds = new Set(
      o.baselineResults.map((r) => `${r.type}:${r.id}`),
    )
    const currentIds = new Set(o.currentResults.map((r) => `${r.type}:${r.id}`))
    if (baselineIds.size === 0) continue
    let overlap = 0
    for (const id of baselineIds) {
      if (currentIds.has(id)) overlap++
    }
    const overlapRatio = overlap / baselineIds.size
    if (overlapRatio >= SNIPPET_HEURISTIC_OVERLAP_THRESHOLD) {
      highOverlapCount++
    }
  }

  return highOverlapCount / eligible.length >= SNIPPET_HEURISTIC_QUERY_RATIO
}

function truncateForLog(s: string, max = 80): string {
  return s.length <= max ? s : `${s.slice(0, max)}…`
}

/** Exposed for unit tests. Treat as internal. */
export const _internal = {
  collapseSwapVerdicts,
  computeTotals,
  computePerLocale,
  detectSnippetImprovementHeuristic,
}
