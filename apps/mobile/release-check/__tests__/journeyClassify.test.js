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
  readServerLog,
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

describe("blocked requests", () => {
  // The real attempt and server log lines of `search-open-result` on
  // android-phone, record 2026-10-22T08-08-58Z-b8e9.
  const dir = path.join(FIXTURES, "blocked-write-android")
  const lines = readServerLog(path.join(dir, "server-log.jsonl"))
  const window = {
    deviceId: "android-phone",
    startMs: Date.parse("2026-10-22T08:11:36.000Z"),
    endMs: Date.parse("2026-10-22T08:12:23.137Z"),
  }
  const videoRead = lines.find((line) => line.opName === "GetVideoBySlug")
  // SYNTHETIC: the real GetVideoBySlug line as the server would log it if it
  // blocked that query, and a body that did not parse (`blocked("parse-error")`).
  const blockedQuery = {
    ...videoRead,
    route: "blocked",
    reason: "field-unlisted Query.videoBySlug",
  }
  const unparsed = {
    ...videoRead,
    route: "blocked",
    opType: null,
    opName: null,
    rootFields: {},
    reason: "parse-error",
  }

  it("does not give request_blocked for the app's blocked RecordWatchSearchEvent write", () => {
    const write = lines.find(
      (line) => line.deviceId === "android-phone" && line.route === "blocked",
    )
    expect(write.opName).toBe("RecordWatchSearchEvent")
    expect(Date.parse(write.ts)).toBeGreaterThan(window.startMs)
    const server = serverSignals(lines, window)
    expect(server.blocked).toBe(false)
    expect(classifyOutput(dir, { server })).toEqual({
      class: "assertion_failed",
      error: "Assertion is false: id: screen-watch is visible",
    })
  })

  it.each([
    ["a blocked query", blockedQuery],
    ["a request that did not parse", unparsed],
  ])("gives request_blocked for %s in the window", (_name, line) => {
    const server = serverSignals([...lines, line], window)
    expect(classifyOutput(dir, { server }).class).toBe("request_blocked")
  })

  it("ignores a blocked query from another device or outside the window", () => {
    const other = { ...blockedQuery, deviceId: "iphone-se", lane: "ios" }
    const late = { ...blockedQuery, ts: "2026-10-22T08:12:40.000Z" }
    const server = serverSignals([...lines, other, late], window)
    expect(server.blocked).toBe(false)
    expect(classifyOutput(dir, { server }).class).toBe("assertion_failed")
  })
})

describe("upstream errors", () => {
  // The real attempt and server log lines of `collection-autoplay` attempt 1
  // on android-phone, run 2026-10-22T23-44-38Z-d2d1. The window runs from its
  // first step to its attempt event.
  const dir = path.join(FIXTURES, "upstream-error-android")
  const lines = readServerLog(path.join(dir, "server-log.jsonl"))
  const window = {
    deviceId: "android-phone",
    startMs: Date.parse("2026-10-23T00:00:25.869Z"),
    endMs: Date.parse("2026-10-23T00:01:01.698Z"),
  }
  const upstreamLine = lines.find((line) => line.route === "upstream-error")
  const ASSERTION = "Assertion is false: id: screen-experience is visible"

  it("gives upstream_error, and assertion_failed when only the upstream-error line is gone", () => {
    expect(upstreamLine).toMatchObject({
      opName: "GetExperienceBySlug",
      status: 502,
    })
    const withLine = serverSignals(lines, window)
    const withoutLine = serverSignals(
      lines.filter((line) => line !== upstreamLine),
      window,
    )
    expect(classifyOutput(dir, { server: withLine })).toEqual({
      class: "upstream_error",
      error: ASSERTION,
    })
    expect(classifyOutput(dir, { server: withoutLine })).toEqual({
      class: "assertion_failed",
      error: ASSERTION,
    })
  })

  it("ignores an upstream-error line from another device or outside the window", () => {
    const other = { ...upstreamLine, deviceId: "android-tablet" }
    const late = { ...upstreamLine, ts: "2026-10-23T00:01:07.000Z" }
    const rest = lines.filter((line) => line !== upstreamLine)
    const server = serverSignals([...rest, other, late], window)
    expect(server.upstreamError).toBe(false)
    expect(classifyOutput(dir, { server }).class).toBe("assertion_failed")
  })

  it("replaces only assertion_failed and selector_not_found", () => {
    const server = serverSignals(
      [logLine({ route: "upstream-error", status: 502, reason: "network" })],
      WINDOW,
    )
    const classOf = (output, maestro = {}) =>
      classifyFailure({
        deviceProblem: null,
        appEvidence: [],
        server,
        maestro: {
          code: 1,
          timedOut: false,
          stdout: "",
          stderr: "",
          ...maestro,
        },
        output,
        timeoutMs: 600_000,
      }).class
    const real = (name) => readAttemptOutput(path.join(FIXTURES, name))
    // SYNTHETIC: failed steps whose messages match commandClass's crash and
    // driver patterns; no real fixture has one.
    const crash = {
      failed: {
        type: "tapOnElement",
        label: "Tap play",
        error: "App crashed while executing flow",
      },
    }
    const driver = {
      failed: {
        type: "assertConditionCommand",
        label: "Home shows",
        error: "UNAVAILABLE: io exception",
      },
    }
    expect(classOf(real("assertion-ios"))).toBe("upstream_error")
    expect(classOf(real("selector-android"))).toBe("upstream_error")
    expect(classOf(crash)).toBe("app_crashed")
    expect(classOf(driver)).toBe("driver_failed")
    expect(classOf(real("assertion-ios"), { code: null, timedOut: true })).toBe(
      "app_unresponsive",
    )
  })

  it("gives rate_limited, with its Retry-After, when a refusal is in the same window", () => {
    const server = serverSignals(
      [
        logLine({ route: "upstream-error", status: 502, reason: "network" }),
        logLine({ rateLimit: { field: "video", retryAfterMs: 30_000 } }),
      ],
      WINDOW,
    )
    expect(server.retryAfterMs).toBe(30_000)
    expect(
      classifyOutput(path.join(FIXTURES, "assertion-ios"), { server }).class,
    ).toBe("rate_limited")
  })

  it("waits 60 seconds before the retry of an upstream error, and not at all with no server signal", () => {
    expect(serverSignals(lines, window).retryAfterMs).toBe(60_000)
    expect(
      serverSignals(
        lines.filter((line) => line !== upstreamLine),
        window,
      ).retryAfterMs,
    ).toBe(null)
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
