import { randomUUID } from "node:crypto"

import { describe, expect, it } from "vitest"

import { env, getLangfuseTraceRetentionConfig } from "../config/env"

import { AI_CHAT_RETENTION_DAYS } from "./ai-chat-retention"
import {
  deleteTraceBatch,
  LANGFUSE_RETENTION_LIST_PAGE_SIZE,
  listExpiredObservationsPage,
  MAX_TRACE_IDS_PER_DELETE_REQUEST,
} from "./langfuse-trace-retention"

/**
 * Opt-in REAL-CREDENTIAL Langfuse trace-retention smoke (feat-336). Proves
 * the live wire contract the daily sweep depends on with THIS module's own
 * client functions and the sweep's own config path
 * (`getLangfuseTraceRetentionConfig()` — the 15s retention timeout; the first
 * run of this smoke is what MEASURED the live batch-DELETE over the old 3s
 * prompt default and exposed the inherited-timeout defect). Skipped (and
 * REPORTED as skipped) in every default run: only
 * `LANGFUSE_TRACE_RETENTION_SMOKE_TEST=1` enables it, mirroring
 * `langfuse-prompt-client.smoke.test.ts`.
 *
 * REDESIGNED 2026-08-11 after the original synthetic-sentinel design was
 * FALSIFIED against the live API: observations ingested via the legacy batch
 * endpoint (`POST /api/public/ingestion`) NEVER materialize on the
 * `GET /v2/observations` read surface this sweep lists from — fresh AND
 * backdated alike (verified via langfuse-cli 2026-08-11: the trace RECORD
 * stores, backdated timestamp intact, and names its span; the v2
 * observations list returns the span under NO window, while OTel-ingested
 * production rows appear fine). The feat-336 ticket's original "age IS
 * fakeable via client-supplied timestamp" premise therefore holds for the
 * trace read path only — NOT for the v2 index — and a backdated synthetic
 * sentinel can never appear in the window listing. Consequence for the
 * SWEEP: only traces with v2-indexed observations are sweepable; a
 * legacy-batch trace is invisible to it (production traces arrive via OTel,
 * which indexes). Sentinels minted here are therefore cleaned up by this
 * suite's own DELETE leg, never by the sweep.
 *
 * WHAT IT PROVES (hardened per ce-code-review 2026-08-11):
 *   1. LIST CONTRACT + SERVER-FILTER PROOF — `listExpiredObservationsPage`
 *      over the sweep's exact expired window succeeds AND
 *      `filterSkipped === 0` is asserted UNCONDITIONALLY: the client-side
 *      per-row re-check counts any returned row whose own startTime is
 *      inside the window, so a server that ignores or drifts `toStartTime`
 *      turns this red with NO dependence on what data exists. Row count is
 *      REPORTED, not asserted — a drained window (0 rows) is healthy steady
 *      state.
 *   2. NEGATIVE CONTROL (real row, raw surface) — a RECENT production
 *      observation's traceId, discovered live from the last 7 days, must be
 *      ABSENT from a RAW expired-window read (no client-side guard in the
 *      path, so this exercises the SERVER filter on a surface the module's
 *      own re-check cannot mask). SKIPPED WITH A LOUD REPORT LINE when the
 *      project has no recent observations or the discovery read fails —
 *      leg 1's filterSkipped assertion remains the data-independent proof,
 *      so a skipped control no longer silences the suite's only filter
 *      evidence.
 *   3. DELETE CONTRACT AT PRODUCTION BATCH SIZE —
 *      `MAX_TRACE_IDS_PER_DELETE_REQUEST` (50) sentinels are minted in ONE
 *      ingestion call (per-event errors checked — a 207 can embed failures)
 *      and deleted in ONE `deleteTraceBatch` request, measuring elapsed
 *      wall-clock so every run re-validates the retention timeout at the
 *      exact batch size production drains use. Still spends ONE request of
 *      the org's 50/day Hobby trace-deletion quota — don't loop the suite.
 *   4. SEEDED-THEN-CONVERGED REQUERY — before the delete, a bounded poll on
 *      the trace read path confirms a representative sentinel actually
 *      materialized (`sentinel_seeded=1`), so the post-delete convergence
 *      report can distinguish "deleted" from "never stored". Convergence
 *      stays REPORTED, never asserted (upstream deletion is async, ~15 min,
 *      no completion event — the timing is the vendor's SLA).
 *
 * TO RUN (vitest loads no .env here, so the values must reach the process as
 * real env; use the LOCAL-DEV key pair, never Railway's):
 *
 *   (set -a; source <(grep '^LANGFUSE_' apps/mastra/.env); set +a; \
 *    LANGFUSE_TRACE_RETENTION_SMOKE_TEST=1 \
 *    pnpm --filter @forge/mastra test -- langfuse-trace-retention.smoke)
 */

