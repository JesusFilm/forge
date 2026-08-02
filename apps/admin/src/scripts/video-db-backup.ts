/**
 * Back up and restore the reviewed admin Postgres video data slice.
 *
 * Restore:
 *   TARGET_DATABASE_URL=postgresql://... \
 *   pnpm --filter @forge/admin restore:video-db -- \
 *     --target-env=development \
 *     --in=apps/admin/.tmp/db-backups/video-db-video-core-2026-05-13.dump
 *
 * Restore intentionally reads DATABASE_URL directly from process.env rather
 * than importing @/config/env. Operators should be able to run the focused
 * restore tool without satisfying the whole Next.js/admin runtime env matrix.
 *
 * Backup is not exposed as an operator CLI. It is invoked only by the
 * useworkflow job in src/workflows/videoDbBackup.ts.
 */

import { spawn } from "node:child_process"
import { createReadStream, createWriteStream } from "node:fs"
import { mkdir, open, rm, stat } from "node:fs/promises"
import { basename, dirname, resolve as resolvePath } from "node:path"
import { Readable } from "node:stream"
import { finished, pipeline } from "node:stream/promises"

export const VIDEO_DB_BACKUP_PROFILES = {
  "video-core": [
    "language",
    "language_locale",
    "continent",
    "continent_locale",
    "country",
    "country_locale",
    "country_language",
    "keyword",
    "video_origin",
    "video_edition",
    "mux_video",
    "bible_book",
    "video",
    "video_locale",
    "video_relation",
    "video_keyword",
    "video_dub",
    "video_dub_download",
    "video_subtitle",
    "video_study_question",
    "video_image",
    "bible_citation",
  ],
  "video-search": [
    "language",
    "language_locale",
    "continent",
    "continent_locale",
    "country",
    "country_locale",
    "country_language",
    "keyword",
    "video_origin",
    "video_edition",
    "mux_video",
    "bible_book",
    "video",
    "video_locale",
    "video_relation",
    "video_keyword",
    "video_dub",
    "video_dub_download",
    "video_subtitle",
    "video_study_question",
    "video_image",
    "bible_citation",
    "video_scene",
    "video_scene_locale",
    "video_transcript",
    "video_transcript_chunk",
  ],
  "video-full": [
    "language",
    "language_locale",
    "continent",
    "continent_locale",
    "country",
    "country_locale",
    "country_language",
    "keyword",
    "video_origin",
    "video_edition",
    "mux_video",
    "bible_book",
    "video",
    "video_locale",
    "video_relation",
    "video_keyword",
    "video_dub",
    "video_dub_download",
    "video_subtitle",
    "video_study_question",
    "video_image",
    "bible_citation",
    "video_scene",
    "video_scene_locale",
    "video_transcript",
    "video_transcript_chunk",
  ],
} as const

export type VideoDbBackupProfile = keyof typeof VIDEO_DB_BACKUP_PROFILES
export const SCHEDULED_VIDEO_DB_BACKUP_PROFILES = [
  "video-core",
  "video-search",
] as const satisfies readonly VideoDbBackupProfile[]
export type TargetEnvironment = "development" | "staging" | "production"

type ParsedArgs = {
  command: "backup" | "restore"
  profile: VideoDbBackupProfile
  outPath?: string
  inPath?: string
  s3Key?: string
  targetEnv: TargetEnvironment
  allowProductionTarget: boolean
  allowStale: boolean
  dryRun: boolean
}

type CommandPlan = {
  command: string
  args: string[]
  env?: Record<string, string>
}

type RestorePreflightCheck =
  | "pg-restore-client-version"
  | "psql-client-version"
  | "archive-manifest"
  | "target-compatibility"

type RestorePreflightCommandPlan = CommandPlan & {
  check: RestorePreflightCheck
}

type RestorePreflightCapture = (
  plan: RestorePreflightCommandPlan,
) => Promise<string>

type DatabaseUrlEnv = {
  SOURCE_DATABASE_URL?: string
  TARGET_DATABASE_URL?: string
  DATABASE_URL?: string
}

type BackupStorageEnv = {
  RAILWAY_S3_BUCKET?: string
  RAILWAY_S3_ENDPOINT?: string
  RAILWAY_S3_REGION?: string
  RAILWAY_S3_ACCESS_KEY_ID?: string
  RAILWAY_S3_SECRET_ACCESS_KEY?: string
}

type BackupDownloadSignerEnv = {
  BACKUP_DOWNLOAD_API_KEY?: string
  BACKUP_DOWNLOAD_BASE_URL?: string
}

export type BackupUploadPlan = {
  bucket: string
  key: string
  endpoint?: string
  region: string
  accessKeyId: string
  secretAccessKey: string
}

export type BackupPlan = {
  mode: "backup"
  profile: VideoDbBackupProfile
  source: string
  outPath: string
  generatedOutPath: boolean
  upload?: BackupUploadPlan
  tables: string[]
  commands: CommandPlan[]
}

export type RestorePlan = {
  mode: "restore"
  profile: VideoDbBackupProfile
  target: string
  targetEnv: TargetEnvironment
  inPath: string
  tables: string[]
  preflightCommands: RestorePreflightCommandPlan[]
  commands: CommandPlan[]
}

export type VideoDbBackupJobResult = {
  event: "video-db.backup.complete" | "video-db.backup.dry-run-complete"
  profile: VideoDbBackupProfile
  tables: number
  path: string
  size?: number
  upload?: {
    bucket: string
    key: string
  }
}

