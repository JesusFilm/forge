import { spawnSync } from "node:child_process"
import { EventEmitter } from "node:events"
import { writeFileSync } from "node:fs"
import { mkdtemp, readFile, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

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
  parseArgs,
  parseProfile,
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

function mockSuccessfulPgDump(
  contents: Buffer,
  externalSocialImageReferences = 0,
): void {
  commandMocks.spawn.mockImplementation((command: string, args: string[]) => {
    if (command === "pg_dump") {
      const fileIndex = args.indexOf("--file")
      writeFileSync(args[fileIndex + 1] as string, contents)
    }

    const child = new EventEmitter() as EventEmitter & {
      stdout?: EventEmitter & { setEncoding: (encoding: string) => void }
    }
    if (command === "psql" && args.includes("--no-align")) {
      const stdout = new EventEmitter() as EventEmitter & {
        setEncoding: (encoding: string) => void
      }
      stdout.setEncoding = vi.fn()
      child.stdout = stdout
      queueMicrotask(() => {
        stdout.emit("data", JSON.stringify({ externalSocialImageReferences }))
        child.emit("exit", 0, null)
      })
    } else {
      queueMicrotask(() => child.emit("exit", 0, null))
    }
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
        "postgresql://encoded%40user:p%3Ass%2Fword@db.example.com:5432/prod?sslmode=require&connect_timeout=7&application_name=video%20backup&future_option=keep%2Fme",
      )
      expect(plan.commands[0]?.args).toContain(plan.source)
      expect(plan.commands[0]?.args.join(" ")).not.toContain("connection_limit")
      expect(plan.commands[0]?.args.join(" ")).not.toContain("pool_timeout")
      expect(plan.commands[0]?.args.join(" ")).not.toContain("schema=private")
    },
  )

  it("preserves libpq multi-host authorities and percent-encoded options", () => {
    const applicationUrl =
      "postgresql://db-a.example.com:5432,db-b.example.com:5432/prod?target_session_attrs=read-write&options=-c%20statement_timeout%3D5000&connection_limit=10&pool_timeout=20"
    const plan = buildBackupPlan(
      parseArgs("backup", ["--out=.tmp/video.dump"]),
      { SOURCE_DATABASE_URL: applicationUrl },
    )

    expect(plan.source).toBe(
      "postgresql://db-a.example.com:5432,db-b.example.com:5432/prod?target_session_attrs=read-write&options=-c%20statement_timeout%3D5000",
    )
    expect(process.env.DATABASE_URL).toBeUndefined()
  })

  it.runIf(hasPostgres18PgDump)(
    "passes a preserved multi-host URI and encoded option through PostgreSQL 18",
    () => {
      const plan = buildBackupPlan(
        parseArgs("backup", ["--out=.tmp/video.dump"]),
        {
          SOURCE_DATABASE_URL:
            "postgresql://127.0.0.1:1,127.0.0.1:2/prod?target_session_attrs=read-write&options=-c%20statement_timeout%3D5000&connect_timeout=1&connection_limit=10",
        },
      )
      const result = spawnSync(
        "pg_dump",
        ["--schema-only", "--dbname", plan.source],
        { encoding: "utf8" },
      )

      expect(result.status).not.toBe(0)
      expect(result.stderr).not.toContain("invalid URI")
      expect(result.stderr).not.toContain("invalid connection option")
      expect(result.stderr).toContain("Connection refused")
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

  it("requires bucket storage for generated scheduled backups", () => {
    expect(() =>
      buildBackupPlan(parseArgs("backup", ["--profile=video-search"]), {
        SOURCE_DATABASE_URL: "postgresql://user:pass@example.com/prod",
      }),
    ).toThrow("RAILWAY_S3_BUCKET is required for scheduled video DB backups")
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
        const pgDumpArgs = commandMocks.spawn.mock.calls.find(
          ([command]) => command === "pg_dump",
        )?.[1] as string[]
        generatedPath = pgDumpArgs[pgDumpArgs.indexOf("--file") + 1] as string
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
    expect(result.exportDurationMs).toEqual(expect.any(Number))
    expect(result.uploadDurationMs).toEqual(expect.any(Number))
    expect(
      stdout.mock.calls.map(([value]) => String(value)).join(""),
    ).toContain('"event":"video-db.backup.dump.complete"')
    expect(
      stdout.mock.calls.map(([value]) => String(value)).join(""),
    ).toContain(`"size":${contents.byteLength},"exportDurationMs":`)
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

    const spawnArgs = commandMocks.spawn.mock.calls.find(
      ([command]) => command === "pg_dump",
    )?.[1] as string[]
    const generatedPath = spawnArgs[spawnArgs.indexOf("--file") + 1] as string
    expect(
      stdout.mock.calls.map(([value]) => String(value)).join(""),
    ).toContain('"event":"video-db.backup.dump.complete"')
    expect(
      stdout.mock.calls.map(([value]) => String(value)).join(""),
    ).toContain(`"size":${contents.byteLength},"exportDurationMs":`)
    expect(
      stdout.mock.calls.map(([value]) => String(value)).join(""),
    ).toContain(
      '"event":"video-db.backup.upload.failed","profile":"video-search"',
    )
    expect(stdout.mock.calls.map(([value]) => String(value)).join("")).toMatch(
      /"uploadDurationMs":\d+/,
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

  it("fails before pg_dump when video locales reference excluded editorial media", async () => {
    mockSuccessfulPgDump(Buffer.from("unused dump"), 1)
    Object.assign(process.env, uploadEnv)

    await expect(executeBackupPlan(parseArgs("backup", []))).rejects.toThrow(
      "profile excludes editorial media assets",
    )

    expect(
      commandMocks.spawn.mock.calls.some(([command]) => command === "pg_dump"),
    ).toBe(false)
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