const RUN_SMOKE = env.LANGFUSE_TRACE_RETENTION_SMOKE_TEST === "1"

const DAY_MS = 24 * 60 * 60 * 1000
// Generous: covers the seed poll (<=30s) + a worst-case 15s delete + walks.
const SMOKE_TEST_TIMEOUT_MS = 180_000
/** Discovery window for the negative-control row: recent enough to sit far
 * inside the retention window, wide enough to survive quiet tracing days. */
const RECENT_DISCOVERY_DAYS = 7
/** Bounded pre-delete poll for sentinel materialization (leg 4). */
const SEED_POLL_ATTEMPTS = 15
const SEED_POLL_DELAY_MS = 2_000

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe.skipIf(!RUN_SMOKE)(
  "langfuse trace retention real-credential smoke",
  () => {
    const config = getLangfuseTraceRetentionConfig()
    const base = (config.baseUrl ?? "").endsWith("/")
      ? (config.baseUrl ?? "")
      : `${config.baseUrl}/`
    const auth = `Basic ${Buffer.from(
      `${config.publicKey}:${config.secretKey}`,
    ).toString("base64")}`
    const coreHeaders = {
      authorization: auth,
      "user-agent": config.userAgent,
    }

    it(
      "LIST proves the window filter, DELETE accepts a production-sized batch, REQUERY distinguishes seeded from converged",
      async () => {
        const cutoffMs = Date.now() - AI_CHAT_RETENTION_DAYS * DAY_MS
        const toStartTimeIso = new Date(cutoffMs).toISOString()

        // ── Leg 1: LIST CONTRACT + unconditional server-filter proof ────────
        const firstPage = await listExpiredObservationsPage({
          config,
          toStartTimeIso,
        })
        expect(
          firstPage.ok,
          `expired-window list failed: ${JSON.stringify(firstPage)}`,
        ).toBe(true)
        if (firstPage.ok) {
          // The data-independent filter proof: the client re-check counts any
          // returned row whose OWN startTime is inside the window. An inert or
          // renamed toStartTime param returns current rows -> non-zero.
          expect(
            firstPage.filterSkipped,
            "expired-window listing returned rows INSIDE the retention " +
              "window — the server-side toStartTime filter is not being honored",
          ).toBe(0)
          console.info(
            `[langfuse-retention-smoke] event=list_contract_ok window_rows_page1=${firstPage.observationCount} unique_traces_page1=${firstPage.traceIds.length} filter_skipped=0`,
          )
        }

        // ── Leg 2: NEGATIVE CONTROL on the RAW surface (no client guard) ────
        // Discovery: any observation from the last RECENT_DISCOVERY_DAYS whose
        // own startTime is inside the retention window.
        const discoveryUrl = new URL("api/public/v2/observations", base)
        discoveryUrl.searchParams.set(
          "fromStartTime",
          new Date(Date.now() - RECENT_DISCOVERY_DAYS * DAY_MS).toISOString(),
        )
        discoveryUrl.searchParams.set("fields", "core")
        discoveryUrl.searchParams.set("limit", "50")
        const discoveryResponse = await fetch(discoveryUrl, {
          headers: coreHeaders,
          redirect: "error",
          signal: AbortSignal.timeout(config.timeoutMs),
        })
        let recentTraceId: string | undefined
        if (discoveryResponse.status === 200) {
          const discovered = (await discoveryResponse.json()) as {
            data?: Array<{ traceId?: unknown; startTime?: unknown }>
          }
          const recentRow = (discovered.data ?? []).find(
            (row) =>
              typeof row.traceId === "string" &&
              row.traceId.length > 0 &&
              typeof row.startTime === "string" &&
              Date.parse(row.startTime) > cutoffMs,
          )
          recentTraceId =
            recentRow === undefined ? undefined : (recentRow.traceId as string)
        } else {
          await discoveryResponse.body?.cancel()
        }
        if (recentTraceId === undefined) {
          // Loud, honest skip: transient discovery failure or a quiet project.
          // NOT load-bearing — leg 1's filterSkipped assertion is the
          // data-independent filter proof; this control is defense in depth.
          console.warn(
            `[langfuse-retention-smoke] event=negative_control_skipped reason=${discoveryResponse.status === 200 ? "no_recent_observations" : "discovery_read_failed"}`,
          )
        } else {
          // RAW expired-window read: the module's client-side re-check is NOT
          // in this path, so absence here is the SERVER honoring the filter.
          const rawWindowUrl = new URL("api/public/v2/observations", base)
          rawWindowUrl.searchParams.set("toStartTime", toStartTimeIso)
          rawWindowUrl.searchParams.set("fields", "core")
          rawWindowUrl.searchParams.set("limit", "50")
          const rawWindowResponse = await fetch(rawWindowUrl, {
            headers: coreHeaders,
            redirect: "error",
            signal: AbortSignal.timeout(config.timeoutMs),
          })
          expect(rawWindowResponse.status).toBe(200)
          const rawWindow = (await rawWindowResponse.json()) as {
            data?: Array<{ traceId?: unknown }>
          }
          expect(
            (rawWindow.data ?? []).some((row) => row.traceId === recentTraceId),
            "a RECENT production observation appeared in a RAW EXPIRED-window " +
              "read — the server-side toStartTime filter is not being honored",
          ).toBe(false)
          console.info(
            "[langfuse-retention-smoke] event=negative_control_ok basis=recent_production_row surface=raw",
          )
        }

        // ── Leg 2b: PAGE-BYTE MEASUREMENT at the sweep's own page size ──────
        // A page-size constant is an estimate until a real page is measured
        // (feat-337 corollary in buffered-http-response-byte-cap-oom-guard).
        // Read-only, general bucket, counts-only logging. Projects a FULL
        // page from measured row width because the live page may return
        // fewer rows than requested.
        const measureUrl = new URL("api/public/v2/observations", base)
        measureUrl.searchParams.set("fields", "core")
        measureUrl.searchParams.set(
          "limit",
          String(LANGFUSE_RETENTION_LIST_PAGE_SIZE),
        )
        const measureResponse = await fetch(measureUrl, {
          headers: coreHeaders,
          redirect: "error",
          signal: AbortSignal.timeout(config.timeoutMs),
        })
        expect(measureResponse.status).toBe(200)
        const measureText = await measureResponse.text()
        const measuredPageBytes = Buffer.byteLength(measureText, "utf8")
        let measuredRows = 0
        try {
          measuredRows =
            (JSON.parse(measureText) as { data?: unknown[] }).data?.length ?? 0
        } catch {
          measuredRows = 0
        }
        if (measuredRows === 0) {
          // Loud, honest skip — zero rows would make the projection 0 and the
          // assertion below vacuously green while measuring nothing (the
          // silent-observation shape rule 3 of the byte-cap doc exists to
          // kill). Mirrors the erasure smoke's empty-project skip.
          console.warn(
            "[langfuse-retention-smoke] event=page_bytes_measure_skipped reason=empty_listing",
          )
        } else {
          const measuredBytesPerRow = Math.ceil(
            measuredPageBytes / measuredRows,
          )
          const projectedFullPageBytes =
            measuredBytesPerRow * LANGFUSE_RETENTION_LIST_PAGE_SIZE
          expect(
            projectedFullPageBytes,
            "a full sweep page projected from measured row bytes would breach " +
              "the response byte cap — shrink LANGFUSE_RETENTION_LIST_PAGE_SIZE",
          ).toBeLessThan(config.maxResponseBytes)
          console.info(
            `[langfuse-retention-smoke] event=page_bytes_measured rows=${measuredRows} page_bytes=${measuredPageBytes} bytes_per_row=${measuredBytesPerRow} projected_full_page=${projectedFullPageBytes} cap=${config.maxResponseBytes}`,
          )
        }

        // ── Leg 3: DELETE CONTRACT at production batch size ─────────────────
        // Mint a full production-sized batch in ONE ingestion call, delete it
        // in ONE request — measuring the exact regime the retention timeout
        // exists to protect, at the same 1-request quota cost.
        const sentinelIds = Array.from(
          { length: MAX_TRACE_IDS_PER_DELETE_REQUEST },
          () => `smoke-retention-${randomUUID()}`,
        )
        const probeId = sentinelIds[0]!
        const probeUrl = new URL(
          `api/public/traces/${encodeURIComponent(probeId)}`,
          base,
        )
        let seeded = false
        let sentinelsDeleted = false
        try {
          const nowIso = new Date().toISOString()
          const ingestResponse = await fetch(
            new URL("api/public/ingestion", base),
            {
              method: "POST",
              headers: { ...coreHeaders, "content-type": "application/json" },
              body: JSON.stringify({
                batch: sentinelIds.map((id) => ({
                  id: randomUUID(),
                  type: "trace-create",
                  timestamp: nowIso,
                  body: {
                    id,
                    name: "smoke-retention-delete-sentinel",
                    timestamp: nowIso,
                  },
                })),
              }),
              redirect: "error",
              signal: AbortSignal.timeout(config.timeoutMs),
            },
          )
          // The legacy batch endpoint answers 207 with per-event results — and
          // a 207 can EMBED failures the status code hides (the original
          // smoke's blind status check was part of why its fixture defect went
          // undiagnosed). Assert the per-event error list is empty.
          expect([200, 201, 207]).toContain(ingestResponse.status)
          const ingestBody = (await ingestResponse.json()) as {
            errors?: unknown[]
          }
          expect(
            ingestBody.errors ?? [],
            `ingestion reported per-event errors: ${JSON.stringify(ingestBody.errors)}`,
          ).toHaveLength(0)

          // ── Leg 4a: SEEDED check — poll one representative sentinel until
          // it materializes on the trace read path, so the convergence report
          // can distinguish "deleted" from "never stored".
          for (let attempt = 0; attempt < SEED_POLL_ATTEMPTS; attempt += 1) {
            const probe = await fetch(probeUrl, {
              headers: coreHeaders,
              redirect: "error",
              signal: AbortSignal.timeout(config.timeoutMs),
            })
            await probe.body?.cancel()
            if (probe.status === 200) {
              seeded = true
              break
            }
            await sleep(SEED_POLL_DELAY_MS)
          }
          console.info(
            `[langfuse-retention-smoke] event=sentinel_seeded seeded=${seeded ? 1 : 0}`,
          )

          // ── Leg 3b: the batch DELETE itself, measured ─────────────────────
          const deleteStart = performance.now()
          const deleted = await deleteTraceBatch({
            config,
            traceIds: sentinelIds,
          })
          const deleteElapsedMs = Math.round(performance.now() - deleteStart)
          sentinelsDeleted = deleted.ok
          expect(
            deleted,
            "DELETE /api/public/traces refused the { traceIds } batch",
          ).toEqual({ ok: true })
          console.info(
            `[langfuse-retention-smoke] event=delete_contract_ok batch_ids=${sentinelIds.length} elapsed_ms=${deleteElapsedMs} timeout_ms=${config.timeoutMs}`,
          )
        } finally {
          if (!sentinelsDeleted) {
            // Best-effort strand-prevention (security-review nit, 2026-08-12):
            // an assertion failure above would otherwise leave up to 50
            // sentinels that the SWEEP can never clean — they are invisible
            // to the v2 read surface (see header). deleteTraceBatch never
            // throws; the result is deliberately ignored on this path.
            await deleteTraceBatch({ config, traceIds: sentinelIds })
          }
        }

        // ── Leg 4b: REQUERY — window re-reads cleanly; convergence reported ─
        const requery = await listExpiredObservationsPage({
          config,
          toStartTimeIso,
        })
        expect(
          requery.ok,
          `post-delete window re-read failed: ${JSON.stringify(requery)}`,
        ).toBe(true)
        const traceRead = await fetch(probeUrl, {
          headers: coreHeaders,
          redirect: "error",
          signal: AbortSignal.timeout(config.timeoutMs),
        })
        await traceRead.body?.cancel()
        // Converged is only claimable for a sentinel PROVEN to have existed;
        // still reported, never asserted (deletion is async upstream).
        console.info(
          `[langfuse-retention-smoke] event=requery_complete sentinel_seeded=${seeded ? 1 : 0} sentinel_converged=${seeded && traceRead.status === 404 ? 1 : 0}`,
        )
      },
      SMOKE_TEST_TIMEOUT_MS,
    )
  },
)
