#!/usr/bin/env tsx
/**
 * Re-embed EXISTING scene + transcript text into the parallel
 * `embedding_qwen` column via the JesusFilm AI gateway (Qwen → 1536-dim).
 *
 * U4 of docs/plans/2026-06-05-001-feat-content-embeddings-gateway-migration-plan.md.
 *
 * This is a self-contained ADMIN script — NOT a Mastra/S3 pipeline. Both
 * target tables already store the embedded text verbatim:
 *   - `video_scene_locale.source_text` (schema comment: "Stored so a future
 *      model upgrade can re-embed without re-reading manager's S3 artifact").
 *   - `video_transcript_chunk.text`.
 * So re-embedding existing text needs no artifact re-read, no ingest
 * contract, and no apps/mastra changes — read the text, embed it via the
 * U1 gateway path, write the new column.
 *
 * Usage:
 *   DATABASE_URL='postgresql://forge:forge@db:5432/forge_admin' \
 *   AI_GATEWAY_EMBEDDINGS_BASE_URL=... \
 *   AI_GATEWAY_EMBEDDINGS_API_KEY=... \
 *   AI_GATEWAY_EMBEDDINGS_MODEL=... \
 *   pnpm --filter @forge/admin backfill-qwen-video-embeddings
 *
 *   # Filters (all optional):
 *   --table=scene|transcript|both   # default `both`
 *   --batch-size=N                  # default 64; rows embedded per gateway call
 *   --limit=N                       # cap total rows processed per table
 *   --core-id=<id>                  # repeatable; restrict to specific videos
 *                                   # (JOINs through to video.core_id)
 *
 * RESUMABLE + IDEMPOTENT: only rows WHERE the text column IS NOT NULL AND
 * `embedding_qwen` IS NULL are processed, ordered by id. A failed batch
 * leaves its rows NULL, so a re-run retries them. Live `embedding` column
 * is NEVER written by this path.
 *
 * Structured stdout/stderr events (single grep target):
 *   stdout:
 *     - `backfill-qwen.start`    — startup config (table, batchSize, limit)
 *     - `backfill-qwen.batch`    — periodic running totals (done, failed)
 *     - `backfill-qwen.complete` — per-table final (succeeded, failed, durationMs)
 *   stderr:
 *     - `backfill-qwen.error`       — per failed batch (table, idRange)
 *     - `backfill-qwen.interrupted` — SIGINT/SIGTERM received
 *     - `backfill-qwen.fatal`       — unhandled error in main()
 *
 * NOT run against prod by default — operator must set DATABASE_URL
 * explicitly. Mirrors run-embeds.ts / run-sync.ts posture; no in-script
 * prod-URL guard beyond the explicit env var.
 */

import { Prisma, type PrismaClient } from "@prisma/client"
import { toPgVector } from "@/db/pgvector"
import type { EmbeddingSource } from "@/services/embeddings.service"

export type QwenBackfillTable = "scene" | "transcript" | "both"

const DEFAULT_BATCH_SIZE = 64

/**
 * One re-embeddable row: the id of the row to update and the text to embed.
 */
export type QwenBackfillRow = {
  id: string
  text: string
}

/**
 * Per-table configuration. Each entry pins the physical table, the text
 * column to read, and the core-id JOIN fragment so the SQL builders stay
 * DRY across scene + transcript.
 */
type TableConfig = {
  /** Physical table name (also the logical key in logs). */
  table: string
  /** Text column whose verbatim contents get re-embedded. */
  textColumn: string
  /**
   * JOIN chain from the target table (aliased `t`) to `video` (aliased
   * `v`) so a `--core-id` filter can constrain by `v.core_id`. Empty when
   * no core-id filter is requested.
   */
  coreIdJoin: Prisma.Sql
}

const SCENE_CONFIG = {
  table: "video_scene_locale",
  textColumn: "source_text",
  coreIdJoin: Prisma.sql`JOIN "video_scene" vs ON vs."id" = t."video_scene_id" JOIN "video" v ON v."id" = vs."video_id"`,
} as const satisfies TableConfig

