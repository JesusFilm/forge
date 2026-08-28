/* eslint-disable max-lines -- keeps the copy transaction and its reconciliation contract auditable in one operator script */
import { createHash } from "node:crypto"
import { mkdir, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import { PrismaClient } from "../src/generated/prisma/index.js"
import { insertCorpusBatch } from "../src/indexing/copy-corpus-batch.js"

const DEFAULT_REPORT = fileURLToPath(
  new URL(
    "../../../docs/roadmap/rag/evidence/feat-429/local-copy-reconciliation.json",
    import.meta.url,
  ),
)
const PRODUCTION_REPORT = fileURLToPath(
  new URL(
    "../../../docs/roadmap/rag/evidence/feat-430/production-copy-reconciliation.json",
    import.meta.url,
  ),
)
const RETRIEVAL_SCORE_TOLERANCE = 1e-5
const REQUIRED_TABLES = [
  "sources",
  "documents",
  "chunks",
  "chunk_embeddings",
  "http_cache",
  "robots_cache",
  "raw_documents",
] as const

const COPY_INDEXES = [
  [
    "documents_source_idx",
    `CREATE INDEX IF NOT EXISTS "documents_source_idx" ON "documents"("source_id")`,
  ],
  [
    "chunks_source_idx",
    `CREATE INDEX IF NOT EXISTS "chunks_source_idx" ON "chunks"("source_id")`,
  ],
  [
    "chunks_document_idx",
    `CREATE INDEX IF NOT EXISTS "chunks_document_idx" ON "chunks"("document_id")`,
  ],
  [
    "chunks_tags_gin",
    `CREATE INDEX IF NOT EXISTS "chunks_tags_gin" ON "chunks" USING GIN ("tags")`,
  ],
  [
    "chunks_search_tsv_gin",
    `CREATE INDEX IF NOT EXISTS "chunks_search_tsv_gin" ON "chunks" USING GIN ("search_tsv")`,
  ],
  [
    "chunk_embeddings_hnsw",
    `CREATE INDEX IF NOT EXISTS "chunk_embeddings_hnsw" ON "chunk_embeddings" USING hnsw ("embedding" halfvec_cosine_ops)`,
  ],
  [
    "chunk_embeddings_model_idx",
    `CREATE INDEX IF NOT EXISTS "chunk_embeddings_model_idx" ON "chunk_embeddings"("embedding_model")`,
  ],
  [
    "raw_documents_source_key_idx",
    `CREATE INDEX IF NOT EXISTS "raw_documents_source_key_idx" ON "raw_documents"("source_key")`,
  ],
  [
    "raw_documents_ingested_at_idx",
    `CREATE INDEX IF NOT EXISTS "raw_documents_ingested_at_idx" ON "raw_documents"("ingested_at")`,
  ],
] as const

type TableName = (typeof REQUIRED_TABLES)[number]
type JsonRow = { cursor: string; data: unknown }

type CopyOptions = {
  dryRun: boolean
  verifyOnly: boolean
  resume: boolean
  sourceEnv: string
  targetEnv: string
  batchSize: number
  maxBatches: number | null
  reportPath: string
  production: boolean
  expectedTargetHostHash: string | null
  sourceSnapshotReference: string | null
  sourceCutoff: string | null
}

type SafeReport = {
  schemaVersion: number
  status: "dry-run" | "paused" | "equivalent" | "mismatch"
  source: { database: string; hostHash: string }
  target: { database: string; hostHash: string }
  copiedRows: Partial<Record<TableName, number>>
  operation: {
    mode: "local" | "production"
    sourceSnapshotReference: string | null
    sourceCutoff: string | null
  }
  reconciliation: unknown
}

type TableSpec = {
  name: TableName
  cursor: string
  cursorType: "uuid" | "text"
  columns: readonly string[]
}

const TABLES: readonly TableSpec[] = [
  {
    name: "sources",
    cursor: "id",
    cursorType: "uuid",
    columns: [
      "id",
      "key",
      "name",
      "domain",
      "trust",
      "ingestion_mode",
      "languages",
      "default_tags",
      "default_category",
      "rights",
      "content_hash",
      "indexed_at",
      "created_at",
      "updated_at",
    ],
  },
  {
    name: "documents",
    cursor: "id",
    cursorType: "uuid",
    columns: [
      "id",
      "source_id",
      "canonical_url",
      "url",
      "title",
      "language",
      "category",
      "content_hash",
      "chunk_count",
      "first_seen",
      "last_seen",
      "indexed_at",
    ],
  },
  {
    name: "chunks",
    cursor: "id",
    cursorType: "uuid",
    columns: [
      "id",
      "document_id",
      "source_id",
      "ord",
      "text",
      "char_start",
      "char_end",
      "token_count",
      "tags",
      "created_at",
    ],
  },
  {
    name: "chunk_embeddings",
    cursor: "chunk_id",
    cursorType: "uuid",
    columns: ["chunk_id", "embedding", "embedding_model", "embedded_at"],
  },
  {
    name: "http_cache",
    cursor: "url",
    cursorType: "text",
    columns: [
      "url",
      "etag",
      "last_modified",
      "body_hash",
      "status_code",
      "fetched_at",
      "updated_at",
    ],
  },
  {
    name: "robots_cache",
    cursor: "robots_url",
    cursorType: "text",
    columns: ["robots_url", "body", "status_code", "fetched_at", "updated_at"],
  },
  {
    name: "raw_documents",
    cursor: "id",
    cursorType: "uuid",
    columns: [
      "id",
      "source_key",
      "url",
      "canonical_url",
      "title",
      "raw_content",
      "status",
      "body_hash",
      "etag",
      "last_modified",
      "fetched_at",
      "not_modified",
      "ingested_at",
    ],
  },
] as const

export class MigrationUsageError extends Error {
  override readonly name = "MigrationUsageError"
}

const positiveInteger = (flag: string, value: string | undefined): number => {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1)
    throw new MigrationUsageError(`${flag} requires a positive integer`)
  return parsed
}

