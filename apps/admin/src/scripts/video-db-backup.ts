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
import { mkdir, rm, stat } from "node:fs/promises"
import { dirname, resolve as resolvePath } from "node:path"
import { performance } from "node:perf_hooks"
import { Readable } from "node:stream"
import { finished, pipeline } from "node:stream/promises"

import {
  type BackupDownloadSignerEnv,
  type BackupPlan,
  type BackupPreflightCommandPlan,
  type BackupPreflightCapture,
  type BackupStorageEnv,
  type BackupUploadPlan,
  type CommandPlan,
  type DatabaseUrlEnv,
  type ParsedArgs,
  type PresignedBackupResponse,
  type RestorePlan,
  type RestorePreflightCapture,
  type RestorePreflightCheck,
  type VideoDbBackupDownloadResult,
  type VideoDbBackupFreshness,
  type VideoDbBackupFreshnessAvailable,
  type VideoDbBackupJobResult,
  type VideoDbBackupProfile,
  VideoDbBackupError,
  buildBackupPlan,
  buildRestorePlan,
  currentBackupDownloadSignerEnv,
  currentDatabaseUrlEnv,
  defaultRestoreDownloadPath,
  discoverVideoDbBackupFreshnessFromPages,
  elapsedMilliseconds,
  normalizeBackupObjectKey,
  parseArgs,
  prepareOwnerOnlyFile,
  requireBackupStoragePlan,
} from "./video-db-backup-core"

export * from "./video-db-backup-core"

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
      preflightCommands: plan.preflightCommands.map((command) => ({
        check: command.check,
        ...printableCommand(command),
      })),
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
      stdio: ["ignore", "pipe", "ignore"],
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

async function captureBackupSourceCompatibility(
  plan: BackupPreflightCommandPlan,
): Promise<string> {
  const databaseIndex = plan.args.indexOf("--dbname")
  const commandIndex = plan.args.indexOf("--command")
  const connectionString = plan.args[databaseIndex + 1]
  const query = plan.args[commandIndex + 1]
  if (typeof connectionString !== "string" || typeof query !== "string") {
    throw new VideoDbBackupError(
      "Backup preflight source compatibility plan was invalid",
    )
  }

  const authorityStart = connectionString.indexOf("://") + 3
  const authorityEnd = connectionString.indexOf("/", authorityStart)
  const authority = connectionString.slice(
    authorityStart,
    authorityEnd >= 0 ? authorityEnd : connectionString.length,
  )
  const hostList = authority.slice(authority.lastIndexOf("@") + 1)
  if (hostList.includes(",")) {
    return captureCommand({ ...plan, command: "psql" })
  }

  const { Client } = await import("pg")
  const client = new Client({ connectionString })
  try {
    await client.connect()
    const result = await client.query<{ compatibility: string }>(query)
    const output = result.rows[0]?.compatibility
    if (typeof output !== "string") {
      throw new VideoDbBackupError(
        "Backup preflight source compatibility output was invalid",
      )
    }
    return output
  } finally {
    await client.end()
  }
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
  requiredMigrationApplied: boolean
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
    typeof value.vectorTypeAvailable !== "boolean" ||
    !("requiredMigrationApplied" in value) ||
    typeof value.requiredMigrationApplied !== "boolean"
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
  if (!state.requiredMigrationApplied) {
    throw new VideoDbBackupError(
      "Restore target must have migration 0047_video_locale_search_social_metadata applied",
    )
  }
}

type SourceProfileCompatibilityState = {
  externalSocialImageReferences: number
}

function validateSourceProfileCompatibility(output: string): void {
  let value: unknown
  try {
    value = JSON.parse(output.trim())
  } catch {
    throw new VideoDbBackupError(
      "Backup preflight source compatibility output was invalid",
    )
  }

  if (
    typeof value !== "object" ||
    value === null ||
    !("externalSocialImageReferences" in value) ||
    !Number.isInteger(value.externalSocialImageReferences)
  ) {
    throw new VideoDbBackupError(
      "Backup preflight source compatibility output was invalid",
    )
  }

  const state = value as SourceProfileCompatibilityState
  if (state.externalSocialImageReferences > 0) {
    throw new VideoDbBackupError(
      "Video DB backup profile excludes editorial media assets but the source has video locale social image references",
    )
  }
}

async function runBackupPreflight(
  plan: BackupPlan,
  capture: BackupPreflightCapture,
): Promise<void> {
  for (const command of plan.preflightCommands) {
    let output: string
    try {
      output = await capture(command)
    } catch {
      throw new VideoDbBackupError(
        "Backup preflight could not verify source profile compatibility",
      )
    }
    validateSourceProfileCompatibility(output)
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
    case "archive-payload":
      return "Restore preflight could not decode the selected archive payload"
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
      case "archive-payload":
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
    let errorCode: string | undefined
    try {
      const errorPayload = (await response.json()) as { error?: unknown }
      if (typeof errorPayload.error === "string") {
        errorCode = errorPayload.error
      }
    } catch {
      // Keep the status-only fallback for malformed or non-JSON responses.
    }
    switch (errorCode) {
      case "backup-not-found":
        message = `No video DB backup objects were found for ${parsed.profile}`
        break
      case "backup-freshness-unavailable":
        message = `Video DB backup freshness metadata is unavailable for ${parsed.profile}`
        break
      case "backup-storage-not-configured":
        message = "Video DB backup storage is not configured"
        break
      case "backup-storage-unavailable":
        message = "Video DB backup storage is unavailable"
        break
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
    const exportStartedAt = performance.now()
    await runBackupPreflight(plan, captureBackupSourceCompatibility)
    await runPlan(plan)
    const exportDurationMs = elapsedMilliseconds(exportStartedAt)
    const dumpSize = (await stat(plan.outPath)).size
    process.stdout.write(
      `${JSON.stringify({
        event: "video-db.backup.dump.complete",
        profile: plan.profile,
        path: plan.outPath,
        size: dumpSize,
        exportDurationMs,
      })}\n`,
    )

    let uploadDurationMs: number | undefined
    if (plan.upload) {
      const uploadStartedAt = performance.now()
      try {
        await uploadBackup(plan)
      } catch (error) {
        uploadDurationMs = elapsedMilliseconds(uploadStartedAt)
        process.stdout.write(
          `${JSON.stringify({
            event: "video-db.backup.upload.failed",
            profile: plan.profile,
            bucket: plan.upload.bucket,
            key: plan.upload.key,
            size: dumpSize,
            exportDurationMs,
            uploadDurationMs,
          })}\n`,
        )
        throw error
      }
      uploadDurationMs = elapsedMilliseconds(uploadStartedAt)
    }

    const result: VideoDbBackupJobResult = {
      event: "video-db.backup.complete",
      profile: plan.profile,
      tables: plan.tables.length,
      path: plan.outPath,
      size: dumpSize,
      exportDurationMs,
      uploadDurationMs,
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

  const restoreStartedAt = performance.now()
  await executeBuiltRestorePlan(plan, captureCommand)
  process.stdout.write(
    `${JSON.stringify({
      event: "video-db.restore.complete",
      profile: plan.profile,
      tables: plan.tables.length,
      path: plan.inPath,
      restoreDurationMs: elapsedMilliseconds(restoreStartedAt),
    })}\n`,
  )
}

export async function restoreLatestMain(
  argv: readonly string[] = process.argv.slice(2),
): Promise<void> {
  if (argv.some((arg) => arg.startsWith("--in="))) {
    throw new VideoDbBackupError(
      "restore:video-db:latest does not accept --in; it restores the verified downloaded snapshot",
    )
  }
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
