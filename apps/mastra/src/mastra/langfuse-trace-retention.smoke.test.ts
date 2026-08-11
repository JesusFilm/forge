import { randomUUID } from "node:crypto"

import { describe, expect, it } from "vitest"

import { env, getLangfuseConfig } from "../config/env"

import { AI_CHAT_RETENTION_DAYS } from "./ai-chat-retention"
import {
  deleteTraceBatch,
  listExpiredObservationsPage,
} from "./langfuse-trace-retention"

/**
 * Opt-in REAL-CREDENTIAL Langfuse trace-retention smoke (feat-336). Proves
 * the live wire contract the daily sweep depends on, end to end, with THIS
 * module's own client functions — real `getLangfuseConfig()` env config, the
 * REAL global fetch, no mocks anywhere in this file. Skipped (and REPORTED as
 * skipped) in every default run: only `LANGFUSE_TRACE_RETENTION_SMOKE_TEST=1`
 * enables it, mirroring `langfuse-prompt-client.smoke.test.ts`.
 *
 * WHAT IT PROVES (three legs over one backdated sentinel plus a fresh
 * negative-control sentinel):
 *   1. SEED + LIST — a sentinel trace + span ingested with a CLIENT-SUPPLIED
 *      timestamp older than the retention window (Langfuse ingestion accepts
 *      backdated `timestamp`/`startTime` on the legacy batch endpoint, so the
 *      window filter is smokeable directly) is found by
 *      `listExpiredObservationsPage` — proving the `toStartTime` / `fields` /
 *      cursor parameter shapes against the live successor endpoint. A SECOND
 *      sentinel with a CURRENT timestamp must be ABSENT from the same
 *      listing (negative control): presence-only would stay green even if
 *      the server ignored `toStartTime` entirely — the failure mode where
 *      the sweep would list, and delete, the whole project.
 *   2. DELETE — `deleteTraceBatch` submits `{ traceIds }` (both sentinels in
 *      ONE batch — still a single request against the 50/day quota) and the
 *      API accepts it (2xx) — proving the batch-delete body shape.
 *   3. REQUERY — the window re-lists successfully after the delete. Upstream
 *      deletion is ASYNCHRONOUS (~15 min, no completion event; the vendor's
 *      documented verification IS re-querying), so this leg verifies that
 *      deletion actually converges ON THE API and reports (never fails on)
 *      whether the sentinel already converged — convergence timing is the
 *      vendor's SLA, not this repo's contract. This smoke is the module's
 *      only DIRECT deletion-completion evidence: the daily sweep's runtime
 *      verification is the outcome metric (`oldest_age_days` /
 *      `retention_wall_risk`), not receipt-tracking (the in-memory
 *      verify-by-requery mechanism was removed 2026-08-11 — see the module
 *      header).
 *
 * SAFETY: both sentinels live in the `forge-mastra` project under unique
 * `smoke-retention-*` trace ids/names minted per run, and the delete leg
 * targets EXACTLY those two ids — never a listing-derived id — so a real
 * seeker trace can never be deleted by this suite, even inside the expired
 * window (the fresh sentinel is deleted too, so the smoke leaves no junk).
 *
 * TO RUN (same shape as the prompt smoke — vitest loads no .env here, so the
 * values must reach the process as real env; use the LOCAL-DEV key pair,
 * never Railway's):
 *
 *   (set -a; source <(grep '^LANGFUSE_' apps/mastra/.env); set +a; \
 *    LANGFUSE_TRACE_RETENTION_SMOKE_TEST=1 \
 *    pnpm --filter @forge/mastra test -- langfuse-trace-retention.smoke)
 *
 * NOTE the delete leg SPENDS one request of the org's 50/day Hobby
 * trace-deletion quota per run — don't loop it.
 */

const RUN_SMOKE = env.LANGFUSE_TRACE_RETENTION_SMOKE_TEST === "1"

const DAY_MS = 24 * 60 * 60 * 1000
// Network-bound legs with ingestion latency in front: generous timeout.
const SMOKE_TEST_TIMEOUT_MS = 120_000
// Ingestion is eventually consistent; poll the listing until the sentinel
// materializes (bounded).
const LIST_POLL_ATTEMPTS = 12
const LIST_POLL_DELAY_MS = 5_000

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Page through the expired window with the REAL client until `traceId` is
 * found or pages run out. Returns whether it was seen.
 */
async function windowContainsTrace(
  config: ReturnType<typeof getLangfuseConfig>,
  toStartTimeIso: string,
  traceId: string,
): Promise<boolean> {
  let cursor: string | undefined
  for (let page = 0; page < 50; page += 1) {
    const result = await listExpiredObservationsPage({
      config,
      toStartTimeIso,
      cursor,
    })
    // The listing leg itself must never fail — that IS the contract under test.
    expect(result.ok, `list failed: ${JSON.stringify(result)}`).toBe(true)
    if (!result.ok) return false
    if (result.traceIds.includes(traceId)) return true
    if (!result.nextCursor) return false
    cursor = result.nextCursor
  }
  return false
}

