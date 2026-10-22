/* eslint-disable @typescript-eslint/no-require-imports */
/* global describe, expect, it, require */
// One failure class for each failed attempt (KTD14). The Maestro fixtures are
// real Maestro 2.11.0 output from the Forge RC devices on 2026-10-22; the
// assertion fixture renames only its failed selector and label.
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

const {
  androidEventClasses,
  androidExitClasses,
  classifyFailure,
  iosCrashReports,
  serverSignals,
} = require("../lib/journeys/classify")
const { readAttemptOutput } = require("../lib/journeys/results")

const FIXTURES = path.join(__dirname, "fixtures", "journeys")
const DEVICE = "iphone-se"
const UDID = "685DFF5A-547F-4085-816E-100CD6D7492A"
const APP = "org.jesusfilm.forgewatch"
const START = Date.parse("2026-10-22T03:00:00.000Z")
const WINDOW = { deviceId: DEVICE, startMs: START, endMs: START + 60_000 }

function logLine(fields) {
  return {
    ts: new Date(START + 20_000).toISOString(),
    port: 38211,
    lane: "ios",
    deviceId: DEVICE,
    family: "v6",
    method: "POST",
    path: "/api/graphql",
    route: "forwarded",
    opType: "query",
    opName: "VideoThumbnails",
    rootFields: { "Query.video": 27 },
    status: 200,
    ms: 120,
    rateLimit: null,
    search: null,
    reason: null,
    ...fields,
  }
}

function classifyOutput(outputDir, fields = {}) {
  return classifyFailure({
    deviceProblem: null,
    appEvidence: [],
    server: serverSignals([], WINDOW),
    maestro: { code: 1, timedOut: false, stdout: "", stderr: "" },
    output: readAttemptOutput(outputDir),
    timeoutMs: 600_000,
    ...fields,
  })
}

describe("Maestro output", () => {
  it("gives assertion_failed with the step label for a failed assertVisible on screen-watch-language", () => {
    const output = readAttemptOutput(path.join(FIXTURES, "assertion-ios"))
    expect(output.failed.label).toBe("The language sheet shows")
    expect(classifyOutput(path.join(FIXTURES, "assertion-ios"))).toEqual({
      class: "assertion_failed",
      error: "Assertion is false: id: screen-watch-language is visible",
    })
  })

  it("gives selector_not_found for a tapOn whose element is missing", () => {
    expect(classifyOutput(path.join(FIXTURES, "selector-android")).class).toBe(
      "selector_not_found",
    )
  })

  it("gives driver_failed for a run whose iOS driver never answered", () => {
    const stderr = fs.readFileSync(
      path.join(FIXTURES, "driver-ios", "maestro-stderr.txt"),
      "utf8",
    )
    const verdict = classifyOutput(path.join(FIXTURES, "driver-ios"), {
      maestro: { code: 1, timedOut: false, stdout: "", stderr },
    })
    expect(verdict.class).toBe("driver_failed")
    expect(verdict.error).toMatch(/iOS driver not ready in time/)
  })

  it("gives app_unresponsive when the attempt passes its deadline and the device answers", () => {
    const verdict = classifyOutput(path.join(FIXTURES, "assertion-ios"), {
      maestro: { code: null, timedOut: true, stdout: "", stderr: "" },
    })
    expect(verdict.class).toBe("app_unresponsive")
  })

  it("gives device_unresponsive when the device does not answer, whatever Maestro says", () => {
    const verdict = classifyOutput(path.join(FIXTURES, "assertion-ios"), {
      deviceProblem: "simctl listapps did not answer within 20 s",
    })
    expect(verdict).toEqual({
      class: "device_unresponsive",
      error: "simctl listapps did not answer within 20 s",
    })
  })
})

