import { afterEach, describe, expect, it, vi } from "vitest"

import {
  SCHEDULED_VIDEO_DB_BACKUP_PROFILES,
  VIDEO_DB_BACKUP_PROFILES,
  VideoDbBackupError,
  buildBackupPlan,
  buildBackupObjectKey,
  buildRestorePlan,
  parseArgs,
  parseProfile,
  restoreLatestMain,
} from "./video-db-backup"

afterEach(() => {
  delete process.env.BACKUP_DOWNLOAD_API_KEY
  delete process.env.BACKUP_DOWNLOAD_BASE_URL
  delete process.env.TARGET_DATABASE_URL
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

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

describe("restore command planning", () => {
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
})