export type VideoDbBackupDownloadResult = {
  event: "video-db.backup.download.complete"
  profile: VideoDbBackupProfile
  bucket?: string
  key: string
  path: string
  selection: "latest" | "explicit-key"
  size?: number
  lastModified?: string
  freshness?: VideoDbBackupFreshnessAvailable
}

type PresignedBackupResponse = {
  url: string
  profile: VideoDbBackupProfile
  key: string
  expiresAt: string
  expiresInSeconds: number
  size?: number
  lastModified?: string
  freshness: VideoDbBackupFreshnessAvailable
}

export const VIDEO_DB_BACKUP_MAX_AGE_HOURS = 36
export const VIDEO_DB_BACKUP_MAX_AGE_MILLISECONDS =
  VIDEO_DB_BACKUP_MAX_AGE_HOURS * 60 * 60 * 1000

export type VideoDbBackupObjectMetadata = {
  key?: string
  size?: number
  lastModified?: Date
}

export type VideoDbBackupObjectPage = {
  objects: readonly VideoDbBackupObjectMetadata[]
  isTruncated?: boolean
  nextContinuationToken?: string
}

type VideoDbBackupFreshnessBase = {
  evaluatedAt: string
  thresholdHours: number
  thresholdMilliseconds: number
}

export type VideoDbBackupFreshnessAvailable = VideoDbBackupFreshnessBase & {
  status: "fresh" | "stale"
  key: string
  size?: number
  lastModified: string
  ageMilliseconds: number
}

export type VideoDbBackupFreshness =
  | VideoDbBackupFreshnessAvailable
  | (VideoDbBackupFreshnessBase & {
      status: "not-found"
    })
  | (VideoDbBackupFreshnessBase & {
      status: "unavailable-metadata"
      key: string
      size?: number
      reason: "missing-or-invalid-last-modified"
    })

export class VideoDbBackupError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "VideoDbBackupError"
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

function currentDatabaseUrlEnv(): DatabaseUrlEnv {
  return {
    SOURCE_DATABASE_URL: process.env.SOURCE_DATABASE_URL,
    TARGET_DATABASE_URL: process.env.TARGET_DATABASE_URL,
    DATABASE_URL: process.env.DATABASE_URL,
  }
}

function currentBackupStorageEnv(): BackupStorageEnv {
  return {
    RAILWAY_S3_BUCKET: process.env.RAILWAY_S3_BUCKET,
    RAILWAY_S3_ENDPOINT: process.env.RAILWAY_S3_ENDPOINT,
    RAILWAY_S3_REGION: process.env.RAILWAY_S3_REGION,
    RAILWAY_S3_ACCESS_KEY_ID: process.env.RAILWAY_S3_ACCESS_KEY_ID,
    RAILWAY_S3_SECRET_ACCESS_KEY: process.env.RAILWAY_S3_SECRET_ACCESS_KEY,
  }
}

function currentBackupDownloadSignerEnv(): BackupDownloadSignerEnv {
  return {
    BACKUP_DOWNLOAD_API_KEY: process.env.BACKUP_DOWNLOAD_API_KEY,
    BACKUP_DOWNLOAD_BASE_URL: process.env.BACKUP_DOWNLOAD_BASE_URL,
  }
}

export function parseProfile(raw: string | undefined): VideoDbBackupProfile {
  const profile = raw ?? "video-core"
  if (profile in VIDEO_DB_BACKUP_PROFILES) {
    return profile as VideoDbBackupProfile
  }
  throw new VideoDbBackupError(
    `Unknown profile ${JSON.stringify(profile)}. Use one of: ${Object.keys(
      VIDEO_DB_BACKUP_PROFILES,
    ).join(", ")}`,
  )
}

export function parseTargetEnv(raw: string | undefined): TargetEnvironment {
  const targetEnv = raw ?? "development"
  if (
    targetEnv === "development" ||
    targetEnv === "staging" ||
    targetEnv === "production"
  ) {
    return targetEnv
  }
  throw new VideoDbBackupError(
    `Unknown target env ${JSON.stringify(targetEnv)}. Use development, staging, or production.`,
  )
}

export function parseArgs(
  command: "backup" | "restore",
  args: readonly string[],
): ParsedArgs {
  const normalizedArgs = args.filter((arg) => arg !== "--")
  return {
    command,
    profile: parseProfile(readFlag(normalizedArgs, "profile")),
    outPath: readFlag(normalizedArgs, "out"),
    inPath: readFlag(normalizedArgs, "in"),
    s3Key: readFlag(normalizedArgs, "s3-key"),
    targetEnv: parseTargetEnv(readFlag(normalizedArgs, "target-env")),
    allowProductionTarget: hasFlag(normalizedArgs, "allow-production-target"),
    allowStale: hasFlag(normalizedArgs, "allow-stale"),
    dryRun: hasFlag(normalizedArgs, "dry-run"),
  }
}