describe.skipIf(!RUN_SMOKE)(
  "langfuse trace retention real-credential smoke",
  () => {
    const config = getLangfuseConfig()

    it(
      "LIST finds a backdated sentinel, DELETE accepts it, REQUERY re-reads the window",
      async () => {
        // ── Seed: a backdated sentinel + a FRESH negative-control sentinel ──
        const sentinelTraceId = `smoke-retention-${randomUUID()}`
        const freshTraceId = `smoke-retention-fresh-${randomUUID()}`
        const backdatedIso = new Date(
          Date.now() - (AI_CHAT_RETENTION_DAYS + 1) * DAY_MS,
        ).toISOString()
        const freshIso = new Date().toISOString()
        const base = (config.baseUrl ?? "").endsWith("/")
          ? (config.baseUrl ?? "")
          : `${config.baseUrl}/`
        const auth = `Basic ${Buffer.from(
          `${config.publicKey}:${config.secretKey}`,
        ).toString("base64")}`
        const ingestResponse = await fetch(
          new URL("api/public/ingestion", base),
          {
            method: "POST",
            headers: {
              authorization: auth,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              batch: [
                {
                  id: randomUUID(),
                  type: "trace-create",
                  timestamp: backdatedIso,
                  body: {
                    id: sentinelTraceId,
                    name: "smoke-retention-sentinel",
                    timestamp: backdatedIso,
                  },
                },
                {
                  id: randomUUID(),
                  type: "span-create",
                  timestamp: backdatedIso,
                  body: {
                    id: `${sentinelTraceId}-span`,
                    traceId: sentinelTraceId,
                    name: "smoke-retention-sentinel-span",
                    startTime: backdatedIso,
                    endTime: backdatedIso,
                  },
                },
                {
                  id: randomUUID(),
                  type: "trace-create",
                  timestamp: freshIso,
                  body: {
                    id: freshTraceId,
                    name: "smoke-retention-fresh-sentinel",
                    timestamp: freshIso,
                  },
                },
                {
                  id: randomUUID(),
                  type: "span-create",
                  timestamp: freshIso,
                  body: {
                    id: `${freshTraceId}-span`,
                    traceId: freshTraceId,
                    name: "smoke-retention-fresh-sentinel-span",
                    startTime: freshIso,
                    endTime: freshIso,
                  },
                },
              ],
            }),
          },
        )
        // The legacy batch endpoint answers 207 with per-event results.
        expect([200, 201, 207]).toContain(ingestResponse.status)

        // ── Leg 1: LIST — the sentinel appears inside the expired window ────
        const toStartTimeIso = new Date(
          Date.now() - AI_CHAT_RETENTION_DAYS * DAY_MS,
        ).toISOString()
        let listed = false
        for (let attempt = 0; attempt < LIST_POLL_ATTEMPTS; attempt += 1) {
          if (
            await windowContainsTrace(config, toStartTimeIso, sentinelTraceId)
          ) {
            listed = true
            break
          }
          await sleep(LIST_POLL_DELAY_MS)
        }
        expect(
          listed,
          "backdated sentinel never appeared in the expired-window listing — " +
            "either ingestion failed or the toStartTime/fields contract drifted",
        ).toBe(true)

        // Negative control: the FRESH sentinel must be ABSENT from the same
        // expired window — presence-only would stay green even with the
        // server-side toStartTime filter inert (the project-wide-delete
        // failure mode the sweep's client-side re-check also guards).
        expect(
          await windowContainsTrace(config, toStartTimeIso, freshTraceId),
          "fresh negative-control sentinel appeared in the EXPIRED window — " +
            "the server-side toStartTime filter is not being honored",
        ).toBe(false)

        // ── Leg 2: DELETE — the batch body shape is accepted ────────────────
        // EXACTLY the two smoke sentinels, one request (see SAFETY note).
        const deleted = await deleteTraceBatch({
          config,
          traceIds: [sentinelTraceId, freshTraceId],
        })
        expect(
          deleted,
          "DELETE /api/public/traces refused the { traceIds } batch",
        ).toEqual({ ok: true })

        // ── Leg 3: REQUERY — direct evidence deletion converges upstream ────
        // Deletion is async (~15 min): still-listed is a VALID outcome here.
        // The assertion is that the window re-reads cleanly post-delete; the
        // convergence state is reported for the human running the smoke.
        const stillListed = await windowContainsTrace(
          config,
          toStartTimeIso,
          sentinelTraceId,
        )
        console.info(
          `[langfuse-retention-smoke] event=requery_complete sentinel_converged=${stillListed ? 0 : 1}`,
        )
      },
      SMOKE_TEST_TIMEOUT_MS,
    )
  },
)
