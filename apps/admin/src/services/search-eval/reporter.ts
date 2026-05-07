/**
 * Reporter — writes the per-run JSON file and renders the console
 * summary.
 *
 * Per plan §Unit 10:
 * - JSON file: `apps/admin/.tmp/eval/runs/{runId}.json`
 *   (gitignored, machine-readable; mirrors admin's R1/R2/R3 backfill
 *    report idiom).
 * - Console summary: header → headline net-win-rate → drift →
 *   calibration → per-locale table → top 10 regressions → snippet-
 *   improvement caveat → cost → JSON file path.
 */

import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"

import { runsDir } from "./paths"
import type { Outcome, RunReport, Verdict } from "./types"

export type WriteRunJsonOptions = {
  /** Override directory for tests. Defaults to
   *  `apps/admin/.tmp/eval/runs/`. */
  directory?: string
}

/** Persist a run report to disk. Atomic-ish: parent dir created
 *  recursively; write replaces any existing file with the same
 *  runId (which would only happen if cli ran twice in the same
 *  minute under the same SHA — extremely unlikely). */
export async function writeRunJson(
  report: RunReport,
  options: WriteRunJsonOptions = {},
): Promise<{ path: string }> {
  const directory = options.directory ?? runsDir()
  await mkdir(directory, { recursive: true })
  const filePath = path.join(directory, `${report.runId}.json`)
  await writeFile(filePath, JSON.stringify(report, null, 2) + "\n", "utf8")
  return { path: filePath }
}

const VERDICT_CONFIDENCE: Record<Verdict, number> = {
  "clearly-A-better": 2,
  "clearly-B-better": 2,
  "slightly-A-better": 1,
  "slightly-B-better": 1,
  tie: 0,
  "both-irrelevant": 0,
}

/** Render the user-facing console summary. Caller prints with
 *  `console.log(rendered)` — separating render-from-print keeps
 *  the function pure + testable. */
export function renderConsoleSummary(report: RunReport): string {
  const lines: string[] = []
  lines.push(...renderHeader(report))
  lines.push("")
  lines.push(...renderHeadline(report))
  lines.push("")
  if (report.drift.detected) {
    lines.push(...renderDriftWarning(report))
    lines.push("")
  }
  lines.push(...renderCalibrationBlock(report))
  lines.push("")
  lines.push(...renderPerLocaleTable(report))
  lines.push("")
  const regressions = renderTopRegressions(report)
  if (regressions.length > 0) {
    lines.push(...regressions)
    lines.push("")
  }
  if (report.snippetImprovementHeuristic) {
    lines.push(...renderSnippetCaveat())
    lines.push("")
  }
  lines.push(...renderCost(report))
  lines.push("")
  lines.push(...renderJsonPath(report))
  return lines.join("\n")
}

function renderHeader(r: RunReport): string[] {
  const localesSeen = Object.keys(r.perLocale).length
  return [
    `─── Semantic search eval ───`,
    `runId:        ${r.runId}`,
    `started:      ${r.startedAt}`,
    `gitSha:       ${r.gitSha}`,
    `mode:         ${r.mode}${r.filterLocale ? ` (locale=${r.filterLocale})` : ""}`,
    `judge model:  ${r.judgeModel}`,
    `baseline:     ${r.baseline.name} (captured ${r.baseline.capturedAt}, sha ${r.baseline.gitSha})`,
    `locales seen: ${localesSeen}`,
    `queries:      ${r.totals.queries}`,
  ]
}

function renderHeadline(r: RunReport): string[] {
  const sign =
    r.totals.netWinRate > 0 ? "+" : r.totals.netWinRate < 0 ? "" : "±"
  const formatted = sign + r.totals.netWinRate.toFixed(3)
  return [
    `Net win rate: ${formatted}`,
    `  ${r.totals.wins} wins · ${r.totals.losses} losses · ${r.totals.ties} ties · ${r.totals.bothIrrelevant} both-irrelevant`,
    r.totals.judgeDisagreements > 0
      ? `  (judge disagreements: ${r.totals.judgeDisagreements})`
      : "",
  ].filter(Boolean) as string[]
}

function renderDriftWarning(r: RunReport): string[] {
  return [
    `⚠ INDEXED CONTENT DRIFTED since baseline`,
    `  ${r.drift.details}`,
    `  Net-win-rate may reflect content changes, not code. Consider re-baselining.`,
  ]
}

