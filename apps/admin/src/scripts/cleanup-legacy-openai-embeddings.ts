#!/usr/bin/env tsx
/**
 * Audit and remove legacy OpenAI content embeddings from an Admin database.
 *
 * Dry-run is the default. Execute mode mutates only rows that can be
 * classified as known legacy OpenAI by the model/provider columns present in
 * this checkout's schema.
 */

import { mkdir, writeFile } from "node:fs/promises"
import { dirname, isAbsolute, resolve } from "node:path"

export const LEGACY_OPENAI_MODELS = [
  "openai/text-embedding-3-small",
  "text-embedding-3-small",
] as const

export const QWEN_INDEX_NAMES = [
  "video_scene_locale_embedding_qwen_hnsw_fr",
  "video_scene_locale_embedding_qwen_hnsw_es",
  "video_scene_locale_embedding_qwen_hnsw_en",
  "video_scene_locale_embedding_qwen_hnsw",
  "video_transcript_chunk_embedding_qwen_hnsw_fr",
  "video_transcript_chunk_embedding_qwen_hnsw_es",
  "video_transcript_chunk_embedding_qwen_hnsw_en",
  "video_transcript_chunk_embedding_qwen_hnsw",
] as const

export const QWEN_COLUMN_TABLES = [
  "video_scene_locale",
  "video_transcript_chunk",
] as const

export const EXECUTE_TRANSACTION_OPTIONS = {
  maxWait: 30000,
  timeout: 600000,
} as const

export type TargetEnvironment = "development" | "staging" | "production"

export type CleanupArgs = {
  targetEnv: TargetEnvironment
  execute: boolean
  allowProductionTarget: boolean
  backupEvidence?: string
  reportOutPath: string
  batchSize: number
}

type CountRow = { count: number | bigint | string | null }

export type ContentStorageAudit = {
  legacyTargets: number
  preservedRows: number
  ambiguousRows: number
  metadataOnlyLegacyModelRows?: number
}

export type TranscriptAudit = {
  legacyParents: number
  legacyChunks: number
  preservedParents: number
  preservedChunks: number
  ambiguousParents: number
  ambiguousChunks: number
}

export type QwenColumnArtifact = {
  tableName: string
  columnName: string
  nonNullValues: number
}

export type QwenIndexArtifact = {
  tableName: string
  indexName: string
}

export type QwenMigrationState = {
  migrationName: string
  finishedAt: string | Date | null
  rolledBackAt: string | Date | null
  logs?: string | null
}

export type QwenAudit = {
  action: "verified_absent" | "would_drop" | "blocked"
  safeToDrop: boolean
  blockedReasons: string[]
  columns: QwenColumnArtifact[]
  indexes: QwenIndexArtifact[]
  migrations: QwenMigrationState[]
}

export type CleanupAudit = {
  scenes: ContentStorageAudit
  experiences: ContentStorageAudit
  transcripts: TranscriptAudit
  qwen: QwenAudit
}

export type MutationSummary = {
  sceneLocalesCleared: number
  experienceLocalesCleared: number
  transcriptChunksDeleted: number
  qwenIndexesDropped: number
  qwenColumnsDropped: number
}

export type CleanupReport = {
  event:
    | "cleanup-legacy-openai-embeddings.dry-run-complete"
    | "cleanup-legacy-openai-embeddings.complete"
  targetEnv: TargetEnvironment
  dryRun: boolean
  execute: boolean
  startedAt: string
  completedAt: string
  batchSize: number
  backupEvidence?: string
  auditBefore: CleanupAudit
  mutations?: MutationSummary
  auditAfter?: CleanupAudit
}

export type CleanupDb = {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>
  $disconnect?: () => Promise<void>
  $transaction?: <T>(
    fn: (tx: CleanupDb) => Promise<T>,
    options?: typeof EXECUTE_TRANSACTION_OPTIONS,
  ) => Promise<T>
}

type ContentAuditRow = {
  legacyTargets: number | bigint | string | null
  preservedRows: number | bigint | string | null
  ambiguousRows: number | bigint | string | null
  metadataOnlyLegacyModelRows: number | bigint | string | null
}

type TranscriptAuditRow = {
  legacyParents: number | bigint | string | null
  legacyChunks: number | bigint | string | null
  preservedParents: number | bigint | string | null
  preservedChunks: number | bigint | string | null
  ambiguousParents: number | bigint | string | null
  ambiguousChunks: number | bigint | string | null
}

type QwenColumnRow = {
  tableName: string
  columnName: string
}

type QwenIndexRow = {
  tableName: string
  indexName: string
}