export function classifyVideoDbBackupFreshness(
  objects: readonly VideoDbBackupObjectMetadata[],
  evaluatedAt = new Date(Date.now()),
): VideoDbBackupFreshness {
  const evaluation = {
    evaluatedAt: evaluatedAt.toISOString(),
    thresholdHours: VIDEO_DB_BACKUP_MAX_AGE_HOURS,
    thresholdMilliseconds: VIDEO_DB_BACKUP_MAX_AGE_MILLISECONDS,
  }
  let sawDump = false
  let unavailable: (VideoDbBackupObjectMetadata & { key: string }) | undefined
  let latest:
    | (VideoDbBackupObjectMetadata & { key: string; lastModified: Date })
    | undefined

  for (const object of objects) {
    const key = object.key
    if (typeof key !== "string" || !key.endsWith(".dump")) {
      continue
    }
    sawDump = true
    const lastModified = object.lastModified
    if (
      !(lastModified instanceof Date) ||
      !Number.isFinite(lastModified.getTime())
    ) {
      unavailable ??= { ...object, key }
      continue
    }
    if (!latest || lastModified.getTime() > latest.lastModified.getTime()) {
      latest = { ...object, key, lastModified }
    }
  }

  if (!sawDump) return { status: "not-found", ...evaluation }
  if (unavailable) {
    return {
      status: "unavailable-metadata",
      key: unavailable.key,
      size: unavailable.size,
      reason: "missing-or-invalid-last-modified",
      ...evaluation,
    }
  }

  if (!latest) {
    throw new VideoDbBackupError(
      "Video DB backup freshness classification reached an invalid state",
    )
  }

  const ageMilliseconds = evaluatedAt.getTime() - latest.lastModified.getTime()
  return {
    status:
      ageMilliseconds <= VIDEO_DB_BACKUP_MAX_AGE_MILLISECONDS
        ? "fresh"
        : "stale",
    key: latest.key,
    size: latest.size,
    lastModified: latest.lastModified.toISOString(),
    ageMilliseconds,
    ...evaluation,
  }
}

export async function discoverVideoDbBackupFreshnessFromPages(
  loadPage: (continuationToken?: string) => Promise<VideoDbBackupObjectPage>,
): Promise<VideoDbBackupFreshness> {
  const objects: VideoDbBackupObjectMetadata[] = []
  let continuationToken: string | undefined

  while (true) {
    const page = await loadPage(continuationToken)
    objects.push(...page.objects)
    if (!page.isTruncated) break
    if (!page.nextContinuationToken) {
      throw new VideoDbBackupError(
        "Backup object listing was truncated without a continuation token",
      )
    }
    continuationToken = page.nextContinuationToken
  }

  return classifyVideoDbBackupFreshness(objects)
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-")
}

function defaultOutPath(profile: VideoDbBackupProfile): string {
  return resolvePath(
    process.cwd(),
    ".tmp",
    "db-backups",
    `video-db-${profile}-${timestamp()}.dump`,
  )
}

function defaultRestoreDownloadPath(profile: VideoDbBackupProfile): string {
  return resolvePath(
    process.cwd(),
    ".tmp",
    "db-backups",
    `video-db-${profile}-latest.dump`,
  )
}

function normalizeS3Prefix(prefix: string): string {
  return prefix.replace(/^\/+|\/+$/g, "")
}

function normalizeBackupObjectKey(key: string): string {
  return key.replace(/^\/+/, "")
}

async function prepareOwnerOnlyFile(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const output = await open(path, "w", 0o600)
  try {
    await output.chmod(0o600)
  } finally {
    await output.close()
  }
}

export function buildBackupObjectKey(
  profile: VideoDbBackupProfile,
  outPath: string,
  keyOverride: string | undefined,
  _env: BackupStorageEnv,
): string {
  if (keyOverride) return normalizeBackupObjectKey(keyOverride)

  const prefix = normalizeS3Prefix("admin-video-db-backups")
  const filename = basename(outPath)
  return prefix.length > 0 ? `${prefix}/${profile}/${filename}` : filename
}

function tableArgs(tables: readonly string[]): string[] {
  return tables.map((table) => `--table=public.${table}`)
}

function restoreTableArgs(tables: readonly string[]): string[] {
  return tables.map((table) => `--table=${table}`)
}

function quoteTable(table: string): string {
  return `"public"."${table.replace(/"/g, '""')}"`
}

function targetCompatibilitySql(tables: readonly string[]): string {
  const requiredTables = tables
    .map((table) => `('${table.replace(/'/g, "''")}')`)
    .join(", ")

  return `WITH required_table(name) AS (VALUES ${requiredTables}), missing_table AS (SELECT name FROM required_table WHERE to_regclass('public.' || quote_ident(name)) IS NULL) SELECT json_build_object('serverVersionNum', current_setting('server_version_num')::integer, 'missingTables', COALESCE((SELECT json_agg(name ORDER BY name) FROM missing_table), '[]'::json), 'vectorExtensionInstalled', EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector'), 'vectorTypeAvailable', to_regtype('public.vector') IS NOT NULL)::text;`
}

const PRISMA_ONLY_POSTGRES_QUERY_KEYS = [
  "connection_limit",
  "pool_timeout",
  "schema",
] as const

function normalizeNativePostgresUrl(
  value: string,
  role: "source" | "target",
): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new VideoDbBackupError(`Invalid PostgreSQL ${role} connection URL`)
  }

  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new VideoDbBackupError(
      `Invalid PostgreSQL ${role} connection URL: expected postgres: or postgresql:`,
    )
  }

  for (const key of PRISMA_ONLY_POSTGRES_QUERY_KEYS) {
    url.searchParams.delete(key)
  }
  return url.toString()
}

