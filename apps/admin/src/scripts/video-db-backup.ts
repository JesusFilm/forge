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
import { mkdir } from "node:fs/promises"
import { basename, dirname, resolve as resolvePath } from "node:path"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"

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
  dryRun: boolean
}

type CommandPlan = {
  command: string
  args: string[]
  env?: Record<string, string>
}

type LibpqConnectionConfig = {
  database: string
  env: Record<string, string>
}

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
  commands: CommandPlan[]
}

export type VideoDbBackupJobResult = {
  event: "video-db.backup.complete" | "video-db.backup.dry-run-complete"
  profile: VideoDbBackupProfile
  tables: number
  path: string
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
  size?: number
  lastModified?: string
}

type PresignedBackupResponse = {
  url: string
  profile: VideoDbBackupProfile
  key: string
  expiresAt: string
  expiresInSeconds: number
  size?: number
  lastModified?: string
}

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

export function buildBackupObjectKey(
  profile: VideoDbBackupProfile,
  outPath: string,
  keyOverride: string | undefined,
  _env: BackupStorageEnv,
): string {
  if (keyOverride) return keyOverride.replace(/^\/+/, "")

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

function decodeUrlPart(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function libpqConnectionConfigFromUrl(rawUrl: string): LibpqConnectionConfig {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new VideoDbBackupError("Database URL is not a parseable URL")
  }

  const database = decodeUrlPart(url.pathname.replace(/^\/+/, ""))
  if (!database) {
    throw new VideoDbBackupError("Database URL must include a database name")
  }

  const env: Record<string, string> = {
    PGDATABASE: database,
  }
  if (url.hostname) env.PGHOST = url.hostname
  if (url.port) env.PGPORT = url.port
  if (url.username) env.PGUSER = decodeUrlPart(url.username)
  if (url.password) env.PGPASSWORD = decodeUrlPart(url.password)

  const supportedQueryEnv = {
    application_name: "PGAPPNAME",
    connect_timeout: "PGCONNECT_TIMEOUT",
    sslcert: "PGSSLCERT",
    sslkey: "PGSSLKEY",
    sslmode: "PGSSLMODE",
    sslrootcert: "PGSSLROOTCERT",
    target_session_attrs: "PGTARGETSESSIONATTRS",
  } as const
  for (const [parameter, envKey] of Object.entries(supportedQueryEnv)) {
    const value = url.searchParams.get(parameter)
    if (value) env[envKey] = value
  }

  return { database, env }
}

function quoteTable(table: string): string {
  return `"public"."${table.replace(/"/g, '""')}"`
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
  const source = env.SOURCE_DATABASE_URL ?? env.DATABASE_URL
  if (!source) {
    throw new VideoDbBackupError(
      "SOURCE_DATABASE_URL or DATABASE_URL is required for backup",
    )
  }

  const outPath = resolvePath(parsed.outPath ?? defaultOutPath(parsed.profile))
  const tables = [...VIDEO_DB_BACKUP_PROFILES[parsed.profile]]
  const upload = resolveBackupUploadPlan(parsed, outPath, env)
  const connection = libpqConnectionConfigFromUrl(source)

  return {
    mode: "backup",
    profile: parsed.profile,
    source,
    outPath,
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
          connection.database,
          "--file",
          outPath,
          ...tableArgs(tables),
        ],
        env: connection.env,
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
  const target = env.TARGET_DATABASE_URL ?? env.DATABASE_URL
  if (!target) {
    throw new VideoDbBackupError(
      "TARGET_DATABASE_URL or DATABASE_URL is required for restore",
    )
  }
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
  const commands = plan.commands.map((command) => ({
    command: command.command,
    args: command.args.map((arg) =>
      arg === connectionUrl ? redactUrl(arg) : arg,
    ),
    env: command.env
      ? Object.fromEntries(
          Object.entries(command.env)
            .filter(([key]) => key !== "PGPASSWORD")
            .map(([key, value]) => [key, redactUrl(value)]),
        )
      : undefined,
  }))

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
    commands,
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
  }
  for (const command of plan.commands) {
    await runCommand(command)
  }
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
    s3.destroy()
  }
}

function backupPrefix(profile: VideoDbBackupProfile): string {
  return `admin-video-db-backups/${profile}/`
}

