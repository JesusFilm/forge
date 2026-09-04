/* eslint-disable max-lines -- keeps the promotion transaction and its reconciliation contract auditable together */
import { Prisma, type PrismaClient } from "../../src/generated/prisma/index.js"

import { RagOperationalError } from "../../src/contracts/index.js"

export type RawDocumentPromotionArgs = {
  source: string
  apply: boolean
  batchSize: number
  expectedRows?: number
  expectedDigest?: string
}

export type RawDocumentPromotionEnvironment = {
  sourceUrl: string
  targetUrl: string
}

export type PromotionStats = {
  totalRows: number
  latestRows: number
  pendingRows: number
  digest: string | null
}

export type PromotionRow = {
  sourceKey: string
  url: string
  canonicalUrl: string
  title: string | null
  rawContent: string
  status: number | null
  bodyHash: string | null
  etag: string | null
  lastModified: string | null
  fetchedAt: Date
  notModified: boolean
}

export type PromotionReader = {
  stats(sourceKey: string): Promise<PromotionStats>
  latestBatch(
    sourceKey: string,
    afterCanonicalUrl: string | null,
    limit: number,
  ): Promise<PromotionRow[]>
}

export type PromotionWriter = PromotionReader & {
  insertPending(rows: readonly PromotionRow[]): Promise<void>
}

export type PromotionTarget = PromotionReader & {
  atomic<T>(operation: (writer: PromotionWriter) => Promise<T>): Promise<T>
}

export type RawDocumentPromotionSummary = {
  dryRun: boolean
  source: string
  rows: number
  digest: string
  batches: number
  mutation: boolean
}

export const PROMOTION_TRANSACTION_OPTIONS = {
  maxWait: 10_000,
  timeout: 600_000,
  isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
} as const

const invalidArgument = (message: string): RagOperationalError =>
  new RagOperationalError("argument_invalid", message)

export function rawDocumentPromotionErrorMessage(error: unknown): string {
  return error instanceof RagOperationalError
    ? error.message
    : "raw-document promotion failed (details redacted)"
}

const valueAfter = (argv: string[], index: number): string => {
  const value = argv[index + 1]
  if (!value || value.startsWith("--"))
    throw invalidArgument(`${argv[index]} requires a value`)
  return value
}

export function parseRawDocumentPromotionArgs(
  argv: string[],
): RawDocumentPromotionArgs {
  let source: string | undefined
  let batchSize = 100
  let apply = false
  let expectedRows: number | undefined
  let expectedDigest: string | undefined
  const seen = new Set<string>()
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (seen.has(arg))
      throw invalidArgument(`${arg} may only be specified once`)
    seen.add(arg)
    if (arg === "--source") source = valueAfter(argv, index++)
    else if (arg === "--batch-size") {
      const raw = valueAfter(argv, index++)
      batchSize = Number(raw)
      if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 500)
        throw invalidArgument("--batch-size must be an integer in 1..500")
    } else if (arg === "--expected-rows") {
      const raw = valueAfter(argv, index++)
      expectedRows = Number(raw)
      if (!Number.isSafeInteger(expectedRows) || expectedRows < 1)
        throw invalidArgument("--expected-rows must be a positive integer")
    } else if (arg === "--expected-digest") {
      expectedDigest = valueAfter(argv, index++)
      if (!/^[a-f0-9]{32}$/.test(expectedDigest))
        throw invalidArgument(
          "--expected-digest must be a lowercase MD5 digest",
        )
    } else if (arg === "--apply") apply = true
    else throw invalidArgument(`unknown flag '${arg}'`)
  }
  if (!source) throw invalidArgument("--source <key> is required")
  if (!/^[a-z0-9][a-z0-9-]*$/.test(source))
    throw invalidArgument(
      "--source must contain lowercase letters, digits, and hyphens only",
    )
  if (apply && (expectedRows === undefined || !expectedDigest))
    throw invalidArgument(
      "--apply requires --expected-rows and --expected-digest from the reviewed dry run",
    )
  return {
    source,
    apply,
    batchSize,
    ...(expectedRows === undefined ? {} : { expectedRows }),
    ...(expectedDigest === undefined ? {} : { expectedDigest }),
  }
}

