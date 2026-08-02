import { spawnSync } from "node:child_process"
import { EventEmitter } from "node:events"
import { statSync, writeFileSync } from "node:fs"
import { mkdtemp, readFile, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Readable } from "node:stream"

import { afterEach, describe, expect, it, vi } from "vitest"

const commandMocks = vi.hoisted(() => ({
  spawn: vi.fn(),
}))

const s3Mocks = vi.hoisted(() => ({
  destroy: vi.fn(),
  getObjectCommand: vi.fn((input: unknown) => ({ kind: "get", input })),
  listObjectsV2Command: vi.fn((input: unknown) => ({ kind: "list", input })),
  putObjectCommand: vi.fn((input: unknown) => ({ input })),
  send: vi.fn(),
}))

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>()
  return { ...actual, spawn: commandMocks.spawn }
})

vi.mock("@aws-sdk/client-s3", () => ({
  GetObjectCommand: s3Mocks.getObjectCommand,
  ListObjectsV2Command: s3Mocks.listObjectsV2Command,
  PutObjectCommand: s3Mocks.putObjectCommand,
  S3Client: vi.fn(function S3Client() {
    return { send: s3Mocks.send, destroy: s3Mocks.destroy }
  }),
}))

import {
  SCHEDULED_VIDEO_DB_BACKUP_PROFILES,
  VIDEO_DB_BACKUP_PROFILES,
  VideoDbBackupError,
  buildBackupPlan,
  buildBackupObjectKey,
  buildRestorePlan,
  executeBackupPlan,
  executeRestorePlan,
  main,
  parseArgs,
  parseProfile,
  restoreLatestMain,
} from "./video-db-backup"