const TRANSCRIPT_CONFIG = {
  table: "video_transcript_chunk",
  textColumn: "text",
  coreIdJoin: Prisma.sql`JOIN "video_transcript" vt ON vt."id" = t."transcript_id" JOIN "video" v ON v."id" = vt."video_id"`,
} as const satisfies TableConfig

/**
 * The two tables this script backfills, in run order. Exported for tests.
 */
export const QWEN_BACKFILL_CONFIGS: Readonly<
  Record<"scene" | "transcript", TableConfig>
> = {
  scene: SCENE_CONFIG,
  transcript: TRANSCRIPT_CONFIG,
}

/**
 * Minimal Prisma surface this script needs. Narrowed so unit tests can
 * supply a mock without standing up a full PrismaClient.
 */
export type QwenBackfillPrisma = Pick<
  PrismaClient,
  "$queryRaw" | "$executeRaw" | "$transaction"
>

/**
 * The batched embedder. Matches `generateExperienceEmbeddings`'s shape but
 * narrowed to what this script consumes, so tests can inject a stub.
 */
export type QwenBatchEmbedder = (
  inputs: readonly string[],
  opts: { source: EmbeddingSource },
) => Promise<{ embeddings: number[][] }>

export type QwenBackfillTableReport = {
  table: string
  succeeded: number
  failed: number
  durationMs: number
}

function isBlank(text: string): boolean {
  return text.trim().length === 0
}

/**
 * Fetch one page of re-embeddable rows: text column NOT NULL AND
 * `embedding_qwen` IS NULL, ordered by id ascending, capped at `take`.
 * When `coreIds` is non-empty, JOINs through to `video.core_id` and
 * filters by it.
 *
 * The text column and JOIN are interpolated from the closed
 * per-table config allowlist (never user input); `coreIds`, `lastId`,
 * and `take` are bound parameters.
 *
 * Exported for tests — asserts the WHERE shape (resumability invariant).
 */
export async function fetchQwenBackfillPage(args: {
  prisma: QwenBackfillPrisma
  config: TableConfig
  coreIds: readonly string[]
  lastId: string | null
  take: number
}): Promise<QwenBackfillRow[]> {
  const { prisma, config, coreIds, lastId, take } = args
  const textCol = Prisma.raw(`t."${config.textColumn}"`)
  const join = coreIds.length > 0 ? config.coreIdJoin : Prisma.empty
  const coreFilter =
    coreIds.length > 0
      ? Prisma.sql`AND v."core_id" IN (${Prisma.join(coreIds)})`
      : Prisma.empty
  const afterId =
    lastId !== null ? Prisma.sql`AND t."id" > ${lastId}` : Prisma.empty

  return prisma.$queryRaw<QwenBackfillRow[]>(Prisma.sql`
    SELECT t."id" AS "id", ${textCol} AS "text"
    FROM ${Prisma.raw(`"${config.table}"`)} t
    ${join}
    WHERE ${textCol} IS NOT NULL
      AND t."embedding_qwen" IS NULL
      ${coreFilter}
      ${afterId}
    ORDER BY t."id" ASC
    LIMIT ${take}
  `)
}

/**
 * Write one batch's vectors into `embedding_qwen` via per-row
 * `$executeRaw` casts inside a single `$transaction`. Per-row `::vector`
 * cast only — NOT the `::vector[]` array-parameter form (CLAUDE.md warns
 * that parser is less-trodden).
 *
 * Caller guarantees `rows.length === embeddings.length`. Exported for
 * tests — asserts the SQL targets `embedding_qwen` (NOT `embedding`).
 */
