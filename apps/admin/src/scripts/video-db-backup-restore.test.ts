import { EventEmitter } from "node:events"

import { afterEach, describe, expect, it, vi } from "vitest"

const commandMocks = vi.hoisted(() => ({
  spawn: vi.fn(),
}))

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>()
  return { ...actual, spawn: commandMocks.spawn }
})

import {
  VIDEO_DB_BACKUP_PROFILES,
  buildRestorePlan,
  executeRestorePlan,
  main,
  parseArgs,
} from "./video-db-backup"

afterEach(() => {
  delete process.env.TARGET_DATABASE_URL
  delete process.env.DATABASE_URL
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

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
      case "archive-payload":
        return ""
      case "target-compatibility":
        return validRestoreTargetState
      default:
        throw new Error(`Unexpected preflight check ${check.check}`)
    }
  })
}

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
      "archive-payload",
      "target-compatibility",
    ])
    expect(plan.preflightCommands.map(({ command }) => command)).toEqual([
      "pg_restore",
      "psql",
      "pg_restore",
      "pg_restore",
      "psql",
    ])
    expect(plan.preflightCommands[2]?.args).toEqual(["--list", plan.inPath])
    expect(plan.preflightCommands[3]?.args).toContain("--file=/dev/null")
    expect(plan.preflightCommands[4]?.args.join(" ")).not.toContain("TRUNCATE")
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
      "archive-payload",
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

  it("records restore duration after successful preflight and import", async () => {
    process.env.TARGET_DATABASE_URL = "postgresql://localhost/dev"
    mockSuccessfulRestore(undefined, "video-search")
    const stdout = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true)

    await main("restore", [
      "--profile=video-search",
      "--target-env=development",
      "--in=.tmp/video.dump",
    ])

    expect(stdout.mock.calls.map(([value]) => String(value)).join("")).toMatch(
      /"event":"video-db\.restore\.complete","profile":"video-search","tables":\d+,"path":"[^"]+","restoreDurationMs":\d+/,
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
      name: "a truncated archive payload",
      mutate: (capture: ReturnType<typeof successfulRestorePreflight>) =>
        capture.mockImplementation(async (check: { check: string }) => {
          if (check.check === "archive-payload") {
            throw new Error("pg_restore exited with code 1")
          }
          return successfulRestorePreflight("video-search")(check)
        }),
      expected: "could not decode the selected archive payload",
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
      name: "a target missing the required migration",
      mutate: (capture: ReturnType<typeof successfulRestorePreflight>) =>
        capture.mockImplementation(async (check: { check: string }) =>
          check.check === "target-compatibility"
            ? JSON.stringify({
                ...JSON.parse(validRestoreTargetState),
                requiredMigrationApplied: false,
              })
            : successfulRestorePreflight("video-search")(check),
        ),
      expected: "0047_video_locale_search_social_metadata applied",
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
})