export class LegacyEmbeddingCleanupError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "LegacyEmbeddingCleanupError"
  }
}

function readFlag(args: readonly string[], name: string): string | undefined {
  const prefix = `--${name}=`
  const match = args.find((arg) => arg.startsWith(prefix))
  return match?.slice(prefix.length)
}

function hasFlag(args: readonly string[], name: string): boolean {
  return args.includes(`--${name}`)
}

export function parseTargetEnv(raw: string | undefined): TargetEnvironment {
  if (raw === "local" || raw === "development") return "development"
  if (raw === "staging" || raw === "production") return raw
  if (raw == null || raw === "") {
    throw new LegacyEmbeddingCleanupError(
      "--target-env=development|staging|production is required",
    )
  }
  throw new LegacyEmbeddingCleanupError(
    `Unknown target env ${JSON.stringify(raw)}. Use development, staging, or production.`,
  )
}

export function resolveReportOutPath(
  arg: string | undefined,
  now: Date = new Date(),
): string {
  const raw =
    arg && arg.length > 0
      ? arg
      : `.tmp/legacy-openai-embedding-cleanup/${timestamp(now)}.json`
  return isAbsolute(raw) ? raw : resolve(process.cwd(), raw)
}

function parseBatchSize(raw: string | undefined): number {
  if (raw == null || raw === "") return 5000
  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100000) {
    throw new LegacyEmbeddingCleanupError(
      "--batch-size must be an integer between 1 and 100000",
    )
  }
  return parsed
}

export function parseArgs(
  args: readonly string[],
  now: Date = new Date(),
): CleanupArgs {
  const normalizedArgs = args.filter((arg) => arg !== "--")
  const execute = hasFlag(normalizedArgs, "execute")
  const parsed: CleanupArgs = {
    targetEnv: parseTargetEnv(readFlag(normalizedArgs, "target-env")),
    execute,
    allowProductionTarget: hasFlag(normalizedArgs, "allow-production-target"),
    backupEvidence: readFlag(normalizedArgs, "backup-evidence") || undefined,
    reportOutPath: resolveReportOutPath(
      readFlag(normalizedArgs, "report-out"),
      now,
    ),
    batchSize: parseBatchSize(readFlag(normalizedArgs, "batch-size")),
  }
  validateExecutionSafety(parsed)
  return parsed
}

export function validateExecutionSafety(args: CleanupArgs): void {
  if (!args.execute || args.targetEnv !== "production") return
  if (!args.allowProductionTarget) {
    throw new LegacyEmbeddingCleanupError(
      "Refusing production cleanup without --allow-production-target",
    )
  }
  if (!args.backupEvidence) {
    throw new LegacyEmbeddingCleanupError(
      "Refusing production cleanup without --backup-evidence=<backup key or recovery point>",
    )
  }
}

function timestamp(now: Date): string {
  return now.toISOString().replace(/[:.]/g, "-")
}

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

function countValue(
  value: number | bigint | string | null | undefined,
): number {
  if (value == null) return 0
  return Number(value)
}

function rowCount(rows: readonly CountRow[]): number {
  return countValue(rows[0]?.count)
}

const LEGACY_MODEL_SQL = LEGACY_OPENAI_MODELS.map(sqlString).join(", ")
const SCENE_LEGACY_CONDITION = `model IN (${LEGACY_MODEL_SQL})`
const EXPERIENCE_LEGACY_CONDITION = `(embedding_provider = 'openai' OR embedding_model IN (${LEGACY_MODEL_SQL}))`
const EXPERIENCE_AMBIGUOUS_CONDITION = `(embedding_provider IS NULL AND embedding_model IS NULL)`
const TRANSCRIPT_LEGACY_CONDITION = `t.model IN (${LEGACY_MODEL_SQL})`

async function readSceneAudit(db: CleanupDb): Promise<ContentStorageAudit> {
  const rows = await db.$queryRawUnsafe<ContentAuditRow[]>(`
    SELECT
      COUNT(*) FILTER (
        WHERE embedding IS NOT NULL AND ${SCENE_LEGACY_CONDITION}
      ) AS "legacyTargets",
      COUNT(*) FILTER (
        WHERE embedding IS NOT NULL AND NOT ${SCENE_LEGACY_CONDITION}
      ) AS "preservedRows",
      0::int AS "ambiguousRows",
      COUNT(*) FILTER (
        WHERE embedding IS NULL AND ${SCENE_LEGACY_CONDITION}
      ) AS "metadataOnlyLegacyModelRows"
    FROM video_scene_locale
  `)
  const row = rows[0]
  return {
    legacyTargets: countValue(row?.legacyTargets),
    preservedRows: countValue(row?.preservedRows),
    ambiguousRows: countValue(row?.ambiguousRows),
    metadataOnlyLegacyModelRows: countValue(row?.metadataOnlyLegacyModelRows),
  }
}

