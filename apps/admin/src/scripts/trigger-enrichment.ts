#!/usr/bin/env tsx
/**
 * Trigger apps/manager's enrichment pipeline (scene-analysis or
 * transcript-only) for a list of cms videos via admin's GraphQL
 * `triggerManagerEnrichment` mutation (feat-119 PR2).
 *
 * Operator workflow:
 *   1. Run `pnpm --filter @forge/admin run-embeds --pipeline=both
 *      --report-out=.tmp/embeds.json` (PR1) — produces a report
 *      including a `missingArtifacts: [{ assetId, coreId, kind }]`
 *      projection.
 *   2. Decide whether to backfill the missing upstream pipeline
 *      output. If yes:
 *      `pnpm --filter @forge/admin trigger-enrichment
 *        --from-report=.tmp/embeds.json
 *        --kind=transcript`
 *
 * Usage:
 *   pnpm --filter @forge/admin trigger-enrichment \
 *     --kind=scene-analysis|transcript    (required)
 *     --from-report=<path>                (optional — repeatable not supported)
 *     --asset-id=<num> --core-id=<id>     (alternative — repeatable, paired)
 *     --admin-graphql-url=<url>           (defaults to ADMIN_GRAPHQL_URL env)
 *     --workflow-api-key=<key>            (defaults to WORKFLOW_API_KEY env)
 *
 * Mutually exclusive: --from-report and --asset-id/--core-id pairs.
 *
 * Exit codes:
 *   0  — every per-id outcome was STARTED or ALREADY_IN_FLIGHT
 *   1  — at least one outcome was DISPATCH_FAILED / VALIDATION_FAILED / NOT_FOUND
 *   2  — argv parse / config error before the GraphQL call
 *   130 — SIGINT/SIGTERM during execution
 *
 * Report format consumed by --from-report:
 *   The `run-embeds.complete` JSON written by run-embeds.ts. The CLI
 *   walks `.reports.scene.missingArtifacts` and
 *   `.reports.transcript.missingArtifacts`, filters by --kind, and
 *   dedupes by assetId before sending.
 */

import { readFile } from "node:fs/promises"
import { isAbsolute, resolve } from "node:path"

// -----------------------------------------------------------------------------
// argv helpers (kept private to the file; mirror run-embeds.ts conventions)
// -----------------------------------------------------------------------------

function parseSingle(
  argv: readonly string[],
  name: string,
): string | undefined {
  const flag = `--${name}=`
  const arg = argv.find((a) => a.startsWith(flag))
  return arg ? arg.slice(flag.length) : undefined
}

function parseRepeated(argv: readonly string[], name: string): string[] {
  const flag = `--${name}=`
  return argv
    .filter((a) => a.startsWith(flag))
    .map((a) => a.slice(flag.length))
    .filter((v) => v.length > 0)
}

// -----------------------------------------------------------------------------
// PR1 report parsing — exported for tests
// -----------------------------------------------------------------------------

export type Kind = "scene-analysis" | "transcript"

export type ParsedReportItems = ReadonlyArray<{
  assetId: number
  coreId: string
}>

/**
 * Walk a parsed `run-embeds.complete` report and extract the
 * `missingArtifacts` entries that match the requested kind. Dedupes
 * by assetId (operator might rerun reports and end up with duplicate
 * transcript entries).
 *
 * Wire shape: transcript backfill stamps the literal `kind: "transcript"`,
 * matching the kind enum used by manager's route paths
 * (`/api/admin-trigger/{scene-analysis,transcript}`), so this filter is a
 * straight equality check on the requested `--kind` value.
 *
 * Returns [] when the report has no matching entries — the caller
 * must decide whether that's an error worth exiting non-zero on.
 */
export function extractMissingArtifactsFromReport(
  report: unknown,
  kind: Kind,
): ParsedReportItems {
  const collected = new Map<number, { assetId: number; coreId: string }>()

  if (!report || typeof report !== "object") return []
  const reports = (report as Record<string, unknown>).reports
  if (!reports || typeof reports !== "object") return []

  for (const sub of Object.values(reports as Record<string, unknown>)) {
    if (!sub || typeof sub !== "object") continue
    const missing = (sub as Record<string, unknown>).missingArtifacts
    if (!Array.isArray(missing)) continue
    for (const entry of missing) {
      if (!entry || typeof entry !== "object") continue
      const e = entry as Record<string, unknown>
      if (e.kind !== kind) continue
      const assetId = typeof e.assetId === "number" ? e.assetId : undefined
      const coreId = typeof e.coreId === "string" ? e.coreId : undefined
      if (assetId === undefined || !coreId) continue
      if (!collected.has(assetId)) {
        collected.set(assetId, { assetId, coreId })
      }
    }
  }
  // Stable ascending order by assetId for deterministic operator
  // output; matches PR1's projection sort order.
  return [...collected.values()].sort((a, b) => a.assetId - b.assetId)
}