export function buildBackupPlan(
  parsed: ParsedArgs,
  env: DatabaseUrlEnv & BackupStorageEnv = {
    ...currentDatabaseUrlEnv(),
    RAILWAY_S3_BUCKET: process.env.RAILWAY_S3_BUCKET,
    RAILWAY_S3_ENDPOINT: process.env.RAILWAY_S3_ENDPOINT,
    RAILWAY_S3_REGION: process.env.RAILWAY_S3_REGION,
    RAILWAY_S3_ACCESS_KEY_ID: process.env.RAILWAY_S3_ACCESS_KEY_ID,
    RAILWAY_S3_SECRET_ACCESS_KEY: process.env.RAILWAY_S3_SECRET_ACCESS_KEY,
  },
): BackupPlan {
  const selectedSource = env.SOURCE_DATABASE_URL ?? env.DATABASE_URL
  if (!selectedSource) {
    throw new VideoDbBackupError(
      "SOURCE_DATABASE_URL or DATABASE_URL is required for backup",
    )
  }
  const source = normalizeNativePostgresUrl(selectedSource, "source")

  const outPath = resolvePath(parsed.outPath ?? defaultOutPath(parsed.profile))
  const tables = [...VIDEO_DB_BACKUP_PROFILES[parsed.profile]]
  const upload = resolveBackupUploadPlan(parsed, outPath, env)

  return {
    mode: "backup",
    profile: parsed.profile,
    source,
    outPath,
    generatedOutPath: parsed.outPath === undefined,
    upload,
    tables,
    commands: [
      {
        command: "pg_dump",
        args: [
          "--format=custom",
          "--data-only",
          "--no-owner",
          "--no-acl",
          "--dbname",
          source,
          "--file",
          outPath,
          ...tableArgs(tables),
        ],
      },
    ],
  }
}

export function resolveBackupUploadPlan(
  parsed: ParsedArgs,
  outPath: string,
  env: BackupStorageEnv,
): BackupUploadPlan | undefined {
  const bucket = env.RAILWAY_S3_BUCKET

  if (!bucket) {
    return undefined
  }

  const accessKeyId = env.RAILWAY_S3_ACCESS_KEY_ID
  const secretAccessKey = env.RAILWAY_S3_SECRET_ACCESS_KEY
  if (!accessKeyId || !secretAccessKey) {
    throw new VideoDbBackupError(
      "S3 upload requires RAILWAY_S3_ACCESS_KEY_ID and RAILWAY_S3_SECRET_ACCESS_KEY when RAILWAY_S3_BUCKET is set",
    )
  }

  return {
    bucket,
    key: buildBackupObjectKey(parsed.profile, outPath, parsed.s3Key, env),
    endpoint: env.RAILWAY_S3_ENDPOINT,
    region: env.RAILWAY_S3_REGION ?? "auto",
    accessKeyId,
    secretAccessKey,
  }
}

function requireBackupStoragePlan(
  parsed: ParsedArgs,
  outPath: string,
  env: BackupStorageEnv = currentBackupStorageEnv(),
): BackupUploadPlan {
  const plan = resolveBackupUploadPlan(parsed, outPath, env)
  if (!plan) {
    throw new VideoDbBackupError(
      "RAILWAY_S3_BUCKET is required to download the latest video DB backup",
    )
  }
  return plan
}

export function buildRestorePlan(
  parsed: ParsedArgs,
  env: DatabaseUrlEnv = currentDatabaseUrlEnv(),
): RestorePlan {
  const selectedTarget = env.TARGET_DATABASE_URL ?? env.DATABASE_URL
  if (!selectedTarget) {
    throw new VideoDbBackupError(
      "TARGET_DATABASE_URL or DATABASE_URL is required for restore",
    )
  }
  const target = normalizeNativePostgresUrl(selectedTarget, "target")
  if (!parsed.inPath) {
    throw new VideoDbBackupError("--in=<dump path> is required for restore")
  }
  if (parsed.targetEnv === "production" && !parsed.allowProductionTarget) {
    throw new VideoDbBackupError(
      "Refusing production restore without --allow-production-target",
    )
  }

  const inPath = resolvePath(parsed.inPath)
  const tables = [...VIDEO_DB_BACKUP_PROFILES[parsed.profile]]
  const truncateSql = `TRUNCATE TABLE ${tables
    .map(quoteTable)
    .join(", ")} RESTART IDENTITY CASCADE;`

  return {
    mode: "restore",
    profile: parsed.profile,
    target,
    targetEnv: parsed.targetEnv,
    inPath,
    tables,
    preflightCommands: [
      {
        check: "pg-restore-client-version",
        command: "pg_restore",
        args: ["--version"],
      },
      {
        check: "psql-client-version",
        command: "psql",
        args: ["--version"],
      },
      {
        check: "archive-manifest",
        command: "pg_restore",
        args: ["--list", inPath],
      },
      {
        check: "target-compatibility",
        command: "psql",
        args: [
          "--no-align",
          "--tuples-only",
          "--set=ON_ERROR_STOP=1",
          "--dbname",
          target,
          "--command",
          targetCompatibilitySql(tables),
        ],
      },
    ],
    commands: [
      {
        command: "psql",
        args: [
          "--set=ON_ERROR_STOP=1",
          "--dbname",
          target,
          "--command",
          truncateSql,
        ],
      },
      {
        command: "pg_restore",
        args: [
          "--data-only",
          "--no-owner",
          "--no-acl",
          "--single-transaction",
          "--dbname",
          target,
          ...restoreTableArgs(tables),
          inPath,
        ],
      },
    ],
  }
}