async function readExperienceAudit(
  db: CleanupDb,
): Promise<ContentStorageAudit> {
  const rows = await db.$queryRawUnsafe<ContentAuditRow[]>(`
    SELECT
      COUNT(*) FILTER (
        WHERE embedding IS NOT NULL AND ${EXPERIENCE_LEGACY_CONDITION}
      ) AS "legacyTargets",
      COUNT(*) FILTER (
        WHERE embedding IS NOT NULL
          AND NOT ${EXPERIENCE_LEGACY_CONDITION}
          AND NOT ${EXPERIENCE_AMBIGUOUS_CONDITION}
      ) AS "preservedRows",
      COUNT(*) FILTER (
        WHERE embedding IS NOT NULL
          AND NOT ${EXPERIENCE_LEGACY_CONDITION}
          AND ${EXPERIENCE_AMBIGUOUS_CONDITION}
      ) AS "ambiguousRows",
      COUNT(*) FILTER (
        WHERE embedding IS NULL AND ${EXPERIENCE_LEGACY_CONDITION}
      ) AS "metadataOnlyLegacyModelRows"
    FROM experience_locale
  `)
  const row = rows[0]
  return {
    legacyTargets: countValue(row?.legacyTargets),
    preservedRows: countValue(row?.preservedRows),
    ambiguousRows: countValue(row?.ambiguousRows),
    metadataOnlyLegacyModelRows: countValue(row?.metadataOnlyLegacyModelRows),
  }
}

async function readTranscriptAudit(db: CleanupDb): Promise<TranscriptAudit> {
  const rows = await db.$queryRawUnsafe<TranscriptAuditRow[]>(`
    SELECT
      COUNT(DISTINCT t.id) FILTER (
        WHERE ${TRANSCRIPT_LEGACY_CONDITION}
      ) AS "legacyParents",
      COUNT(c.id) FILTER (
        WHERE ${TRANSCRIPT_LEGACY_CONDITION}
      ) AS "legacyChunks",
      COUNT(DISTINCT t.id) FILTER (
        WHERE NOT ${TRANSCRIPT_LEGACY_CONDITION}
      ) AS "preservedParents",
      COUNT(c.id) FILTER (
        WHERE NOT ${TRANSCRIPT_LEGACY_CONDITION}
      ) AS "preservedChunks",
      0::int AS "ambiguousParents",
      0::int AS "ambiguousChunks"
    FROM video_transcript t
    LEFT JOIN video_transcript_chunk c ON c.transcript_id = t.id
  `)
  const row = rows[0]
  return {
    legacyParents: countValue(row?.legacyParents),
    legacyChunks: countValue(row?.legacyChunks),
    preservedParents: countValue(row?.preservedParents),
    preservedChunks: countValue(row?.preservedChunks),
    ambiguousParents: countValue(row?.ambiguousParents),
    ambiguousChunks: countValue(row?.ambiguousChunks),
  }
}

async function readQwenColumns(db: CleanupDb): Promise<QwenColumnArtifact[]> {
  const columns = await db.$queryRawUnsafe<QwenColumnRow[]>(`
    SELECT
      table_name AS "tableName",
      column_name AS "columnName"
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name IN (${QWEN_COLUMN_TABLES.map(sqlString).join(", ")})
      AND column_name = 'embedding_qwen'
    ORDER BY table_name
  `)

  const withCounts: QwenColumnArtifact[] = []
  for (const column of columns) {
    if (!QWEN_COLUMN_TABLES.includes(column.tableName as never)) continue
    const rows = await db.$queryRawUnsafe<CountRow[]>(`
      SELECT COUNT(*) AS count
      FROM "${column.tableName}"
      WHERE "embedding_qwen" IS NOT NULL
    `)
    withCounts.push({
      tableName: column.tableName,
      columnName: column.columnName,
      nonNullValues: rowCount(rows),
    })
  }
  return withCounts
}

async function readQwenIndexes(db: CleanupDb): Promise<QwenIndexArtifact[]> {
  return db.$queryRawUnsafe<QwenIndexRow[]>(`
    SELECT
      tablename AS "tableName",
      indexname AS "indexName"
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname LIKE '%embedding_qwen%'
    ORDER BY tablename, indexname
  `)
}

