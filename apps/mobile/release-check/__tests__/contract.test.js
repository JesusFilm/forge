/* eslint-disable @typescript-eslint/no-require-imports */
/* global describe, expect, it, require */
// KTD13: the command-line contract. A refusal exits 2 before any side effect
// and prints the error, the expected format, and one corrected example.
const childProcess = require("node:child_process")
const path = require("node:path")

const { parseArgs, validateAgainstSchema } = require("../lib/contract")
const { readJson } = require("../lib/lists")

const CLI = path.join(__dirname, "..", "cli.mjs")
const SUMMARY_SCHEMA = readJson(
  path.join(__dirname, "..", "schema", "summary.schema.json"),
)

function runCli(args) {
  return childProcess.spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
  })
}

describe("cli.mjs refusals", () => {
  it("refuses an unknown mode with exit 2, the allowed modes, and one corrected example", () => {
    const result = runCli(["chek-lists"])
    expect(result.status).toBe(2)
    expect(result.stdout).toBe("")
    expect(result.stderr.trim().split("\n")).toEqual([
      "release-check refused: unknown mode `chek-lists`.",
      "Allowed modes: plan, setup, run, status, stop, recover, check-lists, check-screens, check-build, check-log, check-settings, record-search, session.",
      "Usage: node apps/mobile/release-check/cli.mjs <mode> [flags]",
      "Example: node apps/mobile/release-check/cli.mjs check-lists --json",
    ])
  })

  it("refuses an unknown flag with exit 2 and the mode's own format", () => {
    const result = runCli(["check-lists", "--jsn"])
    expect(result.status).toBe(2)
    expect(result.stderr.trim().split("\n")).toEqual([
      "release-check refused: unknown flag `--jsn` for `check-lists`.",
      "Usage: node apps/mobile/release-check/cli.mjs check-lists [--json]",
      "Example: node apps/mobile/release-check/cli.mjs check-lists --json",
    ])
  })

  it("refuses a valid mode that is not built yet with exit 2", () => {
    const result = runCli(["run", "--yes", "--platform", "ios"])
    expect(result.status).toBe(2)
    expect(result.stderr).toContain("`run` is not built yet")
  })
})

describe("parseArgs", () => {
  it("reads the run flags into one command", () => {
    expect(
      parseArgs([
        "run",
        "--yes",
        "--expect-commit",
        "2bcf98e19",
        "--journey",
        "cold-launch-home,search",
        "--platform",
        "android",
      ]),
    ).toEqual({
      ok: true,
      mode: "run",
      subcommand: null,
      positionals: [],
      flags: {
        yes: true,
        "expect-commit": "2bcf98e19",
        journey: ["cold-launch-home", "search"],
        platform: "android",
      },
    })
  })

  it("refuses a platform outside ios and android", () => {
    const parsed = parseArgs(["run", "--platform", "web"])
    expect(parsed.ok).toBe(false)
    expect(parsed.error).toBe("`--platform` must be one of ios, android")
  })

  it("reads a session step and refuses `session up` with no device", () => {
    expect(parseArgs(["session", "try", "settings-probe"])).toMatchObject({
      ok: true,
      mode: "session",
      subcommand: "try",
      positionals: ["settings-probe"],
    })
    expect(parseArgs(["session", "up"])).toMatchObject({
      ok: false,
      error: "`session up` needs `--device`",
    })
  })
})

describe("summary.schema.json", () => {
  const minimal = {
    schemaVersion: 1,
    runId: "2026-10-22T09-00-00Z-a1b2",
    scope: "release",
    result: "pass",
    stopReason: "completed",
    commit: "2bcf98e19a1b2c3d4e5f60718293a4b5c6d7e8f9",
    startedAt: "2026-10-22T09:00:00.000Z",
    endedAt: "2026-10-22T10:30:00.000Z",
  }

  it("accepts a minimal valid summary", () => {
    expect(validateAgainstSchema(SUMMARY_SCHEMA, minimal)).toEqual([])
  })

  it("rejects a summary without scope", () => {
    const withoutScope = { ...minimal }
    delete withoutScope.scope
    expect(validateAgainstSchema(SUMMARY_SCHEMA, withoutScope)).toEqual([
      "summary.scope is required",
    ])
  })

  it("throws on a schema keyword the validator does not check", () => {
    expect(() =>
      validateAgainstSchema({ type: "object", oneOf: [] }, minimal),
    ).toThrow("summary schema keyword `oneOf` is not supported")
  })
})