function redactUrl(value: string): string {
  try {
    const url = new URL(value)
    if (url.password) url.password = "REDACTED"
    if (url.username) url.username = "REDACTED"
    return url.toString()
  } catch {
    return value.length > 0 ? "[redacted]" : value
  }
}

function printablePlan(plan: BackupPlan | RestorePlan): object {
  const connectionUrl = plan.mode === "backup" ? plan.source : plan.target
  const printableCommand = (command: CommandPlan) => ({
    command: command.command,
    args: command.args.map((arg) =>
      arg === connectionUrl ? redactUrl(arg) : arg,
    ),
    env: command.env
      ? Object.fromEntries(
          Object.entries(command.env).map(([key, value]) => [
            key,
            redactUrl(value),
          ]),
        )
      : undefined,
  })
  const commands = plan.commands.map(printableCommand)

  if (plan.mode === "backup") {
    return {
      event: "video-db.backup.plan",
      profile: plan.profile,
      source: redactUrl(plan.source),
      outPath: plan.outPath,
      upload: plan.upload
        ? {
            bucket: plan.upload.bucket,
            key: plan.upload.key,
            endpoint: plan.upload.endpoint,
            region: plan.upload.region,
          }
        : null,
      tables: plan.tables,
      commands,
    }
  }

  return {
    event: "video-db.restore.plan",
    profile: plan.profile,
    target: redactUrl(plan.target),
    targetEnv: plan.targetEnv,
    inPath: plan.inPath,
    tables: plan.tables,
    preflightCommands: plan.preflightCommands.map((command) => ({
      check: command.check,
      ...printableCommand(command),
    })),
    commands,
  }
}

async function captureCommand(plan: CommandPlan): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(plan.command, plan.args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...plan.env },
    })
    let stdout = ""

    child.stdout?.setEncoding("utf8")
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk
    })
    child.on("error", reject)
    child.on("exit", (code, signal) => {
      if (code === 0) return resolve(stdout)
      reject(
        new Error(
          `${plan.command} exited with ${signal ? `signal ${signal}` : `code ${code ?? "null"}`}`,
        ),
      )
    })
  })
}

function requirePostgres18Client(
  client: "pg_restore" | "psql",
  output: string,
): void {
  const major = Number.parseInt(
    output.match(/PostgreSQL\)\s+(\d+)/)?.[1] ?? "",
    10,
  )
  if (!Number.isInteger(major) || major < 18) {
    throw new VideoDbBackupError(
      `Restore preflight requires ${client} 18 or newer`,
    )
  }
}

function archiveTableDataEntries(manifest: string): string[] {
  return manifest
    .split(/\r?\n/)
    .map(
      (line) =>
        line.match(
          /^\d+;\s+\d+\s+\d+\s+TABLE DATA\s+public\s+(\S+)(?:\s+.*)?$/,
        )?.[1],
    )
    .filter((table): table is string => typeof table === "string")
}

function validateArchiveManifest(plan: RestorePlan, manifest: string): void {
  const entries = archiveTableDataEntries(manifest)
  const actual = new Set(entries)
  const expected = new Set(plan.tables)
  const missing = plan.tables.filter((table) => !actual.has(table))
  const unexpected = [...actual].filter((table) => !expected.has(table))
  const duplicates = [...actual].filter(
    (table) => entries.filter((entry) => entry === table).length > 1,
  )

  if (
    missing.length === 0 &&
    unexpected.length === 0 &&
    duplicates.length === 0
  ) {
    return
  }

  const details = [
    missing.length > 0
      ? `missing TABLE DATA: ${missing.join(", ")}`
      : undefined,
    unexpected.length > 0
      ? `unexpected TABLE DATA: ${unexpected.join(", ")}`
      : undefined,
    duplicates.length > 0
      ? `duplicate TABLE DATA: ${duplicates.join(", ")}`
      : undefined,
  ].filter((detail): detail is string => typeof detail === "string")
  throw new VideoDbBackupError(
    `Restore archive does not match selected profile ${plan.profile}: ${details.join("; ")}`,
  )
}

type TargetCompatibilityState = {
  serverVersionNum: number
  missingTables: string[]
  vectorExtensionInstalled: boolean
  vectorTypeAvailable: boolean
}

function parseTargetCompatibilityState(
  output: string,
): TargetCompatibilityState {
  let value: unknown
  try {
    value = JSON.parse(output.trim())
  } catch {
    throw new VideoDbBackupError(
      "Restore preflight target compatibility output was invalid",
    )
  }

  if (
    typeof value !== "object" ||
    value === null ||
    !("serverVersionNum" in value) ||
    !Number.isInteger(value.serverVersionNum) ||
    !("missingTables" in value) ||
    !Array.isArray(value.missingTables) ||
    !value.missingTables.every((table) => typeof table === "string") ||
    !("vectorExtensionInstalled" in value) ||
    typeof value.vectorExtensionInstalled !== "boolean" ||
    !("vectorTypeAvailable" in value) ||
    typeof value.vectorTypeAvailable !== "boolean"
  ) {
    throw new VideoDbBackupError(
      "Restore preflight target compatibility output was invalid",
    )
  }

  return value as TargetCompatibilityState
}

function validateTargetCompatibility(output: string): void {
  const state = parseTargetCompatibilityState(output)
  if (state.serverVersionNum < 180000) {
    throw new VideoDbBackupError(
      "Restore preflight requires PostgreSQL server 18 or newer",
    )
  }
  if (state.missingTables.length > 0) {
    throw new VideoDbBackupError(
      `Restore target is missing required public tables: ${state.missingTables.join(", ")}`,
    )
  }
  if (!state.vectorExtensionInstalled || !state.vectorTypeAvailable) {
    throw new VideoDbBackupError(
      "Restore target requires the pgvector extension and public.vector type",
    )
  }
}