async function readQwenMigrations(
  db: CleanupDb,
): Promise<QwenMigrationState[]> {
  return db.$queryRawUnsafe<QwenMigrationState[]>(`
    SELECT
      migration_name AS "migrationName",
      finished_at AS "finishedAt",
      rolled_back_at AS "rolledBackAt",
      logs
    FROM _prisma_migrations
    WHERE migration_name IN (
      '0032_video_embedding_qwen',
      '0033_drop_video_embedding_qwen'
    )
    ORDER BY started_at
  `)
}

export async function readQwenAudit(db: CleanupDb): Promise<QwenAudit> {
  const [columns, indexes, migrations] = await Promise.all([
    readQwenColumns(db),
    readQwenIndexes(db),
    readQwenMigrations(db),
  ])
  const failedMigrations = migrations.filter(
    (migration) =>
      migration.finishedAt == null && migration.rolledBackAt == null,
  )
  const blockedReasons = failedMigrations.map(
    (migration) =>
      `migration ${migration.migrationName} is not finished or rolled back`,
  )
  const hasArtifacts = columns.length > 0 || indexes.length > 0
  const safeToDrop = blockedReasons.length === 0
  return {
    action: !safeToDrop
      ? "blocked"
      : hasArtifacts
        ? "would_drop"
        : "verified_absent",
    safeToDrop,
    blockedReasons,
    columns,
    indexes,
    migrations,
  }
}

export async function buildCleanupAudit(db: CleanupDb): Promise<CleanupAudit> {
  const [scenes, experiences, transcripts, qwen] = await Promise.all([
    readSceneAudit(db),
    readExperienceAudit(db),
    readTranscriptAudit(db),
    readQwenAudit(db),
  ])
  return { scenes, experiences, transcripts, qwen }
}

async function clearLegacySceneLocales(db: CleanupDb): Promise<number> {
  return db.$executeRawUnsafe(`
    UPDATE video_scene_locale
    SET
      embedding = NULL,
      source_artifact_key = NULL,
      source_artifact_version = NULL,
      source_content_hash = NULL,
      source_provider = NULL,
      source_generated_at = NULL,
      generation_mode = NULL,
      mastra_run_id = NULL,
      generated_at = NULL,
      updated_at = NOW()
    WHERE embedding IS NOT NULL
      AND ${SCENE_LEGACY_CONDITION}
  `)
}

async function clearLegacyExperienceLocales(db: CleanupDb): Promise<number> {
  return db.$executeRawUnsafe(`
    UPDATE experience_locale
    SET
      embedding = NULL,
      embedding_source_content_hash = NULL,
      embedding_source_summary = NULL,
      embedding_model = NULL,
      embedding_dimensions = NULL,
      embedding_provider = NULL,
      embedding_generation_mode = NULL,
      embedding_mastra_run_id = NULL,
      embedding_generated_at = NULL,
      updated_at = NOW()
    WHERE embedding IS NOT NULL
      AND ${EXPERIENCE_LEGACY_CONDITION}
  `)
}

async function deleteLegacyTranscriptChunks(
  db: CleanupDb,
  batchSize: number,
): Promise<number> {
  let totalDeleted = 0

  for (;;) {
    const deleted = await db.$executeRawUnsafe(`
      WITH doomed AS (
        SELECT c.id
        FROM video_transcript_chunk c
        JOIN video_transcript t ON t.id = c.transcript_id
        WHERE ${TRANSCRIPT_LEGACY_CONDITION}
        ORDER BY c.transcript_id, c.chunk_index
        LIMIT ${batchSize}
      )
      DELETE FROM video_transcript_chunk c
      USING doomed
      WHERE c.id = doomed.id
    `)
    totalDeleted += deleted
    if (deleted < batchSize) return totalDeleted
  }
}

async function executeContentMutations(
  db: CleanupDb,
  args: CleanupArgs,
): Promise<Omit<MutationSummary, "qwenIndexesDropped" | "qwenColumnsDropped">> {
  const run = async (tx: CleanupDb) => {
    const sceneLocalesCleared = await clearLegacySceneLocales(tx)
    const experienceLocalesCleared = await clearLegacyExperienceLocales(tx)
    const transcriptChunksDeleted = await deleteLegacyTranscriptChunks(
      tx,
      args.batchSize,
    )
    return {
      sceneLocalesCleared,
      experienceLocalesCleared,
      transcriptChunksDeleted,
    }
  }
  return db.$transaction
    ? db.$transaction(run, EXECUTE_TRANSACTION_OPTIONS)
    : run(db)
}

