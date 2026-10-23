/* eslint-disable @typescript-eslint/no-require-imports */
/* global afterAll, describe, expect, it, require */
// check-log (R18, AE10): the log check reads the server log with its own code.
// It trusts no route or rootFields field: it parses the forwarded bytes again.
const crypto = require("node:crypto")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { getOperationAST, print } = require("graphql")

const { checkLogCommand, checkLogText } = require("../lib/server/logCheck")
const { CONFIG_DIR, readJson } = require("../lib/lists")

const {
  GET_EXPERIENCE_BY_SLUG,
  GET_VIDEO_BY_SLUG,
  RECORD_WATCH_SEARCH_EVENT,
  WATCH_SEARCH,
} = require("../../src/lib/queries")
const { GET_MY_WATCH_PROGRESS } = require("../../src/lib/watchProgressQueries")

const operations = readJson(path.join(CONFIG_DIR, "operations.json"))
const IOS_DEVICES = ["iphone-se", "iphone-17-pro-max", "ipad-pro-13"]

const tempDirs = []
afterAll(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true })
})

function bodyOf(document, variables = {}) {
  return JSON.stringify({
    query: print(document),
    variables,
    operationName: getOperationAST(document)?.name?.value ?? null,
  })
}

function sha256(text) {
  return crypto.createHash("sha256").update(text).digest("hex")
}

/** One log line in the shared contract shape; `forwardedBody` sets the digest. */
function line(overrides = {}) {
  const forwardedBody = overrides.forwardedBody ?? bodyOf(GET_VIDEO_BY_SLUG)
  return {
    ts: "2026-10-22T00:00:00.000Z",
    port: 38211,
    lane: "ios",
    deviceId: "iphone-se",
    family: "v6",
    method: "POST",
    path: "/api/graphql",
    route: "forwarded",
    opType: "query",
    opName: "GetVideoBySlug",
    rootFields: { "Query.videoBySlug": 1 },
    forwardedBody,
    forwardedSha256: sha256(forwardedBody),
    status: 200,
    ms: 40,
    rateLimit: null,
    search: null,
    reason: null,
    ...overrides,
  }
}

function logText(lines) {
  return lines.map((entry) => JSON.stringify(entry)).join("\n") + "\n"
}

function check(lines, expectedDevices = ["iphone-se"]) {
  return checkLogText(logText(lines), { operations, expectedDevices })
}

function codes(result) {
  return result.findings.map((item) => item.code)
}

describe("device traffic (AE10)", () => {
  it("fails when one of the three iOS devices on port 38211 sent nothing", () => {
    const result = check(
      [
        line({ deviceId: "iphone-se" }),
        line({ deviceId: "iphone-17-pro-max" }),
      ],
      IOS_DEVICES,
    )
    expect(result.passed).toBe(false)
    expect(result.findings).toEqual([
      {
        code: "DEVICE_NO_TRAFFIC",
        message: expect.stringContaining("ipad-pro-13"),
        setting: null,
        file: null,
        deviceId: "ipad-pro-13",
      },
    ])
    expect(result.perDevice).toEqual({ "iphone-se": 1, "iphone-17-pro-max": 1 })
  })

  it("passes a clean log and counts routes and admin refusals", () => {
    const refusal = { field: "video", retryAfterMs: 60_000 }
    const result = check(
      [
        ...IOS_DEVICES.map((deviceId) => line({ deviceId })),
        line({
          deviceId: "ipad-pro-13",
          forwardedBody: bodyOf(GET_EXPERIENCE_BY_SLUG),
          rateLimit: refusal,
        }),
        {
          ...line({ route: "blocked", deviceId: "iphone-se" }),
          forwardedBody: undefined,
          forwardedSha256: undefined,
        },
      ],
      IOS_DEVICES,
    )
    expect(result.findings).toEqual([])
    expect(result.passed).toBe(true)
    expect(result.routes).toEqual({ forwarded: 4, blocked: 1 })
    expect(result.rateLimitRefusals).toEqual([
      {
        ts: "2026-10-22T00:00:00.000Z",
        field: "video",
        deviceId: "ipad-pro-13",
      },
    ])
  })
})