function renderCalibrationBlock(r: RunReport): string[] {
  if (r.calibration.total === 0) {
    return [`Calibration: SKIPPED (empty case list)`]
  }
  const ratio = (r.calibration.matched / r.calibration.total).toFixed(2)
  if (r.calibration.passed) {
    return [
      `Calibration: PASS (${r.calibration.matched}/${r.calibration.total} = ${ratio})`,
    ]
  }
  return [
    `⚠ JUDGE CALIBRATION FAILED (${r.calibration.matched}/${r.calibration.total} = ${ratio})`,
    `  Run is flagged untrustworthy. Failed cases:`,
    ...r.calibration.cases
      .filter((c) => !c.pass)
      .map(
        (c) => `    • ${c.id}: expected=${c.expected} observed=${c.observed}`,
      ),
  ]
}

function renderPerLocaleTable(r: RunReport): string[] {
  const entries = Object.entries(r.perLocale).sort(
    ([, a], [, b]) => Math.abs(b.netWinRate) - Math.abs(a.netWinRate),
  )
  if (entries.length === 0) return ["Per-locale: (no outcomes)"]

  const lines: string[] = ["Per-locale (sorted by |net win rate|):"]
  lines.push(
    `  ${pad("locale", 10)}  ${pad("tier", 4)}  ${pad("w/t/l/bi", 12)}  net`,
  )
  for (const [locale, s] of entries) {
    const tier = s.tier == null ? "—" : `T${s.tier}`
    const wtl = `${s.wins}/${s.ties}/${s.losses}/${s.bothIrrelevant}`
    const sign = s.netWinRate > 0 ? "+" : s.netWinRate < 0 ? "" : "±"
    const net = sign + s.netWinRate.toFixed(3)
    lines.push(`  ${pad(locale, 10)}  ${pad(tier, 4)}  ${pad(wtl, 12)}  ${net}`)
  }
  return lines
}

// Type predicate narrowing the `kind: "win" | "loss" | "tie"` arm
// to just losses — these are the outcomes that carry a `rationale`.
type LosingOutcome = Extract<Outcome, { kind: "win" | "loss" | "tie" }> & {
  kind: "loss"
}

function renderTopRegressions(r: RunReport): string[] {
  const losing = r.outcomes.filter((o): o is LosingOutcome => o.kind === "loss")
  if (losing.length === 0) return []

  // Sort by judge confidence (clearly > slightly > other), then by
  // tier (1 > 2 > 3 — Tier-1 regressions trump Tier-3 noise), then by
  // locale alphabetical for stable ordering.
  const sorted = [...losing].sort((a, b) => {
    const aConfidence = Math.max(
      ...a.verdicts.map((v) => VERDICT_CONFIDENCE[v]),
    )
    const bConfidence = Math.max(
      ...b.verdicts.map((v) => VERDICT_CONFIDENCE[v]),
    )
    if (bConfidence !== aConfidence) return bConfidence - aConfidence
    const aTier = a.tier ?? 9
    const bTier = b.tier ?? 9
    if (aTier !== bTier) return aTier - bTier
    return a.locale.localeCompare(b.locale)
  })

  const top = sorted.slice(0, 10)
  const lines: string[] = [
    `Top ${top.length} regression${top.length === 1 ? "" : "s"} (sorted by judge confidence):`,
  ]
  for (const o of top) {
    const confidenceMark = o.verdicts.some((v) => v.startsWith("clearly-"))
      ? "▼▼"
      : "▼"
    const tier = o.tier == null ? "—" : `T${o.tier}`
    lines.push(
      `  ${confidenceMark} [${pad(o.locale, 8)} ${tier}] "${truncate(o.query, 60)}"`,
    )
    lines.push(`     ${truncate(o.rationale, 110)}`)
  }
  return lines
}

function renderSnippetCaveat(): string[] {
  return [
    `ℹ Snippet-improvement heuristic triggered:`,
    `  most baseline result IDs reappeared in current results, but the`,
    `  judge preferred current. Likely the snippet shape changed; ranking`,
    `  itself may be unchanged. Inspect outcomes if you expected a true`,
    `  ranking improvement.`,
  ]
}

function renderCost(r: RunReport): string[] {
  return [
    `Cost: ${r.cost.inputTokens.toLocaleString()} in / ${r.cost.outputTokens.toLocaleString()} out tokens · $${r.cost.totalUsd.toFixed(2)}`,
  ]
}

function renderJsonPath(r: RunReport): string[] {
  return [`Run JSON: apps/admin/.tmp/eval/runs/${r.runId}.json`]
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + " ".repeat(n - s.length)
}

/** Codepoint-safe truncation (matches `search-client.ts::truncateSnippet`).
 *  `s.slice` cuts UTF-16 units which can split an emoji or non-BMP CJK
 *  character mid-codepoint. `Array.from(s)` yields codepoints.
 */
function truncate(s: string, max: number): string {
  const codepoints = Array.from(s)
  if (codepoints.length <= max) return s
  return `${codepoints.slice(0, max - 1).join("")}…`
}