async function dropQwenArtifacts(
  db: CleanupDb,
  qwen: QwenAudit,
): Promise<Pick<MutationSummary, "qwenIndexesDropped" | "qwenColumnsDropped">> {
  if (qwen.action === "verified_absent") {
    return { qwenIndexesDropped: 0, qwenColumnsDropped: 0 }
  }
  if (!qwen.safeToDrop) {
    throw new LegacyEmbeddingCleanupError(
      `Refusing Qwen cleanup: ${qwen.blockedReasons.join("; ")}`,
    )
  }

  let qwenIndexesDropped = 0
  for (const indexName of QWEN_INDEX_NAMES) {
    await db.$executeRawUnsafe(`DROP INDEX IF EXISTS "${indexName}"`)
    if (qwen.indexes.some((index) => index.indexName === indexName)) {
      qwenIndexesDropped += 1
    }
  }

  let qwenColumnsDropped = 0
  for (const tableName of QWEN_COLUMN_TABLES) {
    await db.$executeRawUnsafe(
      `ALTER TABLE "${tableName}" DROP COLUMN IF EXISTS "embedding_qwen"`,
    )
    if (qwen.columns.some((column) => column.tableName === tableName)) {
      qwenColumnsDropped += 1
    }
  }

  return { qwenIndexesDropped, qwenColumnsDropped }
}

export async function executeLegacyCleanup(
  db: CleanupDb,
  args: CleanupArgs,
  audit: CleanupAudit,
): Promise<MutationSummary> {
  if (audit.qwen.action === "blocked") {
    throw new LegacyEmbeddingCleanupError(
      `Refusing execute while Qwen cleanup is blocked: ${audit.qwen.blockedReasons.join("; ")}`,
    )
  }

  const content = await executeContentMutations(db, args)
  const qwen = await dropQwenArtifacts(db, audit.qwen)
  return { ...content, ...qwen }
}

export async function runCleanup(
  db: CleanupDb,
  args: CleanupArgs,
  now: Date = new Date(),
): Promise<CleanupReport> {
  const startedAt = now.toISOString()
  const auditBefore = await buildCleanupAudit(db)

  if (!args.execute) {
    return {
      event: "cleanup-legacy-openai-embeddings.dry-run-complete",
      targetEnv: args.targetEnv,
      dryRun: true,
      execute: false,
      startedAt,
      completedAt: new Date().toISOString(),
      batchSize: args.batchSize,
      backupEvidence: args.backupEvidence,
      auditBefore,
    }
  }

  const mutations = await executeLegacyCleanup(db, args, auditBefore)
  const auditAfter = await buildCleanupAudit(db)
  return {
    event: "cleanup-legacy-openai-embeddings.complete",
    targetEnv: args.targetEnv,
    dryRun: false,
    execute: true,
    startedAt,
    completedAt: new Date().toISOString(),
    batchSize: args.batchSize,
    backupEvidence: args.backupEvidence,
    auditBefore,
    mutations,
    auditAfter,
  }
}

export async function writeReportToPath(
  reportOutPath: string,
  report: CleanupReport,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await mkdir(dirname(reportOutPath), { recursive: true })
    await writeFile(reportOutPath, JSON.stringify(report, null, 2) + "\n")
    return { ok: true }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

function databaseUrlFromEnv(): string {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    throw new LegacyEmbeddingCleanupError("DATABASE_URL is required")
  }
  return databaseUrl
}

export async function main(
  argv: readonly string[] = process.argv.slice(2),
): Promise<void> {
  const args = parseArgs(argv)
  databaseUrlFromEnv()

  const { prisma } = await import("@/db/client")
  try {
    const report = await runCleanup(prisma as unknown as CleanupDb, args)
    process.stdout.write(JSON.stringify(report, null, 2) + "\n")

    const writeResult = await writeReportToPath(args.reportOutPath, report)
    if (!writeResult.ok) {
      throw new LegacyEmbeddingCleanupError(
        `failed to write report: ${writeResult.error}`,
      )
    }
    process.stdout.write(
      JSON.stringify({
        event: "cleanup-legacy-openai-embeddings.report_out_written",
        path: args.reportOutPath,
      }) + "\n",
    )
  } finally {
    await prisma.$disconnect()
  }
}

if (
  typeof process.argv[1] === "string" &&
  import.meta.url === `file://${process.argv[1]}`
) {
  main().catch((err) => {
    process.stderr.write(
      JSON.stringify({
        event: "cleanup-legacy-openai-embeddings.fatal",
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      }) + "\n",
    )
    process.exit(1)
  })
}