function captureFailureMessage(check: RestorePreflightCheck): string {
  switch (check) {
    case "pg-restore-client-version":
      return "Restore preflight could not verify the PostgreSQL 18 pg_restore client"
    case "psql-client-version":
      return "Restore preflight could not verify the PostgreSQL 18 psql client"
    case "archive-manifest":
      return "Restore preflight could not read the archive with the PostgreSQL 18 pg_restore client"
    case "target-compatibility":
      return "Restore preflight could not verify target schema, pgvector, and PostgreSQL version prerequisites"
  }
}

async function runRestorePreflight(
  plan: RestorePlan,
  capture: RestorePreflightCapture,
): Promise<void> {
  for (const command of plan.preflightCommands) {
    let output: string
    try {
      output = await capture(command)
    } catch {
      throw new VideoDbBackupError(captureFailureMessage(command.check))
    }

    switch (command.check) {
      case "pg-restore-client-version":
        requirePostgres18Client("pg_restore", output)
        break
      case "psql-client-version":
        requirePostgres18Client("psql", output)
        break
      case "archive-manifest":
        validateArchiveManifest(plan, output)
        break
      case "target-compatibility":
        validateTargetCompatibility(output)
        break
    }
  }
}

async function runCommand(plan: CommandPlan): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(plan.command, plan.args, {
      stdio: "inherit",
      env: { ...process.env, ...plan.env },
    })
    child.on("error", reject)
    child.on("exit", (code, signal) => {
      if (code === 0) return resolve()
      reject(
        new Error(
          `${plan.command} exited with ${signal ? `signal ${signal}` : `code ${code ?? "null"}`}`,
        ),
      )
    })
  })
}

async function runPlan(plan: BackupPlan | RestorePlan): Promise<void> {
  if (plan.mode === "backup") {
    await mkdir(dirname(plan.outPath), { recursive: true })
    if (plan.generatedOutPath) {
      await prepareOwnerOnlyFile(plan.outPath)
    }
  }
  for (const command of plan.commands) {
    await runCommand(command)
  }
}

async function executeBuiltRestorePlan(
  plan: RestorePlan,
  capture: RestorePreflightCapture,
): Promise<void> {
  await runRestorePreflight(plan, capture)
  await runPlan(plan)
}

export async function executeRestorePlan(
  parsed: ParsedArgs,
  env: DatabaseUrlEnv = currentDatabaseUrlEnv(),
  capture: RestorePreflightCapture = captureCommand,
): Promise<RestorePlan> {
  const plan = buildRestorePlan(parsed, env)
  await executeBuiltRestorePlan(plan, capture)
  return plan
}

async function uploadBackup(plan: BackupPlan): Promise<void> {
  if (!plan.upload) return

  const { S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3")

  const body = createReadStream(plan.outPath)
  const s3 = new S3Client({
    endpoint: plan.upload.endpoint,
    region: plan.upload.region,
    credentials: {
      accessKeyId: plan.upload.accessKeyId,
      secretAccessKey: plan.upload.secretAccessKey,
    },
    forcePathStyle: true,
  })

  try {
    await s3.send(
      new PutObjectCommand({
        Bucket: plan.upload.bucket,
        Key: plan.upload.key,
        Body: body,
        ContentType: "application/vnd.postgresql.dump",
      }),
    )
  } finally {
    body.destroy()
    await finished(body).catch(() => undefined)
    s3.destroy()
  }
}

function backupPrefix(profile: VideoDbBackupProfile): string {
  return `admin-video-db-backups/${profile}/`
}

export async function discoverLatestBackupFreshness(
  profile: VideoDbBackupProfile,
  upload: BackupUploadPlan,
): Promise<VideoDbBackupFreshness> {
  const { ListObjectsV2Command, S3Client } = await import("@aws-sdk/client-s3")
  const s3 = new S3Client({
    endpoint: upload.endpoint,
    region: upload.region,
    credentials: {
      accessKeyId: upload.accessKeyId,
      secretAccessKey: upload.secretAccessKey,
    },
    forcePathStyle: true,
  })

  try {
    return await discoverVideoDbBackupFreshnessFromPages(
      async (continuationToken) => {
        const response = await s3.send(
          new ListObjectsV2Command({
            Bucket: upload.bucket,
            Prefix: backupPrefix(profile),
            ContinuationToken: continuationToken,
          }),
        )
        return {
          objects: (response.Contents ?? []).map((object) => ({
            key: object.Key,
            size: object.Size,
            lastModified: object.LastModified,
          })),
          isTruncated: response.IsTruncated,
          nextContinuationToken: response.NextContinuationToken,
        }
      },
    )
  } finally {
    s3.destroy()
  }
}

function requireUsableLatestBackup(
  freshness: VideoDbBackupFreshness,
  allowStale: boolean,
): VideoDbBackupFreshnessAvailable {
  if (freshness.status === "not-found") {
    throw new VideoDbBackupError("No video DB backup objects were found")
  }
  if (freshness.status === "unavailable-metadata") {
    throw new VideoDbBackupError(
      `Video DB backup freshness metadata is unavailable for ${freshness.key}`,
    )
  }
  if (freshness.status === "stale" && !allowStale) {
    throw new VideoDbBackupError(
      `Latest video DB backup ${freshness.key} is older than ${freshness.thresholdHours} hours; pass --allow-stale to acknowledge this restore`,
    )
  }
  return freshness
}

function backupDownloadBaseUrl(env: BackupDownloadSignerEnv): string {
  return (
    env.BACKUP_DOWNLOAD_BASE_URL ?? "https://admin.jesusfilm.org"
  ).replace(/\/+$/g, "")
}

function shouldUseBackupDownloadSigner(
  parsed: ParsedArgs,
  env: BackupDownloadSignerEnv = currentBackupDownloadSignerEnv(),
): boolean {
  return Boolean(env.BACKUP_DOWNLOAD_API_KEY && !parsed.s3Key)
}

async function requestPresignedBackupDownload(
  parsed: ParsedArgs,
  env: BackupDownloadSignerEnv = currentBackupDownloadSignerEnv(),
): Promise<PresignedBackupResponse> {
  const token = env.BACKUP_DOWNLOAD_API_KEY
  if (!token) {
    throw new VideoDbBackupError(
      "BACKUP_DOWNLOAD_API_KEY is required to request a signed backup download",
    )
  }

  const url = `${backupDownloadBaseUrl(env)}/api/internal/video-db-backups/presign`
  const response = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ profile: parsed.profile }),
  })

  if (!response.ok) {
    let message = `Backup download signer returned ${response.status}`
    if (response.status === 404) {
      message = `No video DB backup objects were found for ${parsed.profile}`
    } else if (response.status === 503) {
      message = `Video DB backup freshness metadata is unavailable for ${parsed.profile}`
    }
    throw new VideoDbBackupError(message)
  }

  const payload = (await response.json()) as Partial<PresignedBackupResponse>
  if (
    typeof payload.url !== "string" ||
    typeof payload.key !== "string" ||
    typeof payload.expiresAt !== "string" ||
    typeof payload.expiresInSeconds !== "number" ||
    payload.profile !== parsed.profile ||
    !payload.freshness ||
    (payload.freshness.status !== "fresh" &&
      payload.freshness.status !== "stale") ||
    payload.freshness.key !== payload.key
  ) {
    throw new VideoDbBackupError(
      "Backup download signer returned an invalid response",
    )
  }

  return payload as PresignedBackupResponse
}