/**
 * Resolve a `--from-report=<path>` argument to an absolute path or
 * undefined. Bare relative paths anchor to process.cwd().
 *
 * Exported for tests; symmetric with run-embeds.ts's
 * `resolveReportOutPath` to keep the producer/consumer pattern
 * legible across both halves.
 */
export function resolveReportInPath(
  arg: string | undefined,
): string | undefined {
  if (arg === undefined || arg === "") return undefined
  return isAbsolute(arg) ? arg : resolve(process.cwd(), arg)
}

// -----------------------------------------------------------------------------
// argv → items (exported for tests)
// -----------------------------------------------------------------------------

export type CliConfig = {
  kind: Kind
  items: ParsedReportItems
  graphqlUrl: string
  bearer: string
}

export class CliConfigError extends Error {
  constructor(
    message: string,
    readonly exitCode: 2 = 2,
  ) {
    super(message)
    this.name = "CliConfigError"
  }
}

function isKind(v: string): v is Kind {
  return v === "scene-analysis" || v === "transcript"
}

/**
 * Pure transform from argv → CliConfig. Exported so tests don't
 * have to invoke the CLI's network path. Throws CliConfigError on
 * any argv-parsing problem; the caller maps to exit code 2.
 */
export async function parseArgvToConfig(
  argv: readonly string[],
  envSource: { ADMIN_GRAPHQL_URL?: string; WORKFLOW_API_KEY?: string },
): Promise<CliConfig> {
  const kindArg = parseSingle(argv, "kind")
  if (!kindArg) {
    throw new CliConfigError(
      "[trigger-enrichment] --kind=scene-analysis|transcript is required",
    )
  }
  if (!isKind(kindArg)) {
    throw new CliConfigError(
      `[trigger-enrichment] invalid --kind=${kindArg}; expected scene-analysis|transcript`,
    )
  }

  const fromReport = parseSingle(argv, "from-report")
  const assetIdsRaw = parseRepeated(argv, "asset-id")
  const coreIdsRaw = parseRepeated(argv, "core-id")

  if (fromReport && (assetIdsRaw.length > 0 || coreIdsRaw.length > 0)) {
    throw new CliConfigError(
      "[trigger-enrichment] --from-report and --asset-id/--core-id are mutually exclusive",
    )
  }

  let items: ParsedReportItems
  if (fromReport) {
    const resolved = resolveReportInPath(fromReport)!
    let raw: string
    try {
      raw = await readFile(resolved, "utf8")
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new CliConfigError(
        `[trigger-enrichment] failed to read --from-report=${resolved}: ${msg}`,
      )
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw) as unknown
    } catch {
      throw new CliConfigError(
        `[trigger-enrichment] --from-report=${resolved} is not valid JSON`,
      )
    }
    items = extractMissingArtifactsFromReport(parsed, kindArg)
    if (items.length === 0) {
      throw new CliConfigError(
        `[trigger-enrichment] no missing artifacts of kind=${kindArg} found in ${resolved}`,
      )
    }
  } else {
    if (assetIdsRaw.length === 0 || coreIdsRaw.length === 0) {
      throw new CliConfigError(
        "[trigger-enrichment] supply --from-report=<path> OR paired --asset-id=<num> --core-id=<id> flags",
      )
    }
    if (assetIdsRaw.length !== coreIdsRaw.length) {
      throw new CliConfigError(
        `[trigger-enrichment] --asset-id (${assetIdsRaw.length}) and --core-id (${coreIdsRaw.length}) must be supplied in matched pairs`,
      )
    }
    items = assetIdsRaw.map((raw, i) => {
      const assetId = Number.parseInt(raw, 10)
      if (!Number.isInteger(assetId) || assetId <= 0) {
        throw new CliConfigError(
          `[trigger-enrichment] --asset-id values must be positive integers (got ${raw})`,
        )
      }
      return { assetId, coreId: coreIdsRaw[i]! }
    })
  }

  const graphqlUrl =
    parseSingle(argv, "admin-graphql-url") ?? envSource.ADMIN_GRAPHQL_URL
  if (!graphqlUrl) {
    throw new CliConfigError(
      "[trigger-enrichment] ADMIN_GRAPHQL_URL env or --admin-graphql-url=<url> is required",
    )
  }
  const bearer =
    parseSingle(argv, "workflow-api-key") ?? envSource.WORKFLOW_API_KEY
  if (!bearer) {
    throw new CliConfigError(
      "[trigger-enrichment] WORKFLOW_API_KEY env or --workflow-api-key=<key> is required",
    )
  }

  return { kind: kindArg, items, graphqlUrl, bearer }
}

// -----------------------------------------------------------------------------
// GraphQL invocation
// -----------------------------------------------------------------------------

