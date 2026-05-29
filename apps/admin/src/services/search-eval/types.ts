/**
 * Shared types for the semantic-search eval harness.
 *
 * Everything downstream (search client, judge, baseline ops, runner,
 * reporter) compiles against this module. Concrete shapes for
 * baselines and run reports are sketched here so units 2–11 can
 * import them without circular wiring.
 *
 * For the design rationale see
 * `docs/plans/2026-05-07-001-feat-semantic-search-eval-harness-plan.md`
 * and the upstream brainstorm.
 */

import type {
  SearchMode,
  SearchResponse,
  SearchResult,
} from "@/services/hybrid-search.service"

import type { Tier } from "./locales"

// Re-export admin's response shape so harness modules import a single
// canonical SearchResult type. Bumping admin's contract surfaces here
// at compile time.
export type { SearchMode, SearchResponse, SearchResult }
// Re-export Tier so consumers don't need to know it lives in locales.ts.
export type { Tier }

/**
 * Pairwise judge verdict. Six values — five on the
 * `clearly-A | slightly-A | tie | slightly-B | clearly-B` ladder
 * plus `both-irrelevant`. The `both-irrelevant` verdict is excluded
 * from the net-win-rate denominator and reported separately as a
 * diagnostic (high counts in a locale signal thin corpus, broken
 * synthetic generator, or judge incompetence).
 */
export type Verdict =
  | "clearly-A-better"
  | "slightly-A-better"
  | "tie"
  | "slightly-B-better"
  | "clearly-B-better"
  | "both-irrelevant"

/**
 * Source attribution for committed harness queries.
 *
 * Mastra-generated candidates are staged separately in search_eval_candidate
 * and intentionally do not enter this durable harness union until a sanitized
 * human-promotion flow lands.
 */
export type QuerySource = "synthetic" | "regression" | "promoted"

/** Run-level mode for the harness CLI. */
export type RunMode = "quick" | "full" | "locale"

/**
 * Snapshot of admin's indexed-content state. Recorded per run; the
 * baseline records its own when captured. Drift detection diffs the
 * two.
 */
export type Fingerprint = {
  sceneEmbeddings: { count: number; maxUpdatedAt: string | null }
  transcriptEmbeddings: { count: number; maxUpdatedAt: string | null }
  experiences: { count: number; maxUpdatedAt: string | null }
}

/** Output of `compareFingerprints(baseline, current)`. */
export type DriftResult = {
  detected: boolean
  /** Human-readable summary surfaced in the console warning. */
  details: string
}

/**
 * One entry in a baseline. Captures a query and the top-K results
 * it returned at the time the baseline was taken. Snippet is already
 * truncated to ~200 codepoints by the search client before persisting.
 */
export type BaselineQuery = {
  /** BCP-47 locale string. May be a HarnessLocale or any other admin
   *  accepts (e.g. when the operator pins a one-off via --locale). */
  locale: string
  query: string
  source: QuerySource
  results: SearchResult[]
}

/** A committed baseline snapshot. Lives at `eval/baselines/{name}.json`. */
export type Baseline = {
  schemaVersion: "1"
  /** Logical name — `default` unless multiple baselines are kept. */
  name: string
  capturedAt: string
  gitSha: string
  contentFingerprint: Fingerprint
  queries: BaselineQuery[]
}

/** Outcome of one query's pairwise eval (after A/B-swap collapse). */
export type Outcome =
  | {
      kind: "win" | "loss" | "tie"
      query: string
      locale: string
      tier: Tier | null
      source: QuerySource
      baselineResults: SearchResult[]
      currentResults: SearchResult[]
      verdicts: [Verdict, Verdict]
      rationale: string
    }
  | {
      kind: "both-irrelevant"
      query: string
      locale: string
      tier: Tier | null
      source: QuerySource
      baselineResults: SearchResult[]
      currentResults: SearchResult[]
      verdicts: [Verdict, Verdict]
    }
  | {
      kind: "judge-disagreement"
      query: string
      locale: string
      tier: Tier | null
      source: QuerySource
      baselineResults: SearchResult[]
      currentResults: SearchResult[]
      verdicts: [Verdict, Verdict]
    }

/** One calibration case as run by Unit 8. Locale is `string` (not
 *  `HarnessLocale`) because operator-authored cases may target locales
 *  outside the harness set during one-off probes. */
export type CalibrationCase = {
  id: string
  query: string
  locale: string
  listA: SearchResult[]
  listB: SearchResult[]
  expected: Verdict
  rationale: string
}

/** Aggregate calibration result for a single harness invocation. */
export type CalibrationReport = {
  passed: boolean
  matched: number
  total: number
  cases: Array<{
    id: string
    expected: Verdict
    observed: Verdict
    pass: boolean
  }>
}

/** Per-locale rollup numbers for the run. */
export type PerLocaleSummary = {
  tier: Tier | null
  queries: number
  wins: number
  losses: number
  ties: number
  bothIrrelevant: number
  netWinRate: number
}

/** Run-level totals. */
export type RunTotals = {
  queries: number
  wins: number
  losses: number
  ties: number
  bothIrrelevant: number
  judgeDisagreements: number
  /** (wins − losses) / (total − bothIrrelevant). Range [-1, +1]. */
  netWinRate: number
}

/** Token + cost rollup for the run's judge calls. */
export type RunCost = {
  inputTokens: number
  outputTokens: number
  totalUsd: number
}

/**
 * Top-level run report. Written to disk at
 * `apps/admin/.tmp/eval/runs/{runId}.json` and summarised to the
 * console. Discriminated-union outcomes mirror admin's R1/R2/R3
 * backfill report idiom (`{ totalTargets, succeeded, skipped, failed,
 * outcomes[] }`).
 */
export type RunReport = {
  schemaVersion: "1"
  runId: string
  startedAt: string
  finishedAt: string
  gitSha: string
  mode: RunMode
  filterLocale: string | null
  judgeModel: string
  baseline: { name: string; capturedAt: string; gitSha: string }
  contentFingerprint: Fingerprint
  drift: DriftResult
  calibration: CalibrationReport
  totals: RunTotals
  perLocale: Record<string, PerLocaleSummary>
  cost: RunCost
  /** True when most baseline result IDs reappear in current results;
   *  signals "snippets changed, ranking did not" to the operator. */
  snippetImprovementHeuristic: boolean
  outcomes: Outcome[]
}