export function parseCorpusCopyArgs(argv: string[]): CopyOptions {
  const options: CopyOptions = {
    dryRun: true,
    verifyOnly: false,
    resume: false,
    sourceEnv: "JFRAG_SOURCE_DATABASE_URL",
    targetEnv: "DATABASE_URL",
    batchSize: 250,
    maxBatches: null,
    reportPath: DEFAULT_REPORT,
    production: false,
    expectedTargetHostHash: null,
    sourceSnapshotReference: null,
    sourceCutoff: null,
  }
  let localConfirmed = false
  let reportOverridden = false
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--copy") options.dryRun = false
    else if (arg === "--verify-only") {
      options.dryRun = false
      options.verifyOnly = true
    } else if (arg === "--confirm-local-copy") localConfirmed = true
    else if (arg === "--confirm-production-copy") {
      options.production = true
    } else if (arg === "--expected-target-host-hash")
      options.expectedTargetHostHash = argv[++index] ?? ""
    else if (arg === "--source-snapshot-reference")
      options.sourceSnapshotReference = argv[++index] ?? ""
    else if (arg === "--source-cutoff") {
      const value = argv[++index] ?? ""
      const parsed = new Date(value)
      if (!value || Number.isNaN(parsed.valueOf()))
        throw new MigrationUsageError(
          "--source-cutoff requires an ISO-8601 timestamp",
        )
      options.sourceCutoff = parsed.toISOString()
    } else if (arg === "--resume") options.resume = true
    else if (arg === "--source-env") options.sourceEnv = argv[++index] ?? ""
    else if (arg === "--target-env") options.targetEnv = argv[++index] ?? ""
    else if (arg === "--batch-size")
      options.batchSize = positiveInteger(arg, argv[++index])
    else if (arg === "--max-batches")
      options.maxBatches = positiveInteger(arg, argv[++index])
    else if (arg === "--report") {
      options.reportPath = argv[++index] ?? ""
      reportOverridden = true
    } else
      throw new MigrationUsageError(
        `Unknown argument ${arg}; database URLs must be supplied through named environment variables`,
      )
  }
  if (!options.sourceEnv || !options.targetEnv || !options.reportPath)
    throw new MigrationUsageError(
      "Environment variable names and report path cannot be empty",
    )
  if (localConfirmed && options.production)
    throw new MigrationUsageError(
      "Choose exactly one local or production copy acknowledgement",
    )
  if (
    !options.dryRun &&
    !options.verifyOnly &&
    !localConfirmed &&
    !options.production
  )
    throw new MigrationUsageError("--copy requires --confirm-local-copy")
  if (options.production) {
    if (!/^[a-f0-9]{16}$/.test(options.expectedTargetHostHash ?? ""))
      throw new MigrationUsageError(
        "Production mode requires --expected-target-host-hash from a read-only preflight",
      )
    if (!options.sourceSnapshotReference)
      throw new MigrationUsageError(
        "Production mode requires a recoverable source snapshot reference",
      )
    if (!options.sourceCutoff)
      throw new MigrationUsageError(
        "Production mode requires a recorded source cutoff",
      )
    if (!reportOverridden) options.reportPath = PRODUCTION_REPORT
  }
  return options
}