const TRIGGER_MUTATION = /* GraphQL */ `
  mutation TriggerManagerEnrichment(
    $assetIds: [Int!]!
    $coreIds: [String!]!
    $kind: String!
  ) {
    triggerManagerEnrichment(
      assetIds: $assetIds
      coreIds: $coreIds
      kind: $kind
    )
  }
`

type ApiOutcome = {
  assetId: number
  coreId: string
  managerJobId: string | null
  status: string
  error?: string
  reason?: string
  retryable?: boolean
}

async function invoke(config: CliConfig): Promise<ApiOutcome[]> {
  const response = await fetch(config.graphqlUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.bearer}`,
    },
    body: JSON.stringify({
      query: TRIGGER_MUTATION,
      variables: {
        assetIds: config.items.map((i) => i.assetId),
        coreIds: config.items.map((i) => i.coreId),
        kind: config.kind,
      },
    }),
    signal: AbortSignal.timeout(30_000),
  })

  let body: {
    data?: { triggerManagerEnrichment?: ApiOutcome[] }
    errors?: Array<{ message: string }>
  }
  try {
    body = (await response.json()) as typeof body
  } catch {
    throw new Error(
      `[trigger-enrichment] admin GraphQL returned non-JSON (status ${response.status})`,
    )
  }
  if (body.errors && body.errors.length > 0) {
    throw new Error(
      `[trigger-enrichment] admin GraphQL errors: ${body.errors.map((e) => e.message).join("; ")}`,
    )
  }
  const outcomes = body.data?.triggerManagerEnrichment
  if (!Array.isArray(outcomes)) {
    throw new Error(
      "[trigger-enrichment] admin GraphQL response missing data.triggerManagerEnrichment",
    )
  }
  return outcomes
}

function summarise(outcomes: readonly ApiOutcome[]): {
  started: number
  alreadyInFlight: number
  notFound: number
  validationFailed: number
  dispatchFailed: number
  unknown: number
} {
  const summary = {
    started: 0,
    alreadyInFlight: 0,
    notFound: 0,
    validationFailed: 0,
    dispatchFailed: 0,
    // Catch-all for unknown statuses — admin's outbound client maps
    // unknown manager statuses to DISPATCH_FAILED before this layer
    // sees them, but if the GraphQL response itself drifts, count
    // them here so the exit-code branch surfaces the failure rather
    // than silently passing.
    unknown: 0,
  }
  for (const o of outcomes) {
    switch (o.status) {
      case "STARTED":
        summary.started += 1
        break
      case "ALREADY_IN_FLIGHT":
        summary.alreadyInFlight += 1
        break
      case "NOT_FOUND":
        summary.notFound += 1
        break
      case "VALIDATION_FAILED":
        summary.validationFailed += 1
        break
      case "DISPATCH_FAILED":
        summary.dispatchFailed += 1
        break
      default:
        summary.unknown += 1
    }
  }
  return summary
}

async function main(): Promise<void> {
  let config: CliConfig
  try {
    config = await parseArgvToConfig(process.argv.slice(2), {
      ADMIN_GRAPHQL_URL: process.env.ADMIN_GRAPHQL_URL,
      WORKFLOW_API_KEY: process.env.WORKFLOW_API_KEY,
    })
  } catch (err) {
    if (err instanceof CliConfigError) {
      process.stderr.write(err.message + "\n")
      process.exit(err.exitCode)
    }
    throw err
  }

  const onSignal = (signal: NodeJS.Signals) => {
    process.stderr.write(
      JSON.stringify({
        event: "trigger-enrichment.interrupted",
        signal,
      }) + "\n",
    )
    process.exit(130)
  }
  process.once("SIGINT", onSignal)
  process.once("SIGTERM", onSignal)

  process.stdout.write(
    JSON.stringify({
      event: "trigger-enrichment.start",
      kind: config.kind,
      itemCount: config.items.length,
      graphqlUrl: config.graphqlUrl,
    }) + "\n",
  )

  const outcomes = await invoke(config)

  // Per-line outcome stream (grep-friendly).
  for (const o of outcomes) {
    process.stdout.write(
      JSON.stringify({
        event: "trigger-enrichment.outcome",
        ...o,
      }) + "\n",
    )
  }

  const summary = summarise(outcomes)
  process.stdout.write(
    JSON.stringify({
      event: "trigger-enrichment.complete",
      kind: config.kind,
      total: outcomes.length,
      ...summary,
    }) + "\n",
  )

  process.off("SIGINT", onSignal)
  process.off("SIGTERM", onSignal)

  if (
    summary.dispatchFailed > 0 ||
    summary.notFound > 0 ||
    summary.validationFailed > 0 ||
    summary.unknown > 0
  ) {
    process.exit(1)
  }
}

if (
  typeof process.argv[1] === "string" &&
  import.meta.url === `file://${process.argv[1]}`
) {
  main().catch((err) => {
    process.stderr.write(
      JSON.stringify({
        event: "trigger-enrichment.fatal",
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      }) + "\n",
    )
    process.exit(1)
  })
}