type ResolvedBackupDownload =
  | {
      via: "admin-signer"
      key: string
      selection: "latest"
      freshness: VideoDbBackupFreshnessAvailable
      signed: PresignedBackupResponse
    }
  | {
      via: "s3"
      key: string
      selection: "latest" | "explicit-key"
      freshness?: VideoDbBackupFreshnessAvailable
      upload: BackupUploadPlan
    }

async function resolveBackupDownload(
  parsed: ParsedArgs,
  outPath: string,
): Promise<ResolvedBackupDownload> {
  if (shouldUseBackupDownloadSigner(parsed)) {
    const signed = await requestPresignedBackupDownload(parsed)
    return {
      via: "admin-signer",
      key: signed.key,
      selection: "latest",
      freshness: requireUsableLatestBackup(signed.freshness, parsed.allowStale),
      signed,
    }
  }

  const upload = requireBackupStoragePlan(parsed, outPath)
  if (parsed.s3Key) {
    return {
      via: "s3",
      key: normalizeBackupObjectKey(parsed.s3Key),
      selection: "explicit-key",
      upload,
    }
  }

  const freshness = requireUsableLatestBackup(
    await discoverLatestBackupFreshness(parsed.profile, upload),
    parsed.allowStale,
  )
  return {
    via: "s3",
    key: freshness.key,
    selection: "latest",
    freshness,
    upload,
  }
}

async function downloadPresignedBackupObject(
  parsed: ParsedArgs,
  source: Extract<ResolvedBackupDownload, { via: "admin-signer" }>,
): Promise<VideoDbBackupDownloadResult> {
  const outPath = restoreDownloadPath(parsed)
  const response = await fetch(source.signed.url)

  if (!response.ok) {
    throw new VideoDbBackupError(
      `Signed backup download returned ${response.status}`,
    )
  }
  if (!response.body) {
    throw new VideoDbBackupError("Signed backup download body was not readable")
  }

  await prepareOwnerOnlyFile(outPath)
  await pipeline(
    Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]),
    createWriteStream(outPath),
  )

  const result: VideoDbBackupDownloadResult = {
    event: "video-db.backup.download.complete",
    profile: parsed.profile,
    key: source.key,
    path: outPath,
    selection: source.selection,
    size: source.signed.size,
    lastModified: source.freshness.lastModified,
    freshness: source.freshness,
  }
  process.stdout.write(`${JSON.stringify(result)}\n`)
  return result
}