afterEach(() => {
  delete process.env.BACKUP_DOWNLOAD_API_KEY
  delete process.env.BACKUP_DOWNLOAD_BASE_URL
  delete process.env.TARGET_DATABASE_URL
  delete process.env.SOURCE_DATABASE_URL
  delete process.env.DATABASE_URL
  delete process.env.RAILWAY_S3_BUCKET
  delete process.env.RAILWAY_S3_ENDPOINT
  delete process.env.RAILWAY_S3_REGION
  delete process.env.RAILWAY_S3_ACCESS_KEY_ID
  delete process.env.RAILWAY_S3_SECRET_ACCESS_KEY
  vi.restoreAllMocks()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

function mockSuccessfulPgDump(contents: Buffer): void {
  commandMocks.spawn.mockImplementation((command: string, args: string[]) => {
    if (command === "pg_dump") {
      const fileIndex = args.indexOf("--file")
      writeFileSync(args[fileIndex + 1] as string, contents)
    }

    const child = new EventEmitter()
    queueMicrotask(() => child.emit("exit", 0, null))
    return child
  })
}

const uploadEnv = {
  SOURCE_DATABASE_URL: "postgresql://user:pass@example.com/prod",
  RAILWAY_S3_BUCKET: "admin-db-backups",
  RAILWAY_S3_ENDPOINT: "https://storage.example.com",
  RAILWAY_S3_REGION: "sjc",
  RAILWAY_S3_ACCESS_KEY_ID: "key",
  RAILWAY_S3_SECRET_ACCESS_KEY: "secret",
} as const

const freshEvaluation = {
  status: "fresh" as const,
  key: "admin-video-db-backups/video-core/latest.dump",
  lastModified: "2026-05-14T00:00:00.000Z",
  ageMilliseconds: 24 * 60 * 60 * 1000,
  evaluatedAt: "2026-05-15T00:00:00.000Z",
  thresholdHours: 36,
  thresholdMilliseconds: 36 * 60 * 60 * 1000,
}

function configureRestoreStorage(): void {
  process.env.TARGET_DATABASE_URL = "postgresql://localhost/dev"
  process.env.RAILWAY_S3_BUCKET = "admin-db-backups"
  process.env.RAILWAY_S3_ENDPOINT = "https://storage.example.com"
  process.env.RAILWAY_S3_REGION = "auto"
  process.env.RAILWAY_S3_ACCESS_KEY_ID = "key"
  process.env.RAILWAY_S3_SECRET_ACCESS_KEY = "secret"
}

function mockSuccessfulRestore(inspectInput?: (path: string) => void): void {
  commandMocks.spawn.mockImplementation((command: string, args: string[]) => {
    if (
      command === "pg_restore" &&
      !args.includes("--version") &&
      !args.includes("--list")
    ) {
      inspectInput?.(args.at(-1) as string)
    }
    const child = new EventEmitter() as EventEmitter & {
      stdout?: EventEmitter & { setEncoding: (encoding: string) => void }
    }
    let capturedOutput: string | undefined
    if (command === "pg_restore" && args.includes("--version")) {
      capturedOutput = "pg_restore (PostgreSQL) 18.0"
    } else if (command === "psql" && args.includes("--version")) {
      capturedOutput = "psql (PostgreSQL) 18.0"
    } else if (command === "pg_restore" && args.includes("--list")) {
      capturedOutput = archiveManifest(VIDEO_DB_BACKUP_PROFILES["video-core"])
    } else if (command === "psql" && args.includes("--no-align")) {
      capturedOutput = validRestoreTargetState
    }
    if (capturedOutput !== undefined) {
      const stdout = new EventEmitter() as EventEmitter & {
        setEncoding: (encoding: string) => void
      }
      stdout.setEncoding = vi.fn()
      child.stdout = stdout
      queueMicrotask(() => {
        stdout.emit("data", capturedOutput)
        child.emit("exit", 0, null)
      })
    } else {
      queueMicrotask(() => child.emit("exit", 0, null))
    }
    return child
  })
}

const validRestoreTargetState = JSON.stringify({
  serverVersionNum: 180000,
  missingTables: [],
  vectorExtensionInstalled: true,
  vectorTypeAvailable: true,
})

function archiveManifest(tables: readonly string[]): string {
  return tables
    .map(
      (table, index) =>
        `${100 + index}; 0 ${200 + index} TABLE DATA public ${table} postgres`,
    )
    .join("\n")
}

function successfulRestorePreflight(
  profile: keyof typeof VIDEO_DB_BACKUP_PROFILES,
) {
  return vi.fn(async (check: { check: string }) => {
    switch (check.check) {
      case "pg-restore-client-version":
        return "pg_restore (PostgreSQL) 18.0"
      case "psql-client-version":
        return "psql (PostgreSQL) 18.0"
      case "archive-manifest":
        return archiveManifest(VIDEO_DB_BACKUP_PROFILES[profile])
      case "target-compatibility":
        return validRestoreTargetState
      default:
        throw new Error(`Unexpected preflight check ${check.check}`)
    }
  })
}

const pgDumpVersion = spawnSync("pg_dump", ["--version"], {
  encoding: "utf8",
}).stdout
const hasPostgres18PgDump = /PostgreSQL\) 18\./.test(pgDumpVersion ?? "")

describe("video DB backup profiles", () => {
  it("keeps video-core focused on catalog data without embedding tables", () => {
    expect(VIDEO_DB_BACKUP_PROFILES["video-core"]).toContain("video")
    expect(VIDEO_DB_BACKUP_PROFILES["video-core"]).toContain("video_locale")
    expect(VIDEO_DB_BACKUP_PROFILES["video-core"]).toContain("video_dub")
    expect(VIDEO_DB_BACKUP_PROFILES["video-core"]).toContain("video_subtitle")
    expect(VIDEO_DB_BACKUP_PROFILES["video-core"]).not.toContain(
      "video_scene_locale",
    )
    expect(VIDEO_DB_BACKUP_PROFILES["video-core"]).not.toContain(
      "video_transcript_chunk",
    )
  })

  it("adds scene and transcript embedding tables in video-search", () => {
    expect(VIDEO_DB_BACKUP_PROFILES["video-search"]).toEqual(
      expect.arrayContaining([
        "video_scene",
        "video_scene_locale",
        "video_transcript",
        "video_transcript_chunk",
      ]),
    )
  })

  it("schedules both catalog and search snapshots", () => {
    expect(SCHEDULED_VIDEO_DB_BACKUP_PROFILES).toEqual([
      "video-core",
      "video-search",
    ])
  })

  it("rejects unknown profiles", () => {
    expect(() => parseProfile("everything")).toThrow(VideoDbBackupError)
  })
})

describe("backup command planning", () => {
  it.runIf(hasPostgres18PgDump)(
    "passes the planned URL through the PostgreSQL 18 URI parser without Prisma-only options",
    () => {
      const plan = buildBackupPlan(
        parseArgs("backup", ["--profile=video-core", "--out=.tmp/video.dump"]),
        {
          SOURCE_DATABASE_URL:
            "postgresql://user:pass@127.0.0.1:1/prod?connection_limit=5&connect_timeout=1",
        },
      )
      const result = spawnSync(
        "pg_dump",
        ["--schema-only", "--dbname", plan.source],
        { encoding: "utf8" },
      )

      expect(result.status).not.toBe(0)
      expect(result.stderr).not.toContain(
        'invalid URI query parameter: "connection_limit"',
      )
      expect(result.stderr).toContain("Connection refused")
    },
  )

  it.each(["SOURCE_DATABASE_URL", "DATABASE_URL"] as const)(
    "normalizes Prisma-only options from %s after environment precedence",
    (envName) => {
      const applicationUrl =
        "postgresql://encoded%40user:p%3Ass%2Fword@db.example.com:5432/prod?connection_limit=5&pool_timeout=60&schema=private&sslmode=require&connect_timeout=7&application_name=video%20backup&future_option=keep%2Fme"
      const plan = buildBackupPlan(
        parseArgs("backup", [
          "--profile=video-search",
          "--out=.tmp/video.dump",
        ]),
        { [envName]: applicationUrl },
      )

      expect(plan.source).toBe(
        "postgresql://encoded%40user:p%3Ass%2Fword@db.example.com:5432/prod?sslmode=require&connect_timeout=7&application_name=video+backup&future_option=keep%2Fme",
      )
      expect(plan.commands[0]?.args).toContain(plan.source)
      expect(plan.commands[0]?.args.join(" ")).not.toContain("connection_limit")
      expect(plan.commands[0]?.args.join(" ")).not.toContain("pool_timeout")
      expect(plan.commands[0]?.args.join(" ")).not.toContain("schema=private")
    },
  )

  it("normalizes only the selected explicit source URL", () => {
    const plan = buildBackupPlan(
      parseArgs("backup", ["--out=.tmp/video.dump"]),
      {
        SOURCE_DATABASE_URL:
          "postgres://explicit:secret@db.example.com/prod?connection_limit=3&sslmode=verify-full",
        DATABASE_URL:
          "postgresql://fallback:secret@other.example.com/prod?future_option=untouched",
      },
    )

    expect(plan.source).toBe(
      "postgres://explicit:secret@db.example.com/prod?sslmode=verify-full",
    )
  })

  it("leaves the Prisma application URL and its embedding pool settings unchanged", () => {
    const applicationUrl =
      "postgresql://user:secret@db.example.com/prod?connection_limit=10&pool_timeout=20&sslmode=require"
    process.env.DATABASE_URL = applicationUrl

    const backupPlan = buildBackupPlan(
      parseArgs("backup", ["--out=.tmp/video.dump"]),
    )
    const restorePlan = buildRestorePlan(
      parseArgs("restore", [
        "--target-env=development",
        "--in=.tmp/video.dump",
      ]),
    )

    expect(process.env.DATABASE_URL).toBe(applicationUrl)
    expect(backupPlan.source).toBe(
      "postgresql://user:secret@db.example.com/prod?sslmode=require",
    )
    expect(restorePlan.target).toBe(backupPlan.source)
  })

  it("rejects an invalid source URL without including credentials", () => {
    const invalidUrl = "postgresql://private-user:private-password@[invalid"

    expect(() =>
      buildBackupPlan(parseArgs("backup", []), {
        SOURCE_DATABASE_URL: invalidUrl,
      }),
    ).toThrow("Invalid PostgreSQL source connection URL")

    try {
      buildBackupPlan(parseArgs("backup", []), {
        SOURCE_DATABASE_URL: invalidUrl,
      })
    } catch (error) {
      expect(String(error)).not.toContain("private-user")
      expect(String(error)).not.toContain("private-password")
      expect(String(error)).not.toContain(invalidUrl)
    }
  })

  it("builds pg_dump args with one table arg per reviewed table", () => {
    const plan = buildBackupPlan(
      parseArgs("backup", ["--profile=video-core", "--out=.tmp/video.dump"]),
      { SOURCE_DATABASE_URL: "postgresql://user:pass@example.com/prod" },
    )

    expect(plan.commands).toHaveLength(1)
    expect(plan.commands[0]?.command).toBe("pg_dump")
    expect(plan.commands[0]?.env).toBeUndefined()
    expect(plan.commands[0]?.args).toEqual(
      expect.arrayContaining([
        "--format=custom",
        "--data-only",
        "--no-owner",
        "--no-acl",
        "--dbname",
        "postgresql://user:pass@example.com/prod",
        "--file",
        plan.outPath,
        "--table=public.video",
        "--table=public.video_locale",
      ]),
    )

    const tableArgs = plan.commands[0]?.args.filter((arg) =>
      arg.startsWith("--table="),
    )
    expect(tableArgs).toHaveLength(plan.tables.length)
  })

  it("requires a source database URL", () => {
    expect(() => buildBackupPlan(parseArgs("backup", []), {})).toThrow(
      "SOURCE_DATABASE_URL or DATABASE_URL is required",
    )
  })

  it("plans S3 upload from the normal Railway bucket env vars", () => {
    const plan = buildBackupPlan(
      parseArgs("backup", ["--profile=video-search", "--out=.tmp/video.dump"]),
      {
        SOURCE_DATABASE_URL: "postgresql://user:pass@example.com/prod",
        RAILWAY_S3_BUCKET: "admin-db-backups",
        RAILWAY_S3_ENDPOINT: "https://storage.example.com",
        RAILWAY_S3_REGION: "sjc",
        RAILWAY_S3_ACCESS_KEY_ID: "key",
        RAILWAY_S3_SECRET_ACCESS_KEY: "secret",
      },
    )

    expect(plan.upload).toEqual({
      bucket: "admin-db-backups",
      endpoint: "https://storage.example.com",
      region: "sjc",
      accessKeyId: "key",
      secretAccessKey: "secret",
      key: "admin-video-db-backups/video-search/video.dump",
    })
  })

  it("requires Railway S3 credentials when the normal bucket is configured", () => {
    expect(() =>
      buildBackupPlan(parseArgs("backup", []), {
        SOURCE_DATABASE_URL: "postgresql://user:pass@example.com/prod",
        RAILWAY_S3_BUCKET: "admin-db-backups",
      }),
    ).toThrow("S3 upload requires RAILWAY_S3_ACCESS_KEY_ID")
  })

  it("allows scheduled runs to override the S3 object key", () => {
    expect(
      buildBackupObjectKey(
        "video-core",
        "/tmp/video.dump",
        "/manual/key.dump",
        {},
      ),
    ).toBe("manual/key.dump")
  })
})

describe("backup execution", () => {
  it("reports completed dump size, uploads an owner-only generated dump, and removes it", async () => {
    const contents = Buffer.from("completed scheduled dump")
    mockSuccessfulPgDump(contents)
    Object.assign(process.env, uploadEnv)
    let generatedPath = ""
    s3Mocks.send.mockImplementation(
      async (command: { input: { Body: unknown } }) => {
        generatedPath = commandMocks.spawn.mock.calls[0]?.[1][
          commandMocks.spawn.mock.calls[0]?.[1].indexOf("--file") + 1
        ] as string
        expect((await stat(generatedPath)).mode & 0o777).toBe(0o600)

        for await (const chunk of command.input.Body as AsyncIterable<Buffer>) {
          expect(chunk).toBeDefined()
          // Consume the upload stream before the generated file is removed.
        }
        return {}
      },
    )
    const stdout = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true)

    const result = await executeBackupPlan(parseArgs("backup", []))

    expect(result.size).toBe(contents.byteLength)
    expect(
      stdout.mock.calls.map(([value]) => String(value)).join(""),
    ).toContain(
      JSON.stringify({
        event: "video-db.backup.dump.complete",
        profile: "video-core",
        path: generatedPath,
        size: contents.byteLength,
      }),
    )
    await expect(stat(generatedPath)).rejects.toMatchObject({ code: "ENOENT" })
  })

  it("reports completed dump size and removes a generated dump when upload fails", async () => {
    const contents = Buffer.from("completed dump before failed upload")
    mockSuccessfulPgDump(contents)
    Object.assign(process.env, uploadEnv)
    s3Mocks.send.mockRejectedValue(new Error("upload unavailable"))
    const stdout = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true)

    await expect(
      executeBackupPlan(parseArgs("backup", ["--profile=video-search"])),
    ).rejects.toThrow("upload unavailable")

    const spawnArgs = commandMocks.spawn.mock.calls[0]?.[1] as string[]
    const generatedPath = spawnArgs[spawnArgs.indexOf("--file") + 1] as string
    expect(
      stdout.mock.calls.map(([value]) => String(value)).join(""),
    ).toContain(
      JSON.stringify({
        event: "video-db.backup.dump.complete",
        profile: "video-search",
        path: generatedPath,
        size: contents.byteLength,
      }),
    )
    await expect(stat(generatedPath)).rejects.toMatchObject({ code: "ENOENT" })
  })

  it("preserves an explicit developer-owned output path after upload", async () => {
    const contents = Buffer.from("developer-owned dump")
    const directory = await mkdtemp(join(tmpdir(), "video-db-backup-test-"))
    const outPath = join(directory, "manual.dump")
    mockSuccessfulPgDump(contents)
    s3Mocks.send.mockImplementation(
      async (command: { input: { Body: unknown } }) => {
        for await (const chunk of command.input.Body as AsyncIterable<Buffer>) {
          expect(chunk).toBeDefined()
          // Consume the explicit file's upload stream.
        }
        return {}
      },
    )

    try {
      const result = await executeBackupPlan(
        parseArgs("backup", [`--out=${outPath}`]),
        uploadEnv,
      )

      expect(result.size).toBe(contents.byteLength)
      await expect(readFile(outPath)).resolves.toEqual(contents)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it("rejects an invalid scheduled URL before spawning and without printing credentials", async () => {
    process.env.SOURCE_DATABASE_URL =
      "postgresql://private-user:private-password@[invalid"
    const stdout = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true)

    await expect(executeBackupPlan(parseArgs("backup", []))).rejects.toThrow(
      "Invalid PostgreSQL source connection URL",
    )

    expect(commandMocks.spawn).not.toHaveBeenCalled()
    const printed = stdout.mock.calls.map(([value]) => String(value)).join("")
    expect(printed).not.toContain("private-user")
    expect(printed).not.toContain("private-password")
  })
})

describe("restore command planning", () => {
  it.each(["TARGET_DATABASE_URL", "DATABASE_URL"] as const)(
    "normalizes Prisma-only options from %s for every native restore command",
    (envName) => {
      const applicationUrl =
        "postgresql://encoded%40user:p%3Ass%2Fword@localhost/dev?connection_limit=10&pool_timeout=20&schema=public&sslmode=prefer&future_option=keep"
      const plan = buildRestorePlan(
        parseArgs("restore", [
          "--target-env=development",
          "--in=.tmp/video.dump",
        ]),
        { [envName]: applicationUrl },
      )

      expect(plan.target).toBe(
        "postgresql://encoded%40user:p%3Ass%2Fword@localhost/dev?sslmode=prefer&future_option=keep",
      )
      expect(plan.commands).toHaveLength(2)
      for (const command of plan.commands) {
        expect(command.args).toContain(plan.target)
        expect(command.args.join(" ")).not.toContain("connection_limit")
        expect(command.args.join(" ")).not.toContain("pool_timeout")
        expect(command.args.join(" ")).not.toContain("schema=public")
      }
    },
  )

  it("normalizes only the selected explicit target URL", () => {
    const plan = buildRestorePlan(
      parseArgs("restore", [
        "--target-env=development",
        "--in=.tmp/video.dump",
      ]),
      {
        TARGET_DATABASE_URL:
          "postgres://explicit:secret@localhost/dev?pool_timeout=20&sslmode=disable",
        DATABASE_URL:
          "postgresql://fallback:secret@other.example.com/dev?future_option=untouched",
      },
    )

    expect(plan.target).toBe(
      "postgres://explicit:secret@localhost/dev?sslmode=disable",
    )
  })

  it("rejects an invalid target URL without including credentials", () => {
    const invalidUrl = "postgresql://private-user:private-password@[invalid"

    expect(() =>
      buildRestorePlan(
        parseArgs("restore", [
          "--target-env=development",
          "--in=.tmp/video.dump",
        ]),
        { TARGET_DATABASE_URL: invalidUrl },
      ),
    ).toThrow("Invalid PostgreSQL target connection URL")

    try {
      buildRestorePlan(
        parseArgs("restore", [
          "--target-env=development",
          "--in=.tmp/video.dump",
        ]),
        { TARGET_DATABASE_URL: invalidUrl },
      )
    } catch (error) {
      expect(String(error)).not.toContain("private-user")
      expect(String(error)).not.toContain("private-password")
      expect(String(error)).not.toContain(invalidUrl)
    }
  })

  it("builds truncate and pg_restore commands for development targets", () => {
    const plan = buildRestorePlan(
      parseArgs("restore", [
        "--profile=video-search",
        "--target-env=development",
        "--in=.tmp/video.dump",
      ]),
      { TARGET_DATABASE_URL: "postgresql://user:pass@localhost/dev" },
    )

    expect(plan.commands).toHaveLength(2)
    expect(plan.commands[0]?.command).toBe("psql")
    expect(plan.commands[0]?.env).toBeUndefined()
    expect(plan.commands[0]?.args).toEqual(
      expect.arrayContaining([
        "--dbname",
        "postgresql://user:pass@localhost/dev",
      ]),
    )
    expect(plan.commands[0]?.args.join(" ")).toContain(
      'TRUNCATE TABLE "public"."language"',
    )
    expect(plan.commands[0]?.args.join(" ")).toContain(
      '"public"."video_transcript_chunk"',
    )
    expect(plan.commands[0]?.args.join(" ")).toContain(
      "RESTART IDENTITY CASCADE",
    )

    expect(plan.commands[1]?.command).toBe("pg_restore")
    expect(plan.commands[1]?.args).toEqual(
      expect.arrayContaining([
        "--data-only",
        "--no-owner",
        "--no-acl",
        "--single-transaction",
        "--dbname",
        "postgresql://user:pass@localhost/dev",
        "--table=video",
        "--table=video_transcript_chunk",
        plan.inPath,
      ]),
    )
  })

  it("plans ordered, read-only restore preflight before the existing destructive commands", () => {
    const plan = buildRestorePlan(
      parseArgs("restore", [
        "--profile=video-search",
        "--target-env=development",
        "--in=.tmp/video.dump",
      ]),
      {
        TARGET_DATABASE_URL:
          "postgresql://private-user:private-password@localhost/dev",
      },
    )

    expect(plan.preflightCommands.map(({ check }) => check)).toEqual([
      "pg-restore-client-version",
      "psql-client-version",
      "archive-manifest",
      "target-compatibility",
    ])
    expect(plan.preflightCommands.map(({ command }) => command)).toEqual([
      "pg_restore",
      "psql",
      "pg_restore",
      "psql",
    ])
    expect(plan.preflightCommands[2]?.args).toEqual(["--list", plan.inPath])
    expect(plan.preflightCommands[3]?.args.join(" ")).not.toContain("TRUNCATE")
    expect(plan.commands.map(({ command }) => command)).toEqual([
      "psql",
      "pg_restore",
    ])
  })

  it("prints ordered, redacted restore preflight in dry-run output", async () => {
    process.env.TARGET_DATABASE_URL =
      "postgresql://private-user:private-password@localhost/dev"
    const stdout = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true)

    await main("restore", [
      "--profile=video-search",
      "--target-env=development",
      "--in=.tmp/video.dump",
      "--dry-run",
    ])

    const output = stdout.mock.calls.map(([value]) => String(value)).join("")
    expect(output.indexOf("pg-restore-client-version")).toBeLessThan(
      output.indexOf("archive-manifest"),
    )
    expect(output.indexOf("archive-manifest")).toBeLessThan(
      output.indexOf("target-compatibility"),
    )
    expect(output.indexOf("target-compatibility")).toBeLessThan(
      output.indexOf("TRUNCATE TABLE"),
    )
    expect(output).toContain("REDACTED")
    expect(output).not.toContain("private-user")
    expect(output).not.toContain("private-password")
  })

  it("requires an input dump path", () => {
    expect(() =>
      buildRestorePlan(parseArgs("restore", ["--target-env=development"]), {
        TARGET_DATABASE_URL: "postgresql://localhost/dev",
      }),
    ).toThrow("--in=<dump path> is required")
  })

  it("refuses production restores without the explicit override", () => {
    expect(() =>
      buildRestorePlan(
        parseArgs("restore", [
          "--target-env=production",
          "--in=.tmp/video.dump",
        ]),
        { TARGET_DATABASE_URL: "postgresql://localhost/prod" },
      ),
    ).toThrow("Refusing production restore")
  })

  it("allows production restores only when requested explicitly", () => {
    const plan = buildRestorePlan(
      parseArgs("restore", [
        "--target-env=production",
        "--allow-production-target",
        "--in=.tmp/video.dump",
      ]),
      { TARGET_DATABASE_URL: "postgresql://localhost/prod" },
    )

    expect(plan.targetEnv).toBe("production")
  })

  it("keeps production-target protection ahead of restore preflight", async () => {
    const capture = successfulRestorePreflight("video-core")

    await expect(
      executeRestorePlan(
        parseArgs("restore", [
          "--target-env=production",
          "--in=.tmp/video.dump",
        ]),
        { TARGET_DATABASE_URL: "postgresql://localhost/prod" },
        capture,
      ),
    ).rejects.toThrow("Refusing production restore")

    expect(capture).not.toHaveBeenCalled()
    expect(commandMocks.spawn).not.toHaveBeenCalled()
  })

  it("reaches the existing truncate and single-transaction import after valid preflight", async () => {
    const capture = successfulRestorePreflight("video-search")
    mockSuccessfulRestore()

    await executeRestorePlan(
      parseArgs("restore", [
        "--profile=video-search",
        "--target-env=development",
        "--in=.tmp/video.dump",
      ]),
      { TARGET_DATABASE_URL: "postgresql://localhost/dev" },
      capture,
    )

    expect(capture.mock.calls.map(([check]) => check.check)).toEqual([
      "pg-restore-client-version",
      "psql-client-version",
      "archive-manifest",
      "target-compatibility",
    ])
    expect(commandMocks.spawn).toHaveBeenCalledTimes(2)
    expect(commandMocks.spawn.mock.calls[0]?.[0]).toBe("psql")
    expect(commandMocks.spawn.mock.calls[0]?.[1].join(" ")).toContain(
      "TRUNCATE TABLE",
    )
    expect(commandMocks.spawn.mock.calls[1]?.[0]).toBe("pg_restore")
    expect(commandMocks.spawn.mock.calls[1]?.[1]).toContain(
      "--single-transaction",
    )
  })

  it.each([
    {
      name: "an unreadable archive",
      mutate: (capture: ReturnType<typeof successfulRestorePreflight>) =>
        capture.mockImplementation(async (check: { check: string }) => {
          if (check.check === "archive-manifest") {
            throw new Error("pg_restore exited with code 1")
          }
          return successfulRestorePreflight("video-search")(check)
        }),
      expected: "could not read the archive",
    },
    {
      name: "a wrong-profile archive",
      mutate: (capture: ReturnType<typeof successfulRestorePreflight>) =>
        capture.mockImplementation(async (check: { check: string }) =>
          check.check === "archive-manifest"
            ? archiveManifest(VIDEO_DB_BACKUP_PROFILES["video-core"])
            : successfulRestorePreflight("video-search")(check),
        ),
      expected: "does not match selected profile video-search",
    },
    {
      name: "a missing TABLE DATA manifest entry",
      mutate: (capture: ReturnType<typeof successfulRestorePreflight>) =>
        capture.mockImplementation(async (check: { check: string }) =>
          check.check === "archive-manifest"
            ? archiveManifest(
                VIDEO_DB_BACKUP_PROFILES["video-search"].filter(
                  (table) => table !== "video",
                ),
              )
            : successfulRestorePreflight("video-search")(check),
        ),
      expected: "missing TABLE DATA",
    },
    {
      name: "a stale target schema",
      mutate: (capture: ReturnType<typeof successfulRestorePreflight>) =>
        capture.mockImplementation(async (check: { check: string }) =>
          check.check === "target-compatibility"
            ? JSON.stringify({
                ...JSON.parse(validRestoreTargetState),
                missingTables: ["video_transcript_chunk"],
              })
            : successfulRestorePreflight("video-search")(check),
        ),
      expected: "missing required public tables: video_transcript_chunk",
    },
    {
      name: "absent vector support",
      mutate: (capture: ReturnType<typeof successfulRestorePreflight>) =>
        capture.mockImplementation(async (check: { check: string }) =>
          check.check === "target-compatibility"
            ? JSON.stringify({
                ...JSON.parse(validRestoreTargetState),
                vectorExtensionInstalled: false,
                vectorTypeAvailable: false,
              })
            : successfulRestorePreflight("video-search")(check),
        ),
      expected: "pgvector extension and public.vector type",
    },
    {
      name: "an unsupported restore client major",
      mutate: (capture: ReturnType<typeof successfulRestorePreflight>) =>
        capture.mockResolvedValueOnce("pg_restore (PostgreSQL) 17.6"),
      expected: "pg_restore 18 or newer",
    },
    {
      name: "an unsupported target server major",
      mutate: (capture: ReturnType<typeof successfulRestorePreflight>) =>
        capture.mockImplementation(async (check: { check: string }) =>
          check.check === "target-compatibility"
            ? JSON.stringify({
                ...JSON.parse(validRestoreTargetState),
                serverVersionNum: 170006,
              })
            : successfulRestorePreflight("video-search")(check),
        ),
      expected: "PostgreSQL server 18 or newer",
    },
  ])("stops $name before truncate", async ({ mutate, expected }) => {
    const capture = successfulRestorePreflight("video-search")
    mutate(capture)

    await expect(
      executeRestorePlan(
        parseArgs("restore", [
          "--profile=video-search",
          "--target-env=development",
          "--in=.tmp/video.dump",
        ]),
        { TARGET_DATABASE_URL: "postgresql://localhost/dev" },
        capture,
      ),
    ).rejects.toThrow(expected)

    expect(commandMocks.spawn).not.toHaveBeenCalled()
  })

  it("requires the normal Railway bucket for restore-latest", async () => {
    await expect(
      restoreLatestMain([
        "--target-env=development",
        "--dry-run",
        "--out=.tmp/video.dump",
      ]),
    ).rejects.toThrow("RAILWAY_S3_BUCKET is required")
  })

  it("uses the admin signer instead of raw S3 credentials when BACKUP_DOWNLOAD_API_KEY is set", async () => {
    process.env.BACKUP_DOWNLOAD_API_KEY = "download-token"
    process.env.BACKUP_DOWNLOAD_BASE_URL = "https://admin.example.com/"
    process.env.TARGET_DATABASE_URL = "postgresql://localhost/dev"

    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        url: "https://signed.example.com/video.dump",
        profile: "video-core",
        key: "admin-video-db-backups/video-core/video.dump",
        expiresAt: "2026-05-15T00:10:00.000Z",
        expiresInSeconds: 600,
        freshness: {
          ...freshEvaluation,
          key: "admin-video-db-backups/video-core/video.dump",
        },
      }),
    })
    vi.stubGlobal("fetch", fetch)

    await restoreLatestMain(["--target-env=development", "--dry-run"])

    expect(fetch).toHaveBeenCalledWith(
      "https://admin.example.com/api/internal/video-db-backups/presign",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer download-token",
          "content-type": "application/json",
        }),
        body: JSON.stringify({ profile: "video-core" }),
      }),
    )
  })

  it.each([
    { argv: [], profile: "video-core" },
    { argv: ["--profile=video-search"], profile: "video-search" },
  ])(
    "selects $profile latest objects explicitly by profile",
    async ({ argv, profile }) => {
      configureRestoreStorage()
      vi.spyOn(Date, "now").mockReturnValue(
        new Date("2026-05-15T00:00:00.000Z").getTime(),
      )
      s3Mocks.send.mockResolvedValue({
        Contents: [
          {
            Key: `admin-video-db-backups/${profile}/latest.dump`,
            LastModified: new Date("2026-05-14T00:00:00.000Z"),
          },
        ],
      })
      const stdout = vi
        .spyOn(process.stdout, "write")
        .mockImplementation(() => true)

      await restoreLatestMain([...argv, "--dry-run"])

      expect(s3Mocks.listObjectsV2Command).toHaveBeenCalledWith(
        expect.objectContaining({
          Prefix: `admin-video-db-backups/${profile}/`,
        }),
      )
      expect(
        stdout.mock.calls.map(([value]) => String(value)).join(""),
      ).toContain(`"profile":"${profile}"`)
      expect(
        stdout.mock.calls.map(([value]) => String(value)).join(""),
      ).toContain('"status":"fresh"')
    },
  )

  it("paginates direct storage discovery before selecting the latest object", async () => {
    configureRestoreStorage()
    vi.spyOn(Date, "now").mockReturnValue(
      new Date("2026-05-15T00:00:00.000Z").getTime(),
    )
    s3Mocks.send
      .mockResolvedValueOnce({
        Contents: [
          {
            Key: "admin-video-db-backups/video-search/first.dump",
            LastModified: new Date("2026-05-13T00:00:00.000Z"),
          },
        ],
        IsTruncated: true,
        NextContinuationToken: "page-two",
      })
      .mockResolvedValueOnce({
        Contents: [
          {
            Key: "admin-video-db-backups/video-search/newest.dump",
            LastModified: new Date("2026-05-14T12:00:00.000Z"),
          },
        ],
      })
    const stdout = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true)

    await restoreLatestMain([
      "--profile=video-search",
      "--target-env=development",
      "--dry-run",
    ])

    expect(s3Mocks.listObjectsV2Command).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ ContinuationToken: "page-two" }),
    )
    expect(
      stdout.mock.calls.map(([value]) => String(value)).join(""),
    ).toContain("admin-video-db-backups/video-search/newest.dump")
  })

  it.each([
    { Contents: [], expected: "No video DB backup objects were found" },
    {
      Contents: [
        { Key: "admin-video-db-backups/video-core/missing-date.dump" },
      ],
      expected: "freshness metadata is unavailable",
    },
  ])(
    "stops unavailable latest discovery before GET: $expected",
    async (listing) => {
      configureRestoreStorage()
      s3Mocks.send.mockResolvedValueOnce(listing)

      await expect(
        restoreLatestMain(["--target-env=development", "--dry-run"]),
      ).rejects.toThrow(listing.expected)
      expect(s3Mocks.getObjectCommand).not.toHaveBeenCalled()
    },
  )

  it("blocks a signer-discovered stale object before the signed GET", async () => {
    process.env.BACKUP_DOWNLOAD_API_KEY = "download-token"
    process.env.BACKUP_DOWNLOAD_BASE_URL = "https://admin.example.com"
    process.env.TARGET_DATABASE_URL = "postgresql://localhost/dev"
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        url: "https://signed.example.com/stale.dump",
        profile: "video-core",
        key: "admin-video-db-backups/video-core/stale.dump",
        expiresAt: "2026-05-15T00:10:00.000Z",
        expiresInSeconds: 600,
        freshness: {
          ...freshEvaluation,
          status: "stale",
          key: "admin-video-db-backups/video-core/stale.dump",
          lastModified: "2026-05-13T11:59:59.999Z",
          ageMilliseconds: 36 * 60 * 60 * 1000 + 1,
        },
      }),
    })
    vi.stubGlobal("fetch", fetch)

    await expect(
      restoreLatestMain(["--target-env=development"]),
    ).rejects.toThrow("--allow-stale")
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch).not.toHaveBeenCalledWith(
      "https://signed.example.com/stale.dump",
    )
  })

  it("blocks a stale latest object before GET and proceeds with --allow-stale", async () => {
    configureRestoreStorage()
    vi.spyOn(Date, "now").mockReturnValue(
      new Date("2026-05-15T00:00:00.000Z").getTime(),
    )
    const directory = await mkdtemp(join(tmpdir(), "video-db-stale-"))
    const outPath = join(directory, "stale.dump")
    const staleListing = {
      Contents: [
        {
          Key: "admin-video-db-backups/video-core/stale.dump",
          LastModified: new Date("2026-05-13T11:59:59.999Z"),
        },
      ],
    }

    try {
      s3Mocks.send.mockResolvedValueOnce(staleListing)
      await expect(
        restoreLatestMain(["--target-env=development", `--out=${outPath}`]),
      ).rejects.toThrow("--allow-stale")
      expect(s3Mocks.getObjectCommand).not.toHaveBeenCalled()
      expect(commandMocks.spawn).not.toHaveBeenCalled()

      s3Mocks.send.mockResolvedValueOnce(staleListing).mockResolvedValueOnce({
        Body: Readable.from(Buffer.from("stale dump")),
        ContentLength: 10,
      })
      mockSuccessfulRestore()

      await restoreLatestMain([
        "--target-env=development",
        `--out=${outPath}`,
        "--allow-stale",
      ])

      expect(s3Mocks.getObjectCommand).toHaveBeenCalled()
      await expect(readFile(outPath, "utf8")).resolves.toBe("stale dump")
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it("removes an owner-only generated latest download after a successful restore", async () => {
    configureRestoreStorage()
    vi.spyOn(Date, "now").mockReturnValue(
      new Date("2026-05-15T00:00:00.000Z").getTime(),
    )
    const generatedPath = join(
      process.cwd(),
      ".tmp",
      "db-backups",
      "video-db-video-core-latest.dump",
    )
    let observedMode: number | undefined
    s3Mocks.send
      .mockResolvedValueOnce({
        Contents: [
          {
            Key: freshEvaluation.key,
            LastModified: new Date(freshEvaluation.lastModified),
          },
        ],
      })
      .mockResolvedValueOnce({
        Body: Readable.from(Buffer.from("fresh dump")),
        ContentLength: 10,
      })
    mockSuccessfulRestore((path) => {
      observedMode = statSync(path).mode & 0o777
    })

    try {
      await restoreLatestMain(["--target-env=development"])

      expect(observedMode).toBe(0o600)
      await expect(stat(generatedPath)).rejects.toMatchObject({
        code: "ENOENT",
      })
    } finally {
      await rm(generatedPath, { force: true })
    }
  })

  it("removes a partial generated latest download after failure", async () => {
    configureRestoreStorage()
    vi.spyOn(Date, "now").mockReturnValue(
      new Date("2026-05-15T00:00:00.000Z").getTime(),
    )
    const generatedPath = join(
      process.cwd(),
      ".tmp",
      "db-backups",
      "video-db-video-core-latest.dump",
    )
    const failedBody = new Readable({
      read() {
        this.push("partial")
        this.destroy(new Error("download failed"))
      },
    })
    s3Mocks.send
      .mockResolvedValueOnce({
        Contents: [
          {
            Key: freshEvaluation.key,
            LastModified: new Date(freshEvaluation.lastModified),
          },
        ],
      })
      .mockResolvedValueOnce({ Body: failedBody })

    try {
      await expect(
        restoreLatestMain(["--target-env=development"]),
      ).rejects.toThrow("download failed")
      await expect(stat(generatedPath)).rejects.toMatchObject({
        code: "ENOENT",
      })
    } finally {
      await rm(generatedPath, { force: true })
    }
  })

  it("marks an explicit S3 key as intentional rather than fresh latest", async () => {
    configureRestoreStorage()
    const stdout = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true)

    await restoreLatestMain([
      "--target-env=development",
      "--dry-run",
      "--s3-key=admin-video-db-backups/video-core/historical.dump",
    ])

    const output = stdout.mock.calls.map(([value]) => String(value)).join("")
    expect(output).toContain('"selection":"explicit-key"')
    expect(output).not.toContain('"status":"fresh"')
    expect(s3Mocks.listObjectsV2Command).not.toHaveBeenCalled()
  })
})
