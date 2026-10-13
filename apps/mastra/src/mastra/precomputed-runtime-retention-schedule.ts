import { stat } from "node:fs/promises"
import { join } from "node:path"

import type { DuckDBStore } from "@mastra/duckdb"
import { Pool } from "pg"

import { getMastraDatabaseUrl, getMastraStorageDir } from "../config/env"
import { readAdminPrecomputedRetentionProof } from "../services/precomputed-recommendations/source-generation"
import {
  measurePrecomputedRuntimeSnapshots,
  measurePrecomputedRuntimeTraces,
  prunePrecomputedAbandonedRuntimeSnapshots,
  prunePrecomputedOrphanRunningTraces,
  prunePrecomputedRuntimeSnapshots,
  prunePrecomputedRuntimeTraces,
} from "./precomputed-runtime-retention"

const INTERVAL_MS = 6 * 60 * 60 * 1000
const BATCH_SIZE = 100
const MAX_DRAIN_BATCHES = 10
let abandonedCursor: { updatedAt: Date; runId: string } | undefined
let orphanTracePage = 0

/** Feature-only runtime retention; this does not schedule catalog builds. */
export function startPrecomputedRuntimeRetention(
  observability: DuckDBStore["observability"],
): void {
  async function sweep(): Promise<void> {
    const pool = new Pool({
      connectionString: getMastraDatabaseUrl(),
      max: 1,
      connectionTimeoutMillis: 5_000,
      statement_timeout: 15_000,
      query_timeout: 15_000,
    })
    try {
      let orphanDeleted = 0
      let orphanUnresolved = 0
      try {
        const orphanTraces = await prunePrecomputedOrphanRunningTraces({
          observability,
          readProof: readAdminPrecomputedRetentionProof,
          maxTraces: 20,
          page: orphanTracePage,
        })
        orphanTracePage = orphanTraces.nextPage
        orphanDeleted = orphanTraces.deletedTraces
        orphanUnresolved = orphanTraces.unresolvedTraces
      } catch {
        console.warn(
          "[precomputed-runtime-retention] orphan_trace_sweep_failed",
        )
      }
      let terminalDeleted = 0
      let abandonedDeleted = 0
      let abandonedUnresolved = 0
      let traceDeleted = 0
      try {
        for (let batch = 0; batch < MAX_DRAIN_BATCHES; batch++) {
          const result = await prunePrecomputedRuntimeSnapshots({
            pool,
            maxRows: BATCH_SIZE,
          })
          terminalDeleted += result.deletedRuns
          if (!result.hasMoreEligible || result.deletedRuns === 0) break
        }
        const abandoned = await prunePrecomputedAbandonedRuntimeSnapshots({
          pool,
          readProof: readAdminPrecomputedRetentionProof,
          maxRows: 20,
          after: abandonedCursor,
        })
        abandonedCursor = abandoned.nextCursor ?? undefined
        abandonedDeleted = abandoned.deletedRuns
        abandonedUnresolved = abandoned.unresolvedRuns
      } catch {
        console.warn("[precomputed-runtime-retention] snapshot_sweep_failed")
      }
      try {
        for (let batch = 0; batch < MAX_DRAIN_BATCHES; batch++) {
          const result = await prunePrecomputedRuntimeTraces({
            observability,
            maxTraces: BATCH_SIZE,
          })
          traceDeleted += result.deletedTraces
          if (!result.hasMoreEligible || result.deletedTraces === 0) break
        }
      } catch {
        console.warn("[precomputed-runtime-retention] ended_trace_sweep_failed")
      }
      const [snapshot, traces] = await Promise.all([
        measurePrecomputedRuntimeSnapshots({ pool }),
        measurePrecomputedRuntimeTraces({ observability }),
      ])
      const sharedDuckdbFileBytes = await stat(
        join(getMastraStorageDir(), "mastra-observability.duckdb"),
      )
        .then((file) => file.size)
        .catch(() => null)
      console.info(
        `[precomputed-runtime-retention] terminal_deleted=${terminalDeleted} abandoned_deleted=${abandonedDeleted} unresolved_snapshot_examined=${abandonedUnresolved} ended_traces_deleted=${traceDeleted} orphan_traces_deleted=${orphanDeleted} unresolved_trace_examined=${orphanUnresolved} feature_snapshots=${snapshot.featureRunCount} logical_snapshot_bytes=${snapshot.featureSnapshotBytes} shared_snapshot_relation_bytes=${snapshot.sharedRelationTotalBytes} feature_traces=${traces.featureTraceCount} running_traces=${traces.runningTraceCount} stale_nonterminal=${snapshot.staleNonterminalRunCount} stale_running_traces=${traces.staleRunningTraceCount} shared_duckdb_file_bytes=${sharedDuckdbFileBytes ?? "unknown"}`,
      )
      if (
        snapshot.staleNonterminalRunCount > 0 ||
        traces.staleRunningTraceCount > 0
      )
        console.warn(
          `[precomputed-runtime-retention] unresolved_backlog stale_nonterminal=${snapshot.staleNonterminalRunCount} stale_running_traces=${traces.staleRunningTraceCount}`,
        )
    } catch {
      console.warn("[precomputed-runtime-retention] sweep_failed")
    } finally {
      await pool.end().catch(() => undefined)
    }
  }

  function arm(): void {
    const now = Date.now()
    const untilNext = INTERVAL_MS - (now % INTERVAL_MS)
    const timer = setTimeout(() => {
      void sweep()
        .catch(() =>
          console.warn("[precomputed-runtime-retention] startup_failed"),
        )
        .finally(arm)
    }, untilNext)
    timer.unref()
  }
  // Boot only arms the timer; no import/build/dev invocation triggers deletion.
  arm()
}