describe("forwarded bytes", () => {
  it("fails on a field that is not on the read-only list, even when the line says forwarded", () => {
    const result = check([
      line({
        route: "forwarded",
        rootFields: { "Query.videoBySlug": 1 },
        forwardedBody: bodyOf(GET_MY_WATCH_PROGRESS),
      }),
    ])
    expect(codes(result)).toEqual(["FORWARDED_NOT_READ_ONLY"])
    expect(result.findings[0].message).toContain("Query.myWatchProgress")
  })

  it("fails on a forwarded mutation", () => {
    const result = check([
      line({ forwardedBody: bodyOf(RECORD_WATCH_SEARCH_EVENT) }),
    ])
    expect(codes(result)).toContain("FORWARDED_MUTATION")
  })

  it("fails on a forwarded search", () => {
    const result = check([line({ forwardedBody: bodyOf(WATCH_SEARCH) })])
    expect(codes(result)).toEqual(["FORWARDED_SEARCH"])
  })

  it("fails when the forwarded bytes do not match their digest", () => {
    const result = check([line({ forwardedSha256: sha256("other bytes") })])
    expect(codes(result)).toEqual(["DIGEST_MISMATCH"])
  })

  it.each([
    ["bytes that are not JSON", "{ not json"],
    ["a document that does not parse", JSON.stringify({ query: "query {" })],
    [
      "a spread of a missing fragment",
      JSON.stringify({ query: "query Q { ...Missing }" }),
    ],
    [
      "two operations",
      JSON.stringify({
        query: `${print(GET_VIDEO_BY_SLUG)}\n${print(RECORD_WATCH_SEARCH_EVENT)}`,
      }),
    ],
  ])("fails closed on %s", (_label, forwardedBody) => {
    expect(codes(check([line({ forwardedBody })]))).toEqual([
      "FORWARDED_BODY_UNREADABLE",
    ])
  })

  it("checks forwarded bytes on a line whose route is not forwarded", () => {
    const result = check([
      line({ route: "blocked", forwardedBody: bodyOf(GET_MY_WATCH_PROGRESS) }),
    ])
    expect(codes(result)).toEqual(["FORWARDED_NOT_READ_ONLY"])
  })

  it.each([
    [
      "a fragment spread",
      "query Q { ...F } fragment F on Query { myWatchProgress { id } }",
    ],
    [
      "an inline fragment",
      "query Q { ... on Query { myWatchProgress { id } } }",
    ],
  ])(
    "fails on a field that is not on the read-only list behind %s",
    (_label, query) => {
      const result = check([line({ forwardedBody: JSON.stringify({ query }) })])
      expect(codes(result)).toEqual(["FORWARDED_NOT_READ_ONLY"])
      expect(result.findings[0].message).toContain("Query.myWatchProgress")
    },
  )

  it("passes a read-only field behind a fragment spread", () => {
    const query =
      'query Q { ...F } fragment F on Query { videoBySlug(slug: "jesus") { id } }'
    const result = check([line({ forwardedBody: JSON.stringify({ query }) })])
    expect(result.findings).toEqual([])
  })

  it("fails on a forwarded line with no forwarded bytes", () => {
    const result = check([
      { ...line(), forwardedBody: undefined, forwardedSha256: undefined },
    ])
    expect(result.passed).toBe(false)
    expect(codes(result)).toEqual(["FORWARDED_BODY_MISSING"])
  })
})

describe("log lines", () => {
  it.each([
    ["text that is not JSON", "{ not json"],
    ["a JSON array", "[]"],
  ])("fails on a line of %s", (_label, text) => {
    const result = checkLogText(`${JSON.stringify(line())}\n${text}\n`, {
      operations,
      expectedDevices: ["iphone-se"],
    })
    expect(result.passed).toBe(false)
    expect(result.findings).toEqual([
      {
        code: "LOG_LINE_UNREADABLE",
        message: "log line 2 is not one JSON object.",
        setting: null,
        file: null,
        deviceId: null,
      },
    ])
  })
})

describe("check-log <log>", () => {
  function runFolder(lines, run) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "release-check-log-"))
    tempDirs.push(dir)
    const logPath = path.join(dir, "server-log.jsonl")
    fs.writeFileSync(logPath, logText(lines))
    if (run) fs.writeFileSync(path.join(dir, "run.json"), JSON.stringify(run))
    return logPath
  }

  function runCommand(logPath) {
    const output = []
    const exitCode = checkLogCommand(
      { mode: "check-log", flags: {}, positionals: [logPath] },
      { out: (text) => output.push(text) },
    )
    return { exitCode, output: output.join("\n") }
  }

  it("expects the devices in run.json and passes when each sent traffic", () => {
    const logPath = runFolder(
      [line({ deviceId: "android-phone", lane: "androidPhone", port: 38212 })],
      { devices: ["android-phone"] },
    )
    expect(runCommand(logPath)).toEqual({
      exitCode: 0,
      output: "check-log passed (android-phone 1).",
    })
  })

  it("expects all five devices when run.json is absent", () => {
    const { exitCode, output } = runCommand(runFolder([line()]))
    expect(exitCode).toBe(1)
    for (const id of [
      "iphone-17-pro-max",
      "ipad-pro-13",
      "android-phone",
      "android-tablet",
    ]) {
      expect(output).toContain(`DEVICE_NO_TRAFFIC: ${id} sent no request`)
    }
    expect(output).not.toContain("iphone-se sent no request")
  })

  it("refuses with exit 2 when the log file does not exist", () => {
    const missing = path.join(os.tmpdir(), "release-check-no-such-log.jsonl")
    expect(runCommand(missing).exitCode).toBe(2)
  })
})