export async function findLatestBackupObject(
  profile: VideoDbBackupProfile,
  upload: BackupUploadPlan,
): Promise<{ key: string; size?: number; lastModified?: Date }> {
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
    const response = await s3.send(
      new ListObjectsV2Command({
        Bucket: upload.bucket,
        Prefix: backupPrefix(profile),
      }),
    )
    const latest = (response.Contents ?? [])
      .filter((object) => object.Key?.endsWith(".dump"))
      .sort(
        (left, right) =>
          (right.LastModified?.getTime() ?? 0) -
          (left.LastModified?.getTime() ?? 0),
      )[0]

    if (!latest?.Key) {
      throw new VideoDbBackupError(
        `No video DB backup objects found under ${backupPrefix(profile)}`,
      )
    }

    return {
      key: latest.Key,
      size: latest.Size,
      lastModified: latest.LastModified,
    }
  } finally {
    s3.destroy()
  }
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
    let body = ""
    try {
      body = await response.text()
    } catch {
      body = ""
    }
    throw new VideoDbBackupError(
      `Backup download signer returned ${response.status}${body ? `: ${body}` : ""}`,
    )
  }

  const payload = (await response.json()) as Partial<PresignedBackupResponse>
  if (
    typeof payload.url !== "string" ||
    typeof payload.key !== "string" ||
    typeof payload.expiresAt !== "string" ||
    typeof payload.expiresInSeconds !== "number" ||
    payload.profile !== parsed.profile
  ) {
    throw new VideoDbBackupError(
      "Backup download signer returned an invalid response",
    )
  }

  return payload as PresignedBackupResponse
}

async function downloadPresignedBackupObject(
  parsed: ParsedArgs,
): Promise<VideoDbBackupDownloadResult> {
  const outPath = restoreDownloadPath(parsed)
  const signed = await requestPresignedBackupDownload(parsed)
  const response = await fetch(signed.url)

  if (!response.ok) {
    throw new VideoDbBackupError(
      `Signed backup download returned ${response.status}`,
    )
  }
  if (!response.body) {
    throw new VideoDbBackupError("Signed backup download body was not readable")
  }

  await mkdir(dirname(outPath), { recursive: true })
  await pipeline(
    Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]),
    createWriteStream(outPath),
  )

  const result: VideoDbBackupDownloadResult = {
    event: "video-db.backup.download.complete",
    profile: parsed.profile,
    key: signed.key,
    path: outPath,
    size: signed.size,
    lastModified: signed.lastModified,
  }
  process.stdout.write(`${JSON.stringify(result)}\n`)
  return result
}

async function downloadBackupObject(
  parsed: ParsedArgs,
): Promise<VideoDbBackupDownloadResult> {
  if (shouldUseBackupDownloadSigner(parsed)) {
    return downloadPresignedBackupObject(parsed)
  }

  const outPath = restoreDownloadPath(parsed)
  const upload = requireBackupStoragePlan(parsed, outPath)
  const object = parsed.s3Key
    ? { key: parsed.s3Key.replace(/^\/+/, "") }
    : await findLatestBackupObject(parsed.profile, upload)

  const { GetObjectCommand, S3Client } = await import("@aws-sdk/client-s3")
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
    await mkdir(dirname(outPath), { recursive: true })
    const response = await s3.send(
      new GetObjectCommand({
        Bucket: upload.bucket,
        Key: object.key,
      }),
    )
    if (!response.Body || !("pipe" in response.Body)) {
      throw new VideoDbBackupError("Downloaded backup body was not readable")
    }

    await pipeline(
      response.Body as NodeJS.ReadableStream,
      createWriteStream(outPath),
    )

    const result: VideoDbBackupDownloadResult = {
      event: "video-db.backup.download.complete",
      profile: parsed.profile,
      bucket: upload.bucket,
      key: object.key,
      path: outPath,
      size: object.size ?? response.ContentLength,
      lastModified: object.lastModified?.toISOString(),
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

async function executeBackupPlan(
  parsed: ParsedArgs,
): Promise<VideoDbBackupJobResult> {
  const plan = buildBackupPlan(parsed)
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

  await runPlan(plan)
  await uploadBackup(plan)

  const result: VideoDbBackupJobResult = {
    event: "video-db.backup.complete",
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

  await runPlan(plan)
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
  if (parsed.dryRun) {
    const outPath = restoreDownloadPath(parsed)
    const signed = shouldUseBackupDownloadSigner(parsed)
      ? await requestPresignedBackupDownload(parsed)
      : null
    let upload: BackupUploadPlan | null = null
    let object: { key: string }
    if (signed) {
      object = { key: signed.key }
    } else {
      upload = requireBackupStoragePlan(parsed, outPath)
      object = parsed.s3Key
        ? { key: parsed.s3Key.replace(/^\/+/, "") }
        : await findLatestBackupObject(parsed.profile, upload)
    }
    const restorePlan = buildRestorePlan(
      parseArgs("restore", [...argv, `--in=${outPath}`]),
    )

    process.stdout.write(
      `${JSON.stringify({
        event: "video-db.restore-latest.plan",
        profile: parsed.profile,
        download: {
          via: signed ? "admin-signer" : "s3",
          bucket: upload?.bucket,
          key: object.key,
          path: outPath,
          expiresAt: signed?.expiresAt,
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
}

const invokedPath = typeof process.argv[1] === "string" ? process.argv[1] : ""
if (import.meta.url === `file://${invokedPath}`) {
  process.stderr.write(
    "[video-db-backup] Backup is scheduled-only. Use pnpm --filter @forge/admin restore:video-db for restores.\n",
  )
  process.exit(1)
}
