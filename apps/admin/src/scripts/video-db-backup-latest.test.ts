import { EventEmitter } from "node:events"
import { statSync } from "node:fs"
import { mkdtemp, readFile, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Readable } from "node:stream"

import { afterEach, describe, expect, it, vi } from "vitest"

const commandMocks = vi.hoisted(() => ({ spawn: vi.fn() }))
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

import { VIDEO_DB_BACKUP_PROFILES, restoreLatestMain } from "./video-db-backup"

afterEach(() => {
  delete process.env.BACKUP_DOWNLOAD_API_KEY
  delete process.env.BACKUP_DOWNLOAD_BASE_URL
  delete process.env.TARGET_DATABASE_URL
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

function mockSuccessfulRestore(
  inspectInput?: (path: string) => void,
  profile: keyof typeof VIDEO_DB_BACKUP_PROFILES = "video-core",
): void {
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
      capturedOutput = archiveManifest(VIDEO_DB_BACKUP_PROFILES[profile])
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
  requiredMigrationApplied: true,
})

function archiveManifest(tables: readonly string[]): string {
  return tables
    .map(
      (table, index) =>
        `${100 + index}; 0 ${200 + index} TABLE DATA public ${table} postgres`,
    )
    .join("\n")
}

describe("latest video DB restore", () => {
  it("requires the normal Railway bucket for restore-latest", async () => {
    await expect(
      restoreLatestMain([
        "--target-env=development",
        "--dry-run",
        "--out=.tmp/video.dump",
      ]),
    ).rejects.toThrow("RAILWAY_S3_BUCKET is required")
  })

  it("rejects caller-supplied --in before selecting or downloading latest", async () => {
    await expect(
      restoreLatestMain([
        "--target-env=development",
        "--in=.tmp/unverified.dump",
      ]),
    ).rejects.toThrow("does not accept --in")

    expect(s3Mocks.send).not.toHaveBeenCalled()
    expect(commandMocks.spawn).not.toHaveBeenCalled()
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
    {
      status: 404,
      error: "backup-not-found",
      expected: "No video DB backup objects were found",
    },
    {
      status: 503,
      error: "backup-freshness-unavailable",
      expected: "freshness metadata is unavailable",
    },
    {
      status: 503,
      error: "backup-storage-not-configured",
      expected: "storage is not configured",
    },
    {
      status: 503,
      error: "backup-storage-unavailable",
      expected: "storage is unavailable",
    },
  ])(
    "maps signer $error without collapsing its contract",
    async ({ status, error, expected }) => {
      process.env.BACKUP_DOWNLOAD_API_KEY = "download-token"
      process.env.TARGET_DATABASE_URL = "postgresql://localhost/dev"
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: false,
          status,
          json: async () => ({ error }),
        }),
      )

      await expect(
        restoreLatestMain(["--target-env=development", "--dry-run"]),
      ).rejects.toThrow(expected)
    },
  )

  it("downloads and restores a fresh presigned snapshot with owner-only cleanup", async () => {
    process.env.BACKUP_DOWNLOAD_API_KEY = "download-token"
    process.env.TARGET_DATABASE_URL = "postgresql://localhost/dev"
    let observedMode: number | undefined
    const dump = new TextEncoder().encode("signed dump")
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          url: "https://signed.example.com/video.dump",
          profile: "video-core",
          key: "admin-video-db-backups/video-core/video.dump",
          expiresAt: "2026-05-15T00:10:00.000Z",
          expiresInSeconds: 600,
          size: dump.byteLength,
          freshness: {
            ...freshEvaluation,
            key: "admin-video-db-backups/video-core/video.dump",
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(dump)
            controller.close()
          },
        }),
      })
    vi.stubGlobal("fetch", fetch)
    mockSuccessfulRestore((path) => {
      observedMode = statSync(path).mode & 0o777
    })

    const generatedPath = join(
      process.cwd(),
      ".tmp",
      "db-backups",
      "video-db-video-core-latest.dump",
    )
    await restoreLatestMain(["--target-env=development"])

    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "https://signed.example.com/video.dump",
    )
    expect(observedMode).toBe(0o600)
    await expect(stat(generatedPath)).rejects.toMatchObject({ code: "ENOENT" })
  })

  it("removes a partial generated presigned download after stream failure", async () => {
    process.env.BACKUP_DOWNLOAD_API_KEY = "download-token"
    process.env.TARGET_DATABASE_URL = "postgresql://localhost/dev"
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({
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
      .mockResolvedValueOnce({
        ok: true,
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("partial"))
            controller.error(new Error("signed stream failed"))
          },
        }),
      })
    vi.stubGlobal("fetch", fetch)

    const generatedPath = join(
      process.cwd(),
      ".tmp",
      "db-backups",
      "video-db-video-core-latest.dump",
    )
    await expect(
      restoreLatestMain(["--target-env=development"]),
    ).rejects.toThrow("signed stream failed")
    await expect(stat(generatedPath)).rejects.toMatchObject({ code: "ENOENT" })
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
