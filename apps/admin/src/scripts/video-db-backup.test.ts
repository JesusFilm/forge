import { describe, expect, it } from "vitest"

import {
  VIDEO_DB_BACKUP_PROFILES,
  VideoDbBackupError,
  buildBackupPlan,
  buildBackupObjectKey,
  buildRestorePlan,
  parseArgs,
  parseProfile,
} from "./video-db-backup"

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
    expect(plan.commands[0]?.env).toEqual({
      PGDATABASE: "postgresql://user:pass@example.com/prod",
    })
    expect(plan.commands[0]?.args).toEqual(
      expect.arrayContaining([
        "--format=custom",
        "--data-only",
        "--no-owner",
        "--no-acl",
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
    expect(plan.commands[0]?.env).toEqual({
      PGDATABASE: "postgresql://user:pass@localhost/dev",
    })
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
        "--table=public.video",
        "--table=public.video_transcript_chunk",
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
})
