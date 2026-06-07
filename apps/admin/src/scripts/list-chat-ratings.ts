#!/usr/bin/env tsx
/**
 * List `chat-thumb-rating` scores from a workstation against any
 * `DATABASE_URL`. The prod inspection path for the chat-rating
 * feature when Mastra Studio is not available (Mastra Studio is
 * dev-only — `pnpm --filter @forge/admin mastra:dev` — and is not
 * deployed on Railway).
 *
 * Reads directly from the Mastra scores store via the in-process
 * Mastra singleton — same pattern `apps/admin/src/scripts/run-embeds.ts`
 * uses for the embedding workflows. Operates against the
 * `MASTRA_STORAGE_URL` (falling back to `DATABASE_URL`) configured
 * on the local env or via `railway run` for prod.
 *
 * Usage:
 *   DATABASE_URL='postgresql://...' \
 *     pnpm --filter @forge/admin chat-ratings:list --limit 50
 *
 *   # Optional filters (all repeatable / single-valued):
 *   --limit=<N>          page size (default 100)
 *   --user=<userId>      filter to a single rater
 *   --message=<msgId>    filter to a single chat message
 *   --since=<ISO>        only ratings with createdAt >= the given ISO date
 *   --include-cleared    include clear-records (default: omit)
 *
 * Output: one JSON object per record on stdout, plus a trailing
 * `chat-ratings.complete` summary line. Safe to pipe through `jq`.
 *
 * Exit codes:
 *   0  success (zero records is success)
 *   1  unrecoverable failure
 */

import { CHAT_THUMB_RATING_SCORER_ID } from "@/mastra/scorers/chat-thumb-rating"
import { getMastra } from "@/mastra"

type Args = {
  limit: number
  user?: string
  message?: string
  since?: Date
  includeCleared: boolean
}

function parseArgs(argv: ReadonlyArray<string>): Args {
  const out: Args = { limit: 100, includeCleared: false }
  for (const raw of argv.slice(2)) {
    if (raw === "--include-cleared") {
      out.includeCleared = true
      continue
    }
    const eqIdx = raw.indexOf("=")
    if (eqIdx === -1) continue
    const key = raw.slice(0, eqIdx)
    const value = raw.slice(eqIdx + 1)
    switch (key) {
      case "--limit": {
        const n = Number.parseInt(value, 10)
        if (!Number.isFinite(n) || n < 1) {
          throw new Error(`--limit must be a positive integer (got '${value}')`)
        }
        out.limit = n
        break
      }
      case "--user":
        out.user = value
        break
      case "--message":
        out.message = value
        break
      case "--since": {
        const d = new Date(value)
        if (Number.isNaN(d.getTime())) {
          throw new Error(`--since must be an ISO date (got '${value}')`)
        }
        out.since = d
        break
      }
      default:
        console.warn(`[chat-ratings:list] unknown flag '${key}', ignoring`)
    }
  }
  return out
}

type PrintableRecord = {
  id: string
  createdAt: string
  entityId: string
  score: number
  cleared: boolean
  raterUserId: string | null
  comment: string | null
  producedBy: string | null
  runId: string
}

function toPrintable(row: {
  id: string
  createdAt: Date | string
  entityId: string
  score: number
  runId: string
  metadata?: unknown
}): PrintableRecord {
  const md = (row.metadata ?? {}) as {
    cleared?: boolean
    raterUserId?: string
    comment?: string | null
    producedBy?: string
  }
  return {
    id: row.id,
    createdAt:
      row.createdAt instanceof Date
        ? row.createdAt.toISOString()
        : new Date(row.createdAt).toISOString(),
    entityId: row.entityId,
    score: row.score,
    cleared: md.cleared === true,
    raterUserId: md.raterUserId ?? null,
    comment: md.comment ?? null,
    producedBy: md.producedBy ?? null,
    runId: row.runId,
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv)
  const mastra = getMastra()
  const storage = mastra.getStorage()
  if (!storage) {
    console.error(
      "[chat-ratings:list] Mastra storage unavailable — set MASTRA_STORAGE_URL or DATABASE_URL.",
    )
    process.exit(1)
  }
  const scores = await storage.getStore("scores")
  if (!scores) {
    console.error("[chat-ratings:list] scores domain unavailable.")
    process.exit(1)
  }

  const result = await scores.listScoresByScorerId({
    scorerId: CHAT_THUMB_RATING_SCORER_ID,
    entityId: args.message,
    pagination: { page: 0, perPage: args.limit },
  })

  let kept = 0
  for (const row of result.scores) {
    const printable = toPrintable(row)
    if (args.user && printable.raterUserId !== args.user) continue
    if (!args.includeCleared && printable.cleared) continue
    if (args.since && new Date(printable.createdAt) < args.since) continue
    process.stdout.write(JSON.stringify(printable) + "\n")
    kept += 1
  }

  process.stdout.write(
    JSON.stringify({
      event: "chat-ratings.complete",
      totalReturned: result.scores.length,
      printed: kept,
      pagination: result.pagination,
    }) + "\n",
  )
}

main().catch((err) => {
  console.error("[chat-ratings:list] fatal", err)
  process.exit(1)
})
