import { randomUUID } from "node:crypto"

import { describe, expect, it } from "vitest"

import { env, getLangfuseTraceRetentionConfig } from "../config/env"

import { LANGFUSE_ERASURE_PINNED_HOST } from "./ai-chat-erasure"
import {
  LANGFUSE_ERASURE_LIST_PAGE_SIZE,
  listObservationsByUserIdPage,
} from "./langfuse-trace-retention"

/**
 * Opt-in REAL-CREDENTIAL Langfuse READ smoke (feat-337 U7, KTD8). Proves the
 * live by-userId listing contract the erasure module's Langfuse half rests on:
 * that `fields=core,basic` genuinely returns `userId` per row (the R7
 * empirical pin — typings-claimed until this suite observes it), and that a
 * nonexistent key lists ZERO rows (the no-data path against the real
 * contract). It also MEASURES the project's traces-per-userId spread (max +
 * p95) so F2's completion-horizon claim ("typically ≤2 daily runs at dogfood
 * volumes") is grounded in an observation rather than assumed — the human
 * runner copies the reported numbers into the feat-337 ticket Resolution.
 *
 * STRICTLY READ-ONLY, ASSERTED BY CONSTRUCTION: this file imports ONLY the
 * listing primitive `listObservationsByUserIdPage` (plus the config accessor)
 * — never `deleteTraceBatch`, never the erasure module's execute path — and
 * its one suite-local `fetch` helper issues GET requests only. Zero delete
 * requests are POSSIBLE from this suite, so it spends none of the org's
 * 50/day Hobby trace-delete quota, and it may be re-run freely. (The seeded
 * verify-by-requery smoke the ticket originally described is impossible:
 * legacy-batch-ingested sentinels never materialize on the v2 observations
 * read surface — verified 2026-08-11, see the retention smoke's header — so
 * the delete surface stays proven by feat-336's smoke + unit wire-shape
 * tests, and THIS suite proves the read half against real project data.)
 *
 * Subject discovery is RUNTIME-ONLY (R4): no committed real `user:<sub>`
 * literal — that would embed a real person's stable identifier in the repo
 * and rot as the retention sweep drains their traces. One unfiltered
 * `fields=core,basic` discovery listing (the module's own listing primitive
 * requires a userId filter, so discovery uses the suite-local GET helper)
 * yields a `userId` from a returned row; the suite then re-queries FILTERED
 * by it and asserts every returned row's `userId` STRICTLY equals the
 * discovered value. The discovered value never appears in logs, assertion
 * messages, or test names — every assertion over it is boolean-shaped
 * (`expect(rows.every(...)).toBe(true)`), so a failure prints booleans, not
 * identifiers. A project with no rows skips loudly (console.warn, counts
 * only) rather than passing vacuously.
 *
 * Skipped (and REPORTED as skipped) in every default run: only
 * `AI_CHAT_ERASURE_LANGFUSE_SMOKE_TEST=1` enables it, mirroring
 * `LANGFUSE_TRACE_RETENTION_SMOKE_TEST`.
 *
 * TO RUN (vitest loads no .env here, so the trio must reach the process as
 * real env; use the LOCAL-DEV key pair, never Railway's — subshell form so
 * the credentials die with it):
 *
 *   (set -a; source <(grep '^LANGFUSE_' apps/mastra/.env); set +a; \
 *    AI_CHAT_ERASURE_LANGFUSE_SMOKE_TEST=1 \
 *    pnpm --filter @forge/mastra test -- ai-chat-erasure.langfuse)
 */

const RUN_SMOKE = env.AI_CHAT_ERASURE_LANGFUSE_SMOKE_TEST === "1"

const SMOKE_TEST_TIMEOUT_MS = 120_000
/**
 * Bound on the discovery drain (spread measurement included): 20 pages x 100
 * rows = 2,000 observations, mirroring the erasure module's own
 * `MAX_ERASURE_LIST_PAGES_PER_RUN` rationale — never spin the general API
 * bucket (30 req/min).
 */
const DISCOVERY_MAX_PAGES = 20

type DiscoveryRow = { traceId: string; userId: string }
type DiscoveryPage = { rows: DiscoveryRow[]; nextCursor?: string }