export async function writeQwenBatch(args: {
  prisma: QwenBackfillPrisma
  config: TableConfig
  rows: readonly QwenBackfillRow[]
  embeddings: readonly number[][]
}): Promise<void> {
  const { prisma, config, rows, embeddings } = args
  const tableIdent = Prisma.raw(`"${config.table}"`)
  await prisma.$transaction(
    rows.map((row, i) => {
      const vec = toPgVector(embeddings[i]!)
      return prisma.$executeRaw(Prisma.sql`
        UPDATE ${tableIdent}
        SET "embedding_qwen" = ${vec}::vector
        WHERE "id" = ${row.id}
      `)
    }),
  )
}

export type QwenBackfillLogger = {
  stdout: (line: string) => void
  stderr: (line: string) => void
}

const defaultLogger: QwenBackfillLogger = {
  stdout: (line) => process.stdout.write(line),
  stderr: (line) => process.stderr.write(line),
}

/**
 * Backfill one table: page through re-embeddable rows, embed each batch
 * via the gateway, write the vectors into `embedding_qwen`. Per-batch
 * error isolation — a failed batch logs, increments the failure counter,
 * and continues to the next batch. Because failed rows stay NULL, a
 * re-run retries them.
 */
export async function backfillQwenTable(args: {
  prisma: QwenBackfillPrisma
  embed: QwenBatchEmbedder
  config: TableConfig
  coreIds: readonly string[]
  batchSize: number
  limit?: number
  logger?: QwenBackfillLogger
}): Promise<QwenBackfillTableReport> {
  const {
    prisma,
    embed,
    config,
    coreIds,
    batchSize,
    limit,
    logger = defaultLogger,
  } = args
  const startedAt = Date.now()

  let succeeded = 0
  let failed = 0
  let processed = 0
  let batchCount = 0
  let lastId: string | null = null

  for (;;) {
    if (limit !== undefined && processed >= limit) break
    const remaining = limit === undefined ? batchSize : limit - processed
    const take = Math.min(batchSize, remaining)
    if (take <= 0) break

    const page = await fetchQwenBackfillPage({
      prisma,
      config,
      coreIds,
      lastId,
      take,
    })
    if (page.length === 0) break

    // Advance the cursor regardless of embed outcome so a failed batch
    // does not loop forever (failed rows stay NULL and are retried on a
    // fresh run, not within this run).
    lastId = page[page.length - 1]!.id
    processed += page.length
    batchCount += 1

    // Skip blank/whitespace-only rows — the embedder rejects empty input.
    // Log + skip, don't abort the batch.
    const embeddable = page.filter((row) => !isBlank(row.text))
    const skipped = page.length - embeddable.length
    if (skipped > 0) {
      logger.stdout(
        JSON.stringify({
          event: "backfill-qwen.skip_blank",
          table: config.table,
          skipped,
        }) + "\n",
      )
    }
    if (embeddable.length === 0) {
      continue
    }

    try {
      const { embeddings } = await embed(
        embeddable.map((row) => row.text),
        { source: "gateway" },
      )
      if (embeddings.length !== embeddable.length) {
        throw new Error(
          `embedder returned ${embeddings.length} vectors for ${embeddable.length} inputs`,
        )
      }
      await writeQwenBatch({
        prisma,
        config,
        rows: embeddable,
        embeddings,
      })
      succeeded += embeddable.length
    } catch (err) {
      failed += embeddable.length
      logger.stderr(
        JSON.stringify({
          event: "backfill-qwen.error",
          table: config.table,
          idRange: {
            from: embeddable[0]!.id,
            to: embeddable[embeddable.length - 1]!.id,
          },
          rows: embeddable.length,
          error: err instanceof Error ? err.message : String(err),
        }) + "\n",
      )
    }

    if (batchCount % 10 === 0) {
      logger.stdout(
        JSON.stringify({
          event: "backfill-qwen.batch",
          table: config.table,
          done: succeeded,
          failed,
        }) + "\n",
      )
    }
  }

  const report: QwenBackfillTableReport = {
    table: config.table,
    succeeded,
    failed,
    durationMs: Date.now() - startedAt,
  }
  logger.stdout(
    JSON.stringify({
      event: "backfill-qwen.complete",
      ...report,
    }) + "\n",
  )
  return report
}