export function serializeReport(report: SafeReport): string {
  const output = `${JSON.stringify(
    report,
    (_key, value: unknown) =>
      typeof value === "bigint" ? value.toString() : value,
    2,
  )}\n`
  if (
    /postgres(?:ql)?:\/\//i.test(output) ||
    /"(?:raw_content|text)"\s*:/i.test(output)
  )
    throw new Error("Refusing to serialize credentials or corpus text")
  return output
}

const quote = (identifier: string): string => `"${identifier}"`

async function databaseIdentity(db: PrismaClient) {
  const [{ database, address, port }] = await db.$queryRawUnsafe<
    Array<{ database: string; address: string | null; port: number | null }>
  >(
    `SELECT current_database() AS database,
            inet_server_addr()::text AS address,
            inet_server_port() AS port`,
  )
  return {
    database,
    hostHash: createHash("sha256")
      .update(`${address ?? "local-socket"}:${port ?? "local-socket"}`)
      .digest("hex")
      .slice(0, 16),
  }
}

async function tableCounts(db: PrismaClient) {
  const entries = await Promise.all(
    REQUIRED_TABLES.map(async (table) => {
      const [{ count }] = await db.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT count(*) AS count FROM ${quote(table)}`,
      )
      return [table, Number(count)] as const
    }),
  )
  return Object.fromEntries(entries) as Record<TableName, number>
}

async function preflight(db: PrismaClient): Promise<void> {
  const rows = await db.$queryRawUnsafe<Array<{ table_name: string }>>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
    [...REQUIRED_TABLES],
  )
  const present = new Set(rows.map(({ table_name }) => table_name))
  const missing = REQUIRED_TABLES.filter((table) => !present.has(table))
  if (missing.length > 0)
    throw new Error(
      `Database is missing required tables: ${missing.join(", ")}`,
    )
}

async function copyTable(
  source: PrismaClient,
  target: PrismaClient,
  spec: TableSpec,
  options: CopyOptions,
  batchBudget: { remaining: number | null },
  initialCursor: string | null,
): Promise<{ copied: number; paused: boolean }> {
  let cursor = initialCursor
  let copied = 0
  for (;;) {
    if (batchBudget.remaining === 0) return { copied, paused: true }
    const rows = await source.$queryRawUnsafe<JsonRow[]>(
      `SELECT ${quote(spec.cursor)}::text AS cursor,
              to_jsonb(t) - 'search_tsv' AS data
       FROM ${quote(spec.name)} t
       WHERE $1::${spec.cursorType} IS NULL
          OR ${quote(spec.cursor)} > $1::${spec.cursorType}
       ORDER BY ${quote(spec.cursor)}
       LIMIT $2`,
      cursor,
      options.batchSize,
    )
    if (rows.length === 0) return { copied, paused: false }
    await insertCorpusBatch(
      target,
      spec.name,
      spec.cursor,
      spec.columns,
      rows.map(({ data }) => data),
    )
    copied += rows.length
    cursor = rows.at(-1)?.cursor ?? cursor
    if (batchBudget.remaining !== null) batchBudget.remaining -= 1
  }
}

async function resumeCursor(
  source: PrismaClient,
  target: PrismaClient,
  spec: TableSpec,
): Promise<string | null> {
  const [{ cursor, count }] = await target.$queryRawUnsafe<
    Array<{ cursor: string | null; count: bigint }>
  >(
    `SELECT
       (SELECT ${quote(spec.cursor)}::text FROM ${quote(spec.name)}
        ORDER BY ${quote(spec.cursor)} DESC LIMIT 1) AS cursor,
       count(*) AS count
     FROM ${quote(spec.name)}`,
  )
  if (!cursor) return null
  const [{ sourcePrefix }] = await source.$queryRawUnsafe<
    Array<{ sourcePrefix: bigint }>
  >(
    `SELECT count(*) AS "sourcePrefix" FROM ${quote(spec.name)}
     WHERE ${quote(spec.cursor)} <= $1::${spec.cursorType}`,
    cursor,
  )
  if (sourcePrefix !== count)
    throw new MigrationUsageError(
      `Target ${spec.name} rows are not a resumable source prefix`,
    )
  return cursor
}

async function setCopyIndexes(
  db: PrismaClient,
  present: boolean,
): Promise<void> {
  if (present) {
    for (const [, definition] of COPY_INDEXES)
      await db.$executeRawUnsafe(definition)
    return
  }
  for (const [name] of COPY_INDEXES)
    await db.$executeRawUnsafe(`DROP INDEX IF EXISTS ${quote(name)}`)
}

async function aggregateFacts(db: PrismaClient) {
  const counts = await tableCounts(db)
  const bySourceLanguage = await db.$queryRawUnsafe(
    `SELECT s.key AS source_key, d.language, count(DISTINCT d.id)::text AS documents,
            count(DISTINCT c.id)::text AS chunks
     FROM sources s LEFT JOIN documents d ON d.source_id = s.id
     LEFT JOIN chunks c ON c.document_id = d.id
     GROUP BY s.key, d.language ORDER BY s.key, d.language NULLS FIRST`,
  )
  const models = await db.$queryRawUnsafe(
    `SELECT embedding_model, vector_dims(embedding)::int AS dimensions, count(*)::text AS count
     FROM chunk_embeddings GROUP BY embedding_model, vector_dims(embedding)
     ORDER BY embedding_model, dimensions`,
  )
  const indexes = await db.$queryRawUnsafe<Array<{ indexname: string }>>(
    `SELECT indexname FROM pg_indexes
     WHERE schemaname = current_schema() AND indexname = ANY($1::text[])
     ORDER BY indexname`,
    COPY_INDEXES.map(([name]) => name),
  )
  const integrity = await db.$queryRawUnsafe<Array<Record<string, string>>>(
    `SELECT
      (SELECT count(*)::text FROM documents d LEFT JOIN sources s ON s.id=d.source_id WHERE s.id IS NULL) AS orphan_documents,
      (SELECT count(*)::text FROM chunks c LEFT JOIN documents d ON d.id=c.document_id WHERE d.id IS NULL) AS orphan_chunks,
      (SELECT count(*)::text FROM chunks c LEFT JOIN sources s ON s.id=c.source_id WHERE s.id IS NULL) AS orphan_chunk_sources,
      (SELECT count(*)::text FROM chunk_embeddings e LEFT JOIN chunks c ON c.id=e.chunk_id WHERE c.id IS NULL) AS orphan_embeddings,
      (SELECT count(*)::text FROM chunk_embeddings WHERE embedding IS NULL OR embedding_model IS NULL) AS null_embeddings`,
  )
  const fingerprints = Object.fromEntries(
    await Promise.all(
      TABLES.map(async (spec) => {
        const [{ fingerprint }] = await db.$queryRawUnsafe<
          Array<{ fingerprint: string }>
        >(
          `SELECT coalesce(sum(hashtextextended((to_jsonb(t) - 'search_tsv')::text, 0)::numeric), 0)::text AS fingerprint
           FROM ${quote(spec.name)} t`,
        )
        return [spec.name, fingerprint] as const
      }),
    ),
  )
  return {
    counts,
    bySourceLanguage,
    models,
    indexes: indexes.map(({ indexname }) => indexname),
    integrity: integrity[0],
    fingerprints,
  }
}

async function retrievalProbes(db: PrismaClient) {
  const probes = await db.$queryRawUnsafe<
    Array<{ chunk_id: string; embedding: string }>
  >(
    `SELECT chunk_id::text, embedding::text FROM chunk_embeddings ORDER BY chunk_id LIMIT 5`,
  )
  const results = []
  for (const probe of probes) {
    const hits = await db.$queryRawUnsafe<
      Array<{ chunk_id: string; score: number }>
    >(
      `SELECT chunk_id::text, (1 - (embedding <=> $1::halfvec))::float8 AS score
       FROM chunk_embeddings ORDER BY embedding <=> $1::halfvec, chunk_id LIMIT 10`,
      probe.embedding,
    )
    results.push({ probeId: probe.chunk_id, hits })
  }
  return results
}

const equivalentJson = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) === JSON.stringify(right)

type RetrievalProbe = Awaited<ReturnType<typeof retrievalProbes>>[number]

export function retrievalEquivalent(
  source: RetrievalProbe[],
  target: RetrievalProbe[],
): boolean {
  return (
    source.length > 0 &&
    source.length === target.length &&
    source.every((probe, probeIndex) => {
      const candidate = target[probeIndex]
      return (
        candidate?.probeId === probe.probeId &&
        candidate.hits.length === probe.hits.length &&
        probe.hits.every((hit, hitIndex) => {
          const targetHit = candidate.hits[hitIndex]
          return (
            targetHit?.chunk_id === hit.chunk_id &&
            Math.abs(targetHit.score - hit.score) <= RETRIEVAL_SCORE_TOLERANCE
          )
        })
      )
    })
  )
}

function reportStatus(
  dryRun: boolean,
  paused: boolean,
  equivalent: boolean,
): SafeReport["status"] {
  if (dryRun) return "dry-run"
  if (paused) return "paused"
  return equivalent ? "equivalent" : "mismatch"
}

async function run(options: CopyOptions): Promise<SafeReport> {
  const sourceUrl = process.env[options.sourceEnv]
  const targetUrl = process.env[options.targetEnv]
  if (!sourceUrl || !targetUrl)
    throw new MigrationUsageError(
      `${options.sourceEnv} and ${options.targetEnv} must both be set`,
    )
  if (sourceUrl === targetUrl)
    throw new MigrationUsageError("Source and target databases must differ")

  const readOnlySourceUrl = new URL(sourceUrl)
  const existingOptions = readOnlySourceUrl.searchParams.get("options")
  readOnlySourceUrl.searchParams.set(
    "options",
    [existingOptions, "-c default_transaction_read_only=on"]
      .filter(Boolean)
      .join(" "),
  )
  const source = new PrismaClient({ datasourceUrl: readOnlySourceUrl.href })
  const target = new PrismaClient({ datasourceUrl: targetUrl })
  try {
    await Promise.all([source.$connect(), target.$connect()])
    await Promise.all([preflight(source), preflight(target)])
    const [sourceIdentity, targetIdentity, sourceBefore, targetBefore] =
      await Promise.all([
        databaseIdentity(source),
        databaseIdentity(target),
        tableCounts(source),
        tableCounts(target),
      ])
    if (
      sourceIdentity.database === targetIdentity.database &&
      sourceIdentity.hostHash === targetIdentity.hostHash
    )
      throw new MigrationUsageError(
        "Source and target resolve to the same database",
      )
    if (
      options.production &&
      targetIdentity.hostHash !== options.expectedTargetHostHash
    )
      throw new MigrationUsageError(
        "Production target identity does not match --expected-target-host-hash",
      )
    if (
      !options.dryRun &&
      !options.verifyOnly &&
      !options.resume &&
      Object.values(targetBefore).some((count) => count !== 0)
    )
      throw new MigrationUsageError(
        "Target is not empty; use --resume only for an interrupted copy",
      )

    const copiedRows: Partial<Record<TableName, number>> = {}
    let paused = false
    const copyRequired = REQUIRED_TABLES.some(
      (table) => sourceBefore[table] !== targetBefore[table],
    )
    if (!options.dryRun && !options.verifyOnly && copyRequired) {
      const budget = { remaining: options.maxBatches }
      try {
        await setCopyIndexes(target, false)
        for (const spec of TABLES) {
          const initialCursor = options.resume
            ? await resumeCursor(source, target, spec)
            : null
          const result = await copyTable(
            source,
            target,
            spec,
            options,
            budget,
            initialCursor,
          )
          copiedRows[spec.name] = result.copied
          if (result.paused) {
            paused = true
            break
          }
        }
      } finally {
        await setCopyIndexes(target, true)
      }
    } else if (!options.dryRun && !options.verifyOnly && options.resume) {
      await setCopyIndexes(target, true)
    }

    const [sourceFacts, targetFacts] = await Promise.all([
      aggregateFacts(source),
      aggregateFacts(target),
    ])
    const [sourceRetrieval, targetRetrieval] =
      options.dryRun || paused
        ? [[], []]
        : await Promise.all([retrievalProbes(source), retrievalProbes(target)])
    const factsEquivalent = equivalentJson(sourceFacts, targetFacts)
    const retrievalMatches = retrievalEquivalent(
      sourceRetrieval,
      targetRetrieval,
    )
    const equivalent = factsEquivalent && retrievalMatches
    return {
      schemaVersion: 1,
      status: reportStatus(options.dryRun, paused, equivalent),
      source: sourceIdentity,
      target: targetIdentity,
      copiedRows,
      operation: {
        mode: options.production ? "production" : "local",
        sourceSnapshotReference: options.sourceSnapshotReference,
        sourceCutoff: options.sourceCutoff,
      },
      reconciliation: {
        equivalent,
        factsEquivalent,
        retrievalEquivalent: retrievalMatches,
        source: sourceFacts,
        target: targetFacts,
        retrieval: {
          scoreTolerance: RETRIEVAL_SCORE_TOLERANCE,
          source: sourceRetrieval,
          target: targetRetrieval,
        },
        embeddingCalls: 0,
      },
    }
  } finally {
    await Promise.allSettled([source.$disconnect(), target.$disconnect()])
  }
}

async function main(): Promise<void> {
  const options = parseCorpusCopyArgs(process.argv.slice(2))
  const report = await run(options)
  await mkdir(dirname(options.reportPath), { recursive: true })
  await writeFile(options.reportPath, serializeReport(report), { mode: 0o600 })
  console.log(
    `Corpus copy ${report.status}; redacted report: ${options.reportPath}`,
  )
  if (report.status === "mismatch") process.exitCode = 1
  if (report.status === "paused") process.exitCode = 2
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Corpus copy failed")
    process.exitCode = 1
  })
}