async function downloadBackupObject(
  parsed: ParsedArgs,
): Promise<VideoDbBackupDownloadResult> {
  const outPath = restoreDownloadPath(parsed)
  const source = await resolveBackupDownload(parsed, outPath)
  if (source.via === "admin-signer") {
    return downloadPresignedBackupObject(parsed, source)
  }

  const { GetObjectCommand, S3Client } = await import("@aws-sdk/client-s3")
  const s3 = new S3Client({
    endpoint: source.upload.endpoint,
    region: source.upload.region,
    credentials: {
      accessKeyId: source.upload.accessKeyId,
      secretAccessKey: source.upload.secretAccessKey,
    },
    forcePathStyle: true,
  })

  try {
    const response = await s3.send(
      new GetObjectCommand({
        Bucket: source.upload.bucket,
        Key: source.key,
      }),
    )
    if (!response.Body || !("pipe" in response.Body)) {
      throw new VideoDbBackupError("Downloaded backup body was not readable")
    }

    await prepareOwnerOnlyFile(outPath)
    await pipeline(
      response.Body as NodeJS.ReadableStream,
      createWriteStream(outPath),
    )

    const result: VideoDbBackupDownloadResult = {
      event: "video-db.backup.download.complete",
      profile: parsed.profile,
      bucket: source.upload.bucket,
      key: source.key,
      path: outPath,
      selection: source.selection,
      size: source.freshness?.size ?? response.ContentLength,
      lastModified: source.freshness?.lastModified,
      freshness: source.freshness,
    }
    process.stdout.write(`${JSON.stringify(result)}\n`)
    return result
  } finally {
    s3.destroy()
  }
}

function restoreDownloadPath(parsed: ParsedArgs): string {
  return resolvePath(
    parsed.outPath ?? defaultRestoreDownloadPath(parsed.profile),
  )
}

export async function executeBackupPlan(
  parsed: ParsedArgs,
  env?: DatabaseUrlEnv & BackupStorageEnv,
): Promise<VideoDbBackupJobResult> {
  const plan = buildBackupPlan(parsed, env)
  process.stdout.write(`${JSON.stringify(printablePlan(plan))}\n`)

  if (parsed.dryRun) {
    const result: VideoDbBackupJobResult = {
      event: "video-db.backup.dry-run-complete",
      profile: plan.profile,
      tables: plan.tables.length,
      path: plan.outPath,
      upload: plan.upload
        ? { bucket: plan.upload.bucket, key: plan.upload.key }
        : undefined,
    }
    process.stdout.write(`${JSON.stringify(result)}\n`)
    return result
  }

  try {
    await runPlan(plan)
    const dumpSize = (await stat(plan.outPath)).size
    process.stdout.write(
      `${JSON.stringify({
        event: "video-db.backup.dump.complete",
        profile: plan.profile,
        path: plan.outPath,
        size: dumpSize,
      })}\n`,
    )

    await uploadBackup(plan)

    const result: VideoDbBackupJobResult = {
      event: "video-db.backup.complete",
      profile: plan.profile,
      tables: plan.tables.length,
      path: plan.outPath,
      size: dumpSize,
      upload: plan.upload
        ? { bucket: plan.upload.bucket, key: plan.upload.key }
        : undefined,
    }
    process.stdout.write(`${JSON.stringify(result)}\n`)
    return result
  } finally {
    if (plan.generatedOutPath) {
      await rm(plan.outPath, { force: true })
    }
  }
}

export async function runScheduledVideoDbBackup(
  profile: VideoDbBackupProfile = "video-core",
): Promise<VideoDbBackupJobResult> {
  return executeBackupPlan(parseArgs("backup", [`--profile=${profile}`]))
}

export async function main(
  command: "restore",
  argv: readonly string[] = process.argv.slice(2),
): Promise<void> {
  const parsed = parseArgs(command, argv)
  const plan = buildRestorePlan(parsed)

  process.stdout.write(`${JSON.stringify(printablePlan(plan))}\n`)

  if (parsed.dryRun) {
    process.stdout.write(
      `${JSON.stringify({ event: "video-db.restore.dry-run-complete" })}\n`,
    )
    return
  }

  await executeBuiltRestorePlan(plan, captureCommand)
  process.stdout.write(
    `${JSON.stringify({
      event: "video-db.restore.complete",
      profile: plan.profile,
      tables: plan.tables.length,
      path: plan.inPath,
    })}\n`,
  )
}

export async function restoreLatestMain(
  argv: readonly string[] = process.argv.slice(2),
): Promise<void> {
  const parsed = parseArgs("restore", argv)
  const generatedOutPath = parsed.outPath === undefined
  const outPath = restoreDownloadPath(parsed)

  try {
    if (parsed.dryRun) {
      const download = await resolveBackupDownload(parsed, outPath)
      const restorePlan = buildRestorePlan(
        parseArgs("restore", [...argv, `--in=${outPath}`]),
      )

      process.stdout.write(
        `${JSON.stringify({
          event: "video-db.restore-latest.plan",
          profile: parsed.profile,
          download: {
            via: download.via,
            bucket: download.via === "s3" ? download.upload.bucket : undefined,
            key: download.key,
            path: outPath,
            selection: download.selection,
            freshness: download.freshness,
            expiresAt:
              download.via === "admin-signer"
                ? download.signed.expiresAt
                : undefined,
          },
          restore: printablePlan(restorePlan),
        })}\n`,
      )
      process.stdout.write(
        `${JSON.stringify({ event: "video-db.restore-latest.dry-run-complete" })}\n`,
      )
      return
    }

    const download = await downloadBackupObject(parsed)
    await main("restore", [...argv, `--in=${download.path}`])
  } finally {
    if (generatedOutPath && !parsed.dryRun) {
      await rm(outPath, { force: true })
    }
  }
}

const invokedPath = typeof process.argv[1] === "string" ? process.argv[1] : ""
if (import.meta.url === `file://${invokedPath}`) {
  process.stderr.write(
    "[video-db-backup] Backup is scheduled-only. Use pnpm --filter @forge/admin restore:video-db for restores.\n",
  )
  process.exit(1)
}
