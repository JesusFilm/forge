#!/usr/bin/env tsx
/**
 * Cutover-verification probe for the /watch URL space (Phase 6).
 *
 * Runs the §5 URL matrix (docs/research/jesusfilm-watch-url-patterns.md,
 * encoded in src/lib/watch-url-probe.ts) against a production baseline AND a
 * rewrite preview, then diffs the two per URL into regression buckets.
 *
 * Gate: 0 hard regressions, ≤2% soft regressions. Exits non-zero if the gate
 * fails so it can run in CI / a pre-cutover check.
 *
 * Run:
 *   pnpm --filter @forge/web probe:watch-urls \
 *     --production https://www.jesusfilm.org \
 *     --preview    https://<railway-preview-url>
 *
 * Optional: --json <path> writes the full per-URL comparison report.
 *
 * Intentionally imports only the pure probe lib (no app module graph).
 */

import { writeFileSync } from "node:fs"

import {
  WATCH_URL_FIXTURES,
  WATCH_PRIMARY_VIDEO_IDENTITY_PAIRS,
  WATCH_STRUCTURED_DATA_CONTRACTS,
  classifyProbe,
  primaryVideoIdentityViolations,
  probeUrl,
  type ProbeComparison,
} from "../src/lib/watch-url-probe"

const SOFT_REGRESSION_BUDGET = 0.02 // ≤2% soft regressions allowed
const STRUCTURED_DATA_SAMPLES = new Set(
  Object.keys(WATCH_STRUCTURED_DATA_CONTRACTS),
)

type Args = { production: string; preview: string; jsonOut?: string }

function parseArgs(argv: readonly string[]): Args | Error {
  let production: string | undefined
  let preview: string | undefined
  let jsonOut: string | undefined
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]
    const value = argv[i + 1]
    if (flag === "--production") {
      production = value
      i += 1
    } else if (flag === "--preview") {
      preview = value
      i += 1
    } else if (flag === "--json") {
      jsonOut = value
      i += 1
    }
  }
  if (!production || !preview) {
    return new Error(
      "Usage: probe:watch-urls --production <origin> --preview <origin> [--json <path>]",
    )
  }
  const stripTrailing = (s: string) => s.replace(/\/$/, "")
  return {
    production: stripTrailing(production),
    preview: stripTrailing(preview),
    jsonOut,
  }
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2))
  if (parsed instanceof Error) {
    console.error(parsed.message)
    process.exit(2)
  }
  const { production, preview, jsonOut } = parsed

  console.log(
    `Probing ${WATCH_URL_FIXTURES.length} /watch URLs\n  production: ${production}\n  preview:    ${preview}\n`,
  )

  const comparisons: ProbeComparison[] = []
  for (const fixture of WATCH_URL_FIXTURES) {
    // Sequential to avoid hammering either origin / tripping rate limits.
    const [prodResult, previewResult] = await Promise.all([
      probeUrl(production, fixture.path),
      probeUrl(preview, fixture.path),
    ])
    const { outcome, note } = classifyProbe(prodResult, previewResult, fixture)
    comparisons.push({
      path: fixture.path,
      group: fixture.group,
      production: prodResult,
      preview: previewResult,
      outcome,
      note,
    })
  }

  const tally = {
    match: 0,
    acceptable: 0,
    "soft-regression": 0,
    "hard-regression": 0,
    error: 0,
  }
  for (const c of comparisons) tally[c.outcome] += 1

  const primaryVideoIdentityErrors: string[] = []
  for (const pair of WATCH_PRIMARY_VIDEO_IDENTITY_PAIRS) {
    const contextual = comparisons.find((row) => row.path === pair.contextual)
    const standalone = comparisons.find((row) => row.path === pair.standalone)
    if (!contextual || !standalone) {
      primaryVideoIdentityErrors.push(
        `${pair.contextual} ↔ ${pair.standalone}: fixture missing from probe matrix`,
      )
      continue
    }
    for (const violation of primaryVideoIdentityViolations(
      contextual.preview,
      standalone.preview,
    )) {
      primaryVideoIdentityErrors.push(
        `${pair.contextual} ↔ ${pair.standalone}: ${violation}`,
      )
    }
  }

  console.log("\nStructured-data samples (literal initial-response scripts):")
  for (const comparison of comparisons) {
    if (!STRUCTURED_DATA_SAMPLES.has(comparison.path)) continue
    const prod = comparison.production.structuredData
    const preview = comparison.preview.structuredData
    console.log(
      `  ${comparison.path}\n` +
        `      prod ${prod?.scriptCount ?? 0}: ${prod?.types.join(", ") || "none"}\n` +
        `      preview ${preview?.scriptCount ?? 0}: ${preview?.types.join(", ") || "none"}`,
    )
  }

  console.log("\nPrimary-video identity pairs:")
  if (primaryVideoIdentityErrors.length === 0) {
    for (const pair of WATCH_PRIMARY_VIDEO_IDENTITY_PAIRS) {
      console.log(`  ✓ ${pair.contextual} ↔ ${pair.standalone}`)
    }
  } else {
    for (const error of primaryVideoIdentityErrors) console.log(`  ✗ ${error}`)
  }

  // Print every non-clean outcome (hard first, then soft, then error).
  const order = ["hard-regression", "soft-regression", "error"] as const
  for (const bucket of order) {
    const rows = comparisons.filter((c) => c.outcome === bucket)
    if (rows.length === 0) continue
    console.log(`\n${bucket.toUpperCase()} (${rows.length}):`)
    for (const r of rows) {
      console.log(`  [${r.group}] ${r.path}`)
      console.log(
        `      prod ${r.production.status} (${r.production.finalPath}) | preview ${r.preview.status} (${r.preview.finalPath})`,
      )
      console.log(`      ${r.note}`)
    }
  }

  if (jsonOut) {
    writeFileSync(
      jsonOut,
      JSON.stringify({ production, preview, tally, comparisons }, null, 2),
    )
    console.log(`\nFull report written to ${jsonOut}`)
  }

  const total = comparisons.length
  const softRate = tally["soft-regression"] / total
  console.log(
    `\nSummary: ${total} URLs — ${tally.match} match, ${tally.acceptable} acceptable, ` +
      `${tally["soft-regression"]} soft (${(softRate * 100).toFixed(1)}%), ` +
      `${tally["hard-regression"]} hard, ${tally.error} error`,
  )

  const hardFail = tally["hard-regression"] > 0
  const softFail = softRate > SOFT_REGRESSION_BUDGET
  if (
    hardFail ||
    softFail ||
    tally.error > 0 ||
    primaryVideoIdentityErrors.length > 0
  ) {
    console.error(
      `\n❌ Cutover gate FAILED — ${tally["hard-regression"]} hard regression(s), ` +
        `${(softRate * 100).toFixed(1)}% soft (budget ${(SOFT_REGRESSION_BUDGET * 100).toFixed(0)}%), ` +
        `${tally.error} error(s), ${primaryVideoIdentityErrors.length} primary-video identity error(s). ` +
        "Review the buckets above before cutover.",
    )
    process.exit(1)
  }
  console.log(
    `\n✅ Cutover gate PASSED — 0 hard regressions, soft within ${(SOFT_REGRESSION_BUDGET * 100).toFixed(0)}% budget.`,
  )
}

void main()