const postgresUrl = (name: string, value: string | undefined): URL => {
  if (!value?.trim()) throw invalidArgument(`${name} is required`)
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw invalidArgument(`${name} must be a PostgreSQL URL`)
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:")
    throw invalidArgument(`${name} must be a PostgreSQL URL`)
  return parsed
}

const databaseIdentity = (url: URL): string =>
  `${url.hostname.toLowerCase()}:${url.port || "5432"}${url.pathname}`

export function resolveRawDocumentPromotionEnvironment(
  input: NodeJS.ProcessEnv,
  apply: boolean,
): RawDocumentPromotionEnvironment {
  const source = postgresUrl(
    "RAG_LOCAL_DATABASE_URL",
    input.RAG_LOCAL_DATABASE_URL,
  )
  const target = postgresUrl(
    "JFRAG_POSTGRESQL_DB_URL",
    input.JFRAG_POSTGRESQL_DB_URL,
  )
  const expectedHost = input.JFRAG_EXPECTED_POSTGRES_HOST?.trim().toLowerCase()
  if (!expectedHost)
    throw invalidArgument(
      "JFRAG_EXPECTED_POSTGRES_HOST is required before connecting to production",
    )
  if (target.hostname.toLowerCase() !== expectedHost)
    throw invalidArgument(
      "JFRAG_EXPECTED_POSTGRES_HOST does not match the production database host",
    )
  if (databaseIdentity(source) === databaseIdentity(target))
    throw invalidArgument(
      "local source and production target are the same database",
    )
  if (apply && input.JFRAG_ALLOW_PROD_WRITE !== "1")
    throw invalidArgument(
      "production write refused: set JFRAG_ALLOW_PROD_WRITE=1 as the second deliberate signal",
    )
  return { sourceUrl: source.href, targetUrl: target.href }
}

const statsEqual = (left: PromotionStats, right: PromotionStats): boolean =>
  left.totalRows === right.totalRows &&
  left.latestRows === right.latestRows &&
  left.digest === right.digest

const assertEmptyTarget = (stats: PromotionStats, sourceKey: string): void => {
  if (stats.totalRows !== 0)
    throw new RagOperationalError(
      "corpus_state_invalid",
      `production already has raw documents for '${sourceKey}'; promotion only accepts an empty source target`,
    )
}

export async function promoteRawDocuments(
  source: PromotionReader,
  target: PromotionTarget,
  args: RawDocumentPromotionArgs,
): Promise<RawDocumentPromotionSummary> {
  const before = await source.stats(args.source)
  if (before.latestRows === 0 || !before.digest)
    throw new RagOperationalError(
      "corpus_state_invalid",
      `local source '${args.source}' has no raw documents to promote`,
    )
  const expectedDigest = before.digest
  if (
    args.apply &&
    (args.expectedRows !== before.latestRows ||
      args.expectedDigest !== expectedDigest)
  )
    throw new RagOperationalError(
      "corpus_state_invalid",
      "reviewed promotion row count or digest no longer matches the local source",
    )
  assertEmptyTarget(await target.stats(args.source), args.source)
  if (!args.apply)
    return {
      dryRun: true,
      source: args.source,
      rows: before.latestRows,
      digest: expectedDigest,
      batches: 0,
      mutation: false,
    }

  return target.atomic(async (writer) => {
    assertEmptyTarget(await writer.stats(args.source), args.source)
    let afterCanonicalUrl: string | null = null
    let copied = 0
    let batches = 0
    for (;;) {
      const rows = await source.latestBatch(
        args.source,
        afterCanonicalUrl,
        args.batchSize,
      )
      if (rows.length === 0) break
      const canonicalUrls = new Set(rows.map((row) => row.canonicalUrl))
      if (
        rows.some((row) => row.sourceKey !== args.source) ||
        canonicalUrls.size !== rows.length ||
        (afterCanonicalUrl !== null && canonicalUrls.has(afterCanonicalUrl))
      )
        throw new RagOperationalError(
          "corpus_state_invalid",
          "local promotion batch duplicated a cursor or escaped its source scope",
        )
      await writer.insertPending(rows)
      copied += rows.length
      batches += 1
      afterCanonicalUrl = rows.at(-1)?.canonicalUrl ?? null
    }

    const sourceAfter = await source.stats(args.source)
    if (!statsEqual(before, sourceAfter))
      throw new RagOperationalError(
        "corpus_state_invalid",
        "local raw documents changed during promotion; production write was rolled back",
      )
    const targetAfter = await writer.stats(args.source)
    if (
      copied !== before.latestRows ||
      targetAfter.totalRows !== before.latestRows ||
      targetAfter.latestRows !== before.latestRows ||
      targetAfter.pendingRows !== before.latestRows ||
      targetAfter.digest !== expectedDigest
    )
      throw new RagOperationalError(
        "corpus_state_invalid",
        "production raw-document reconciliation failed; production write was rolled back",
      )
    return {
      dryRun: false,
      source: args.source,
      rows: copied,
      digest: expectedDigest,
      batches,
      mutation: true,
    }
  })
}