describe("server log lines in the attempt window", () => {
  const adminRefusal = logLine({
    rateLimit: { field: "video", retryAfterMs: 60_000 },
  })

  it("gives rate_limited for an admin refusal inside the window, with its Retry-After", () => {
    const server = serverSignals([adminRefusal], WINDOW)
    expect(server.retryAfterMs).toBe(60_000)
    expect(
      classifyOutput(path.join(FIXTURES, "assertion-ios"), { server }).class,
    ).toBe("rate_limited")
  })

  it("gives rate_limited for the server's own pacing refusal", () => {
    const pacing = logLine({
      route: "rate-limited",
      reason: "hold-over-10000ms video",
    })
    expect(serverSignals([pacing], WINDOW).rateLimited).toBe(true)
  })

  it("ignores a refusal outside the window or from another device", () => {
    const late = logLine({
      ts: new Date(START + 120_000).toISOString(),
      rateLimit: { field: "video", retryAfterMs: 60_000 },
    })
    const early = logLine({
      ts: new Date(START - 30_000).toISOString(),
      rateLimit: { field: "video", retryAfterMs: 60_000 },
    })
    const other = logLine({
      deviceId: "android-phone",
      rateLimit: { field: "video", retryAfterMs: 60_000 },
    })
    const server = serverSignals([early, late, other], WINDOW)
    expect(server.rateLimited).toBe(false)
    expect(
      classifyOutput(path.join(FIXTURES, "assertion-ios"), { server }).class,
    ).toBe("assertion_failed")
  })

  it("maps MISSING_SEARCH_ANSWER and BLOCKED answers to their classes", () => {
    const missing = serverSignals(
      [logLine({ route: "missing-search-answer", opName: "WatchSearch" })],
      WINDOW,
    )
    const blocked = serverSignals(
      [logLine({ route: "blocked", reason: "blocked-field" })],
      WINDOW,
    )
    const dir = path.join(FIXTURES, "assertion-ios")
    expect(classifyOutput(dir, { server: missing }).class).toBe(
      "missing_search_answer",
    )
    expect(classifyOutput(dir, { server: blocked }).class).toBe(
      "request_blocked",
    )
  })
})

describe("crash records of the runner's own devices", () => {
  it("reads app_crashed from a real am_crash event and exit record", () => {
    const crashAt = Date.parse("2026-10-22T02:58:40.944Z")
    const window = { appId: APP, startMs: crashAt - 30_000, endMs: crashAt }
    const events = fs.readFileSync(
      path.join(FIXTURES, "android-crash", "events.txt"),
      "utf8",
    )
    const exits = fs.readFileSync(
      path.join(FIXTURES, "android-crash", "exit-info.txt"),
      "utf8",
    )
    expect(androidEventClasses(events, window)).toEqual(["app_crashed"])
    expect(androidExitClasses(exits, window)).toEqual(["app_crashed"])
    const before = { ...window, startMs: 0, endMs: crashAt - 60_000 }
    expect(androidEventClasses(events, before)).toEqual([])
    expect(androidExitClasses(exits, before)).toEqual([])
  })

  it("reads app_unresponsive from an am_anr event and memory_pressure_kill from a low-memory exit", () => {
    // SYNTHETIC: no real ANR or low-memory kill could be made on the runner
    // emulators; the field order follows Android's event-log-tags and dumpsys.
    const at = 1792637920
    const anr = `         ${at}.100   577   595 I am_anr  : [0,3402,${APP},551042628,Input dispatching timed out]`
    const lowMemory = [
      `          timestamp=2026-10-22 02:58:40.100 pid=3402 realUid=10207 packageUid=10207 definingUid=10207 user=0`,
      `          process=${APP} reason=3 (LOW MEMORY) subreason=0 (UNKNOWN) status=0`,
    ].join("\n")
    const window = { appId: APP, startMs: at * 1000 - 5000, endMs: at * 1000 }
    expect(androidEventClasses(anr, window)).toEqual(["app_unresponsive"])
    expect(androidExitClasses(lowMemory, window)).toEqual([
      "memory_pressure_kill",
    ])
  })

  it("matches an iOS crash report only on the runner's own simulator", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "release-check-ips-"))
    const source = path.join(
      FIXTURES,
      "ios-crash",
      "forgewatch-2026-10-22-161005.ips",
    )
    fs.copyFileSync(source, path.join(dir, path.basename(source)))
    const at = Date.parse("2026-10-22T16:10:04.512+13:00")
    const window = { bundleId: APP, startMs: at - 10_000, endMs: at + 1000 }
    try {
      expect(
        iosCrashReports({ ...window, udid: UDID, reportsDir: dir }),
      ).toHaveLength(1)
      expect(
        iosCrashReports({
          ...window,
          udid: "6F32FC69-5F13-4F48-A30D-EE6CE36FF1C1",
          reportsDir: dir,
        }),
      ).toHaveLength(0)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it("puts crash evidence ahead of the server and Maestro", () => {
    const server = serverSignals(
      [logLine({ rateLimit: { field: "video", retryAfterMs: 60_000 } })],
      WINDOW,
    )
    const verdict = classifyOutput(path.join(FIXTURES, "assertion-ios"), {
      server,
      appEvidence: ["app_crashed", "memory_pressure_kill"],
    })
    expect(verdict.class).toBe("memory_pressure_kill")
  })
})
