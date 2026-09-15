import { mkdir, open } from "node:fs/promises"
import { basename, dirname, resolve as resolvePath } from "node:path"
import { performance } from "node:perf_hooks"
import { VideoDbBackupError } from "@/services/video-db-backup/errors"
import type { VideoDbBackupFreshnessAvailable } from "@/services/video-db-backup/freshness"
import {
  VIDEO_DB_BACKUP_PROFILES,
  type VideoDbBackupProfile,
} from "@/services/video-db-backup/profiles"

export { VideoDbBackupError } from "@/services/video-db-backup/errors"
export * from "@/services/video-db-backup/freshness"
export {
  SCHEDULED_VIDEO_DB_BACKUP_PROFILES,
  VIDEO_DB_BACKUP_PROFILES,
  type VideoDbBackupJobResult,
  type VideoDbBackupProfile,
} from "@/services/video-db-backup/profiles"

export type TargetEnvironment = "development" | "staging" | "production"

export type ParsedArgs = {
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

export type CommandPlan = {
  command: string
  args: string[]
  env?: Record<string, string>
}

export type BackupPreflightCheck = "source-profile-compatibility"

export type BackupPreflightCommandPlan = CommandPlan & {
  check: BackupPreflightCheck
}

export type BackupPreflightCapture = (
  plan: BackupPreflightCommandPlan,
) => Promise<string>

export type RestorePreflightCheck =
  | "pg-restore-client-version"
  | "psql-client-version"
  | "archive-manifest"
  | "archive-payload"
  | "target-compatibility"

export type RestorePreflightCommandPlan = CommandPlan & {
  check: RestorePreflightCheck
}

export type RestorePreflightCapture = (
  plan: RestorePreflightCommandPlan,
) => Promise<string>

export type DatabaseUrlEnv = {
  SOURCE_DATABASE_URL?: string
  TARGET_DATABASE_URL?: string
  DATABASE_URL?: string
}

export type BackupStorageEnv = {
  RAILWAY_S3_BUCKET?: string
  RAILWAY_S3_ENDPOINT?: string
  RAILWAY_S3_REGION?: string
  RAILWAY_S3_ACCESS_KEY_ID?: string
  RAILWAY_S3_SECRET_ACCESS_KEY?: string
}

export type BackupDownloadSignerEnv = {
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
  preflightCommands: BackupPreflightCommandPlan[]
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

export type PresignedBackupResponse = {
  url: string
  profile: VideoDbBackupProfile
  key: string
  expiresAt: string
  expiresInSeconds: number
  size?: number
  lastModified?: string
  freshness: VideoDbBackupFreshnessAvailable
}

export function elapsedMilliseconds(startedAt: number): number {
  return Math.max(0, Math.round(performance.now() - startedAt))
}

function readFlag(args: readonly string[], name: string): string | undefined {
  const prefix = `--${name}=`
  const match = args.find((arg) => arg.startsWith(prefix))
  return match?.slice(prefix.length)
}

function hasFlag(args: readonly string[], name: string): boolean {
  return args.includes(`--${name}`)
}

export function currentDatabaseUrlEnv(): DatabaseUrlEnv {
  return {
    SOURCE_DATABASE_URL: process.env.SOURCE_DATABASE_URL,
    TARGET_DATABASE_URL: process.env.TARGET_DATABASE_URL,
    DATABASE_URL: process.env.DATABASE_URL,
  }
}

export function currentBackupStorageEnv(): BackupStorageEnv {
  return {
    RAILWAY_S3_BUCKET: process.env.RAILWAY_S3_BUCKET,
    RAILWAY_S3_ENDPOINT: process.env.RAILWAY_S3_ENDPOINT,
    RAILWAY_S3_REGION: process.env.RAILWAY_S3_REGION,
    RAILWAY_S3_ACCESS_KEY_ID: process.env.RAILWAY_S3_ACCESS_KEY_ID,
    RAILWAY_S3_SECRET_ACCESS_KEY: process.env.RAILWAY_S3_SECRET_ACCESS_KEY,
  }
}

export function currentBackupDownloadSignerEnv(): BackupDownloadSignerEnv {
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

export function defaultRestoreDownloadPath(
  profile: VideoDbBackupProfile,
): string {
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

export function normalizeBackupObjectKey(key: string): string {
  return key.replace(/^\/+/, "")
}

export async function prepareOwnerOnlyFile(path: string): Promise<void> {
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

  return `WITH required_table(name) AS (VALUES ${requiredTables}), missing_table AS (SELECT name FROM required_table WHERE to_regclass('public.' || quote_ident(name)) IS NULL) SELECT json_build_object('serverVersionNum', current_setting('server_version_num')::integer, 'missingTables', COALESCE((SELECT json_agg(name ORDER BY name) FROM missing_table), '[]'::json), 'vectorExtensionInstalled', EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector'), 'vectorTypeAvailable', to_regtype('public.vector') IS NOT NULL, 'requiredMigrationApplied', EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name = '0047_video_locale_search_social_metadata' AND finished_at IS NOT NULL AND rolled_back_at IS NULL))::text;`
}

function sourceProfileCompatibilitySql(): string {
  return "SELECT json_build_object('externalSocialImageReferences', COUNT(*) FILTER (WHERE social_image_asset_id IS NOT NULL))::text AS compatibility FROM public.video_locale;"
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
  const scheme = value.match(/^([a-z][a-z0-9+.-]*):\/\//i)?.[1]?.toLowerCase()
  if (scheme !== "postgres" && scheme !== "postgresql") {
    throw new VideoDbBackupError(
      `Invalid PostgreSQL ${role} connection URL: expected postgres: or postgresql:`,
    )
  }

  const queryStart = value.indexOf("?")
  const authorityEndCandidates = [
    value.indexOf("/", value.indexOf("://") + 3),
    queryStart,
    value.indexOf("#"),
  ].filter((index) => index >= 0)
  const authorityEnd =
    authorityEndCandidates.length > 0
      ? Math.min(...authorityEndCandidates)
      : value.length
  const authority = value.slice(value.indexOf("://") + 3, authorityEnd)
  if (
    authority.length === 0 ||
    /\s/.test(value) ||
    (authority.match(/\[/g)?.length ?? 0) !==
      (authority.match(/\]/g)?.length ?? 0)
  ) {
    throw new VideoDbBackupError(`Invalid PostgreSQL ${role} connection URL`)
  }

  if (queryStart < 0) return value

  const fragmentStart = value.indexOf("#", queryStart + 1)
  const queryEnd = fragmentStart >= 0 ? fragmentStart : value.length
  const query = value.slice(queryStart + 1, queryEnd)
  const retained: string[] = []

  for (const part of query.split("&")) {
    const rawKey = part.slice(
      0,
      part.indexOf("=") >= 0 ? part.indexOf("=") : part.length,
    )
    let key: string
    try {
      key = decodeURIComponent(rawKey)
    } catch {
      throw new VideoDbBackupError(`Invalid PostgreSQL ${role} connection URL`)
    }
    if (
      PRISMA_ONLY_POSTGRES_QUERY_KEYS.includes(
        key as (typeof PRISMA_ONLY_POSTGRES_QUERY_KEYS)[number],
      )
    ) {
      continue
    }
    retained.push(part)
  }

  const suffix = fragmentStart >= 0 ? value.slice(fragmentStart) : ""
  return `${value.slice(0, queryStart)}${
    retained.length > 0 ? `?${retained.join("&")}` : ""
  }${suffix}`
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
  if (parsed.outPath === undefined && !upload) {
    throw new VideoDbBackupError(
      "RAILWAY_S3_BUCKET is required for scheduled video DB backups",
    )
  }

  return {
    mode: "backup",
    profile: parsed.profile,
    source,
    outPath,
    generatedOutPath: parsed.outPath === undefined,
    upload,
    tables,
    preflightCommands: [
      {
        check: "source-profile-compatibility",
        command: "source-compatibility-check",
        args: [
          "--no-align",
          "--tuples-only",
          "--set=ON_ERROR_STOP=1",
          "--dbname",
          source,
          "--command",
          sourceProfileCompatibilitySql(),
        ],
      },
    ],
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

export function requireBackupStoragePlan(
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
        check: "archive-payload",
        command: "pg_restore",
        args: [
          "--data-only",
          "--no-owner",
          "--no-acl",
          "--file=/dev/null",
          ...restoreTableArgs(tables),
          inPath,
        ],
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