function parseSingle(name: string): string | undefined {
  const flag = `--${name}=`
  const arg = process.argv.find((a) => a.startsWith(flag))
  return arg ? arg.slice(flag.length) : undefined
}

function parseRepeated(name: string): string[] {
  const flag = `--${name}=`
  return process.argv
    .filter((a) => a.startsWith(flag))
    .map((a) => a.slice(flag.length))
    .filter((v) => v.length > 0)
}

function isTable(v: string): v is QwenBackfillTable {
  return v === "scene" || v === "transcript" || v === "both"
}

/**
 * Parse `--batch-size` / `--limit` to a positive integer or throw. Shared
 * so both CLI numeric flags get identical validation.
 */
export function parsePositiveInt(
  raw: string | undefined,
  flag: string,
): number | undefined {
  if (raw === undefined) return undefined
  const n = Number(raw)
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`${flag} must be a positive integer; got "${raw}"`)
  }
  return n
}

async function main(): Promise<void> {
  const tableArg = parseSingle("table") ?? "both"
  if (!isTable(tableArg)) {
    process.stderr.write(
      `[backfill-qwen] invalid --table=${tableArg}; expected scene|transcript|both\n`,
    )
    process.exit(2)
  }

  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    process.stderr.write("[backfill-qwen] DATABASE_URL is required\n")
    process.exit(2)
  }

  let batchSize: number
  let limit: number | undefined
  try {
    batchSize =
      parsePositiveInt(parseSingle("batch-size"), "--batch-size") ??
      DEFAULT_BATCH_SIZE
    limit = parsePositiveInt(parseSingle("limit"), "--limit")
  } catch (err) {
    process.stderr.write(
      `[backfill-qwen] ${err instanceof Error ? err.message : String(err)}\n`,
    )
    process.exit(2)
    return
  }

  const coreIds = parseRepeated("core-id")

  // Lazy-import AFTER the DATABASE_URL guard so a missing var produces our
  // friendly stderr line instead of zod's crash on the transitive
  // `@/config/env` import (mirrors run-embeds.ts). The embedder import
  // also validates the AI_GATEWAY_EMBEDDINGS_* env via @/config/env.
  const { prisma } = await import("@/db/client")
  const { generateExperienceEmbeddings } =
    await import("@/services/embeddings.service")

  const tables: ("scene" | "transcript")[] =
    tableArg === "both" ? ["scene", "transcript"] : [tableArg]

  process.stdout.write(
    JSON.stringify({
      event: "backfill-qwen.start",
      databaseUrl: databaseUrl.replace(/:\/\/[^@]+@/, "://***:***@"),
      tables,
      batchSize,
      limit: limit ?? null,
      coreIds: coreIds.length > 0 ? coreIds : null,
    }) + "\n",
  )

  let interrupted = false
  const onSignal = (signal: NodeJS.Signals) => {
    if (interrupted) return
    interrupted = true
    process.stderr.write(
      JSON.stringify({ event: "backfill-qwen.interrupted", signal }) + "\n",
    )
    void prisma.$disconnect().finally(() => process.exit(130))
  }
  process.once("SIGINT", onSignal)
  process.once("SIGTERM", onSignal)

  let totalFailed = 0
  try {
    for (const table of tables) {
      const report = await backfillQwenTable({
        prisma,
        embed: generateExperienceEmbeddings,
        config: QWEN_BACKFILL_CONFIGS[table],
        coreIds,
        batchSize,
        limit,
      })
      totalFailed += report.failed
    }
  } finally {
    process.off("SIGINT", onSignal)
    process.off("SIGTERM", onSignal)
    await prisma.$disconnect()
  }

  if (totalFailed > 0) {
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
        event: "backfill-qwen.fatal",
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      }) + "\n",
    )
    process.exit(1)
  })
}