type StatsRow = {
  totalRows: number
  latestRows: number
  pendingRows: number
  digest: string | null
}

const latestRows = (sourceKey: string) => Prisma.sql`
  SELECT DISTINCT ON (canonical_url)
    source_key, url, canonical_url, title, raw_content, status, body_hash,
    etag, last_modified, fetched_at, not_modified, ingested_at
  FROM raw_documents
  WHERE source_key = ${sourceKey}
  ORDER BY canonical_url, fetched_at DESC, id DESC
`

export class PrismaRawDocumentPromotionStore
  implements PromotionReader, PromotionTarget, PromotionWriter
{
  constructor(private readonly db: PrismaClient) {}

  async stats(sourceKey: string): Promise<PromotionStats> {
    const rows = await this.db.$queryRaw<StatsRow[]>(Prisma.sql`
      WITH latest AS (${latestRows(sourceKey)})
      SELECT
        (SELECT COUNT(*)::int FROM raw_documents WHERE source_key = ${sourceKey}) AS "totalRows",
        COUNT(*)::int AS "latestRows",
        COUNT(*) FILTER (WHERE ingested_at IS NULL)::int AS "pendingRows",
        md5(string_agg(md5(jsonb_build_array(
          source_key, url, canonical_url, title, raw_content, status, body_hash,
          etag, last_modified,
          to_char(fetched_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US'),
          not_modified
        )::text), '' ORDER BY canonical_url)) AS digest
      FROM latest
    `)
    return rows[0]
  }

  async latestBatch(
    sourceKey: string,
    afterCanonicalUrl: string | null,
    limit: number,
  ): Promise<PromotionRow[]> {
    return this.db.$queryRaw<PromotionRow[]>(Prisma.sql`
      WITH latest AS (${latestRows(sourceKey)})
      SELECT
        source_key AS "sourceKey", url, canonical_url AS "canonicalUrl", title,
        raw_content AS "rawContent", status, body_hash AS "bodyHash", etag,
        last_modified AS "lastModified", fetched_at AS "fetchedAt",
        not_modified AS "notModified"
      FROM latest
      WHERE (${afterCanonicalUrl}::text IS NULL OR canonical_url > ${afterCanonicalUrl})
      ORDER BY canonical_url
      LIMIT ${limit}
    `)
  }

  async insertPending(rows: readonly PromotionRow[]): Promise<void> {
    await this.db.rawDocument.createMany({
      data: rows.map((row) => ({
        sourceKey: row.sourceKey,
        url: row.url,
        canonicalUrl: row.canonicalUrl,
        title: row.title,
        rawContent: row.rawContent,
        status: row.status,
        bodyHash: row.bodyHash,
        etag: row.etag,
        lastModified: row.lastModified,
        fetchedAt: row.fetchedAt,
        notModified: row.notModified,
      })),
    })
  }

  async atomic<T>(
    operation: (writer: PromotionWriter) => Promise<T>,
  ): Promise<T> {
    return this.db.$transaction(
      (transaction) =>
        operation(
          new PrismaRawDocumentPromotionStore(transaction as PrismaClient),
        ),
      PROMOTION_TRANSACTION_OPTIONS,
    )
  }
}