describe.skipIf(!RUN_SMOKE)("ai-chat erasure Langfuse read smoke", () => {
  const config = getLangfuseTraceRetentionConfig()
  if (RUN_SMOKE && !(config.baseUrl && config.publicKey && config.secretKey)) {
    // Loud, not skipped: the gate was set deliberately, so a missing trio is
    // an operator error to surface — a silent skip would read as a pass.
    throw new Error(
      "AI_CHAT_ERASURE_LANGFUSE_SMOKE_TEST=1 requires the LANGFUSE_BASE_URL/" +
        "LANGFUSE_PUBLIC_KEY/LANGFUSE_SECRET_KEY trio in the process env",
    )
  }
  if (RUN_SMOKE) {
    // KTD11 mirror, BEFORE any auth value is computed: this suite sends real
    // Basic credentials, so the base URL must be https AND its host either
    // the module's pinned vendor-cloud host or listed in
    // `LANGFUSE_ALLOWED_HOSTS` — the same egress pin the erasure module
    // applies before its first request.
    const url = new URL(config.baseUrl ?? "")
    const allowedHosts = new Set(
      (env.LANGFUSE_ALLOWED_HOSTS ?? "")
        .split(",")
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean),
    )
    const host = url.hostname.toLowerCase()
    if (
      url.protocol !== "https:" ||
      !(host === LANGFUSE_ERASURE_PINNED_HOST || allowedHosts.has(host))
    ) {
      throw new Error(
        "ai-chat-erasure.langfuse.smoke: LANGFUSE_BASE_URL must be https " +
          "with the pinned host or one listed in LANGFUSE_ALLOWED_HOSTS " +
          "(KTD11 egress pin) — refusing to send credentials",
      )
    }
  }
  const base = (config.baseUrl ?? "").endsWith("/")
    ? (config.baseUrl ?? "")
    : `${config.baseUrl}/`
  const auth = `Basic ${Buffer.from(
    `${config.publicKey}:${config.secretKey}`,
  ).toString("base64")}`

  /**
   * Suite-local UNFILTERED discovery read: GET only, Basic auth from the
   * sweep config, `redirect: "error"`, `AbortSignal.timeout`. Exists only
   * because `listObservationsByUserIdPage` (correctly) refuses a blank
   * userId filter, so discovery cannot go through the production primitive.
   * Rows are projected to exactly `{ traceId, userId }` and never logged.
   */
  /** Largest discovery page observed, in real bytes — see the read below. */
  let maxDiscoveryPageBytes = 0

  async function fetchDiscoveryPage(cursor?: string): Promise<DiscoveryPage> {
    const url = new URL("api/public/v2/observations", base)
    url.searchParams.set("fields", "core,basic")
    // The PRODUCTION page-size constant, imported — never a local literal —
    // so the bytes measured below are bytes at the size the erasure listing
    // actually requests.
    url.searchParams.set("limit", String(LANGFUSE_ERASURE_LIST_PAGE_SIZE))
    if (cursor !== undefined) url.searchParams.set("cursor", cursor)
    const response = await fetch(url, {
      method: "GET",
      headers: { authorization: auth, "user-agent": config.userAgent },
      redirect: "error",
      signal: AbortSignal.timeout(config.timeoutMs),
    })
    expect(response.status).toBe(200)
    // Deliberately OUTSIDE the production byte-cap reader: an opt-in,
    // short-lived test process reading a limit-bounded page — the MEASURED
    // `discovery_page_bytes` log line is the compensating control, and is
    // what grounds the `LANGFUSE_ERASURE_LIST_PAGE_SIZE` byte derivation in
    // a real per-page observation on every future run.
    const text = await response.text()
    maxDiscoveryPageBytes = Math.max(
      maxDiscoveryPageBytes,
      Buffer.byteLength(text),
    )
    const body = JSON.parse(text) as {
      data?: Array<{ traceId?: unknown; userId?: unknown }>
      meta?: { cursor?: string | null } | null
    }
    const rows: DiscoveryRow[] = []
    for (const row of body.data ?? []) {
      if (
        typeof row.traceId === "string" &&
        row.traceId.length > 0 &&
        typeof row.userId === "string" &&
        row.userId.length > 0
      ) {
        rows.push({ traceId: row.traceId, userId: row.userId })
      }
    }
    const nextCursor = body.meta?.cursor ?? undefined
    return { rows, ...(nextCursor ? { nextCursor } : {}) }
  }

  it(
    "a nonexistent userId lists ZERO rows (the real no-data contract)",
    async () => {
      // Never a real subject: a freshly minted key that cannot exist upstream.
      const page = await listObservationsByUserIdPage({
        config,
        userId: `user:erasure-smoke-nonexistent-${randomUUID()}`,
      })
      expect(page.ok, page.ok ? "" : JSON.stringify(page)).toBe(true)
      if (page.ok) {
        expect(page.rows).toHaveLength(0)
        expect(page.observationCount).toBe(0)
        expect(page.missingUserIdCount).toBe(0)
        console.info("[erasure-langfuse-smoke] event=nonexistent_key_ok rows=0")
      }
    },
    SMOKE_TEST_TIMEOUT_MS,
  )

  it(
    "fields=core,basic returns userId per row, the filtered listing matches it exactly, and the traces-per-userId spread is reported",
    async () => {
      // ── Discovery drain (bounded) — also feeds the spread measurement ─────
      const tracesByUser = new Map<string, Set<string>>()
      let discoveredRows = 0
      let cursor: string | undefined
      for (let page = 0; page < DISCOVERY_MAX_PAGES; page += 1) {
        const result = await fetchDiscoveryPage(cursor)
        discoveredRows += result.rows.length
        for (const row of result.rows) {
          const set = tracesByUser.get(row.userId) ?? new Set<string>()
          set.add(row.traceId)
          tracesByUser.set(row.userId, set)
        }
        if (!result.nextCursor) break
        cursor = result.nextCursor
      }

      if (discoveredRows === 0) {
        // Loud, honest skip (counts only): a drained/empty project means the
        // suite has no real subject to pin the contract against — that is a
        // "come back when data exists" state, never a pass and never a fail.
        console.warn(
          "[erasure-langfuse-smoke] event=skipped reason=no_observations_in_project rows=0",
        )
        return
      }

      // ── The R7 empirical pin: re-query FILTERED by a discovered userId ────
      // The subject stays a runtime value; every assertion over it is
      // boolean-shaped so a failure prints booleans, never the identifier.
      const subject = [...tracesByUser.keys()][0]!
      const filtered = await listObservationsByUserIdPage({
        config,
        userId: subject,
      })
      expect(filtered.ok, filtered.ok ? "" : JSON.stringify(filtered)).toBe(
        true,
      )
      if (filtered.ok) {
        expect(filtered.rows.length > 0).toBe(true)
        expect(filtered.missingUserIdCount).toBe(0)
        expect(filtered.rows.every((row) => row.userId === subject)).toBe(true)
        console.info(
          `[erasure-langfuse-smoke] event=filtered_listing_ok rows=${filtered.rows.length} missing_user_id_rows=0`,
        )
      }

      // ── Traces-per-userId spread (zero delete-quota cost, F2) ─────────────
      // Grounds the completion-horizon claim: the runner copies these COUNTS
      // into the feat-337 ticket Resolution. Never a userId.
      const perUserTraceCounts = [...tracesByUser.values()]
        .map((traceIds) => traceIds.size)
        .sort((left, right) => left - right)
      const max = perUserTraceCounts[perUserTraceCounts.length - 1] ?? 0
      const p95 =
        perUserTraceCounts[
          Math.max(0, Math.ceil(perUserTraceCounts.length * 0.95) - 1)
        ] ?? 0
      console.info(
        `[erasure-langfuse-smoke] event=traces_per_user_spread users=${tracesByUser.size} observations_sampled=${discoveredRows} traces_per_user_max=${max} traces_per_user_p95=${p95} discovery_page_bytes=${maxDiscoveryPageBytes}`,
      )
      // Measure AND assert (the log line above stays as the operator
      // evidence, but a log alone is an observation nobody is obliged to
      // read): a page at the production page size crossing HALF the
      // `LANGFUSE_MAX_RESPONSE_BYTES` cap means the
      // `LANGFUSE_ERASURE_LIST_PAGE_SIZE` derivation must be re-done BEFORE
      // it becomes the deterministic parse_error outage. Zero-page runs exit
      // via the `discoveredRows === 0` skip above, so at least one page was
      // measured here.
      expect(maxDiscoveryPageBytes).toBeLessThan(config.maxResponseBytes / 2)
    },
    SMOKE_TEST_TIMEOUT_MS,
  )
})
