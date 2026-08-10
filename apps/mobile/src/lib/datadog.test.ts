// Factory returns literals only (no outer refs) to avoid jest hoist/TDZ issues;
// tests mutate the mocked `env` object, which datadog.ts (and config.ts) read by
// reference. DEFAULT_ADMIN_GRAPHQL_URL is exported because config.ts imports it.
jest.mock("../env", () => ({
  env: {
    EXPO_PUBLIC_ADMIN_GRAPHQL_URL: "https://admin.jesusfilm.org/api/graphql",
    EXPO_PUBLIC_ADMIN_GRAPHQL_TOKEN: undefined,
    EXPO_PUBLIC_DATADOG_CLIENT_TOKEN: undefined,
    EXPO_PUBLIC_DATADOG_APPLICATION_ID: undefined,
    EXPO_PUBLIC_DATADOG_SITE: undefined,
    EXPO_PUBLIC_DATADOG_ENV: undefined,
    EXPO_PUBLIC_DATADOG_VERSION: undefined,
    EXPO_PUBLIC_DATADOG_SESSION_SAMPLE_RATE: undefined,
    EXPO_PUBLIC_DATADOG_REPLAY_SAMPLE_RATE: undefined,
  },
  DEFAULT_ADMIN_GRAPHQL_URL: "https://admin.jesusfilm.org/api/graphql",
}))

// The native module only exists in a prebuilt dev-client; mock it so the pure
// helpers can be unit-tested. DdRum/DdLogs methods return promises in the real
// SDK — the mocks must too, or the wrappers' .catch chains would throw.
jest.mock("@datadog/mobile-react-native", () => ({
  DdLogs: {
    info: jest.fn().mockResolvedValue(undefined),
    warn: jest.fn().mockResolvedValue(undefined),
    error: jest.fn().mockResolvedValue(undefined),
  },
  DdRum: {
    addError: jest.fn().mockResolvedValue(undefined),
    startView: jest.fn().mockResolvedValue(undefined),
    addTiming: jest.fn().mockResolvedValue(undefined),
  },
  ErrorSource: { SOURCE: "SOURCE" },
  PropagatorType: { TRACECONTEXT: "tracecontext" },
  RumActionType: { CUSTOM: "custom" },
  DATADOG_GRAPH_QL_OPERATION_NAME_HEADER: "x-dd-graph-ql-operation-name",
  DATADOG_GRAPH_QL_OPERATION_TYPE_HEADER: "x-dd-graph-ql-operation-type",
}))

import {
  DATADOG_GRAPH_QL_OPERATION_NAME_HEADER,
  DATADOG_GRAPH_QL_OPERATION_TYPE_HEADER,
  DdLogs,
  DdRum,
} from "@datadog/mobile-react-native"
import { env } from "../env"
import {
  addDatadogTiming,
  capErrorMessage,
  capErrorMessageWithMeta,
  createDatadogInitWatchdog,
  datadogGraphqlHeaders,
  datadogLog,
  getDatadogRumConfig,
  hostFromUrl,
  isDatadogProvisioned,
  isSheetViewRoute,
  parseSampleRate,
  reportDatadogError,
  resolveViewName,
  startDatadogView,
  toFirstPartyHostConfigs,
} from "./datadog"

const mockEnv = env as unknown as Record<string, string | undefined>
const mockAddError = DdRum.addError as jest.Mock
const mockStartView = DdRum.startView as jest.Mock
const mockAddTiming = DdRum.addTiming as jest.Mock
const mockLogInfo = DdLogs.info as jest.Mock
const mockLogWarn = DdLogs.warn as jest.Mock
const mockLogError = DdLogs.error as jest.Mock

const flushMicrotasks = () =>
  new Promise<void>((resolve) => setTimeout(resolve, 0))

function resetEnv() {
  mockEnv.EXPO_PUBLIC_ADMIN_GRAPHQL_URL =
    "https://admin.jesusfilm.org/api/graphql"
  mockEnv.EXPO_PUBLIC_DATADOG_CLIENT_TOKEN = undefined
  mockEnv.EXPO_PUBLIC_DATADOG_APPLICATION_ID = undefined
  mockEnv.EXPO_PUBLIC_DATADOG_SITE = undefined
  mockEnv.EXPO_PUBLIC_DATADOG_ENV = undefined
  mockEnv.EXPO_PUBLIC_DATADOG_VERSION = undefined
  mockEnv.EXPO_PUBLIC_DATADOG_SESSION_SAMPLE_RATE = undefined
  mockEnv.EXPO_PUBLIC_DATADOG_REPLAY_SAMPLE_RATE = undefined
}

beforeEach(() => {
  resetEnv()
  jest.clearAllMocks()
  mockAddError.mockResolvedValue(undefined)
  mockStartView.mockResolvedValue(undefined)
  mockLogInfo.mockResolvedValue(undefined)
})

describe("hostFromUrl", () => {
  it("returns the bare hostname — no scheme, path, query, or port", () => {
    expect(hostFromUrl("https://admin.jesusfilm.org/api/graphql")).toBe(
      "admin.jesusfilm.org",
    )
    // Port MUST be stripped: the SDK matches first-party hosts against the
    // request's port-less hostname, so "localhost:3003" would never match.
    expect(hostFromUrl("http://localhost:3003/api/graphql")).toBe("localhost")
    expect(hostFromUrl("https://admin.jesusfilm.org:8443/api?x=1")).toBe(
      "admin.jesusfilm.org",
    )
  })
})

describe("toFirstPartyHostConfigs", () => {
  it("maps bare hosts to the SDK's tracecontext propagator shape", () => {
    expect(toFirstPartyHostConfigs(["admin.jesusfilm.org"])).toEqual([
      { match: "admin.jesusfilm.org", propagatorTypes: ["tracecontext"] },
    ])
  })
})

describe("parseSampleRate", () => {
  it("defaults when unset, empty, non-numeric, or out of [0,100]", () => {
    expect(parseSampleRate(undefined, 100)).toBe(100)
    expect(parseSampleRate("", 100)).toBe(100)
    expect(parseSampleRate("nope", 100)).toBe(100)
    expect(parseSampleRate("-5", 100)).toBe(100)
    expect(parseSampleRate("150", 100)).toBe(100)
  })
  it("reads a valid rate from the env string", () => {
    expect(parseSampleRate("0", 100)).toBe(0)
    expect(parseSampleRate("20", 100)).toBe(20)
    expect(parseSampleRate("50", 100)).toBe(50)
  })
})

describe("getDatadogRumConfig (provisioning gate)", () => {
  it("returns null when neither credential is set", () => {
    expect(getDatadogRumConfig()).toBeNull()
  })

  // The gate that keeps an unprovisioned build booting: BOTH creds required.
  it("returns null when only one of token / app id is set", () => {
    mockEnv.EXPO_PUBLIC_DATADOG_CLIENT_TOKEN = "ct"
    expect(getDatadogRumConfig()).toBeNull()
    resetEnv()
    mockEnv.EXPO_PUBLIC_DATADOG_APPLICATION_ID = "app"
    expect(getDatadogRumConfig()).toBeNull()
  })

  it("maps env to config when both are provisioned, defaulting site/env/rate", () => {
    mockEnv.EXPO_PUBLIC_DATADOG_CLIENT_TOKEN = "ct"
    mockEnv.EXPO_PUBLIC_DATADOG_APPLICATION_ID = "app"
    expect(getDatadogRumConfig()).toEqual({
      clientToken: "ct",
      applicationId: "app",
      site: "US1",
      // __DEV__ is true under jest; release builds default to "prod".
      envName: "development",
      version: undefined,
      sessionSampleRate: 100,
      replaySampleRate: 100,
      firstPartyHosts: ["admin.jesusfilm.org"],
    })
  })

  it("defaults env to prod on a release build (no override)", () => {
    // Force the release branch (jest sets __DEV__ = true) to prove the fallback
    // tags "prod" — matching web — not the old "production".
    const g = globalThis as unknown as { __DEV__: boolean }
    const originalDev = g.__DEV__
    g.__DEV__ = false
    try {
      mockEnv.EXPO_PUBLIC_DATADOG_CLIENT_TOKEN = "ct"
      mockEnv.EXPO_PUBLIC_DATADOG_APPLICATION_ID = "app"
      expect(getDatadogRumConfig()?.envName).toBe("prod")
    } finally {
      g.__DEV__ = originalDev
    }
  })

  it("reads sessionSampleRate from env, diverging from TV's hardcoded 100", () => {
    mockEnv.EXPO_PUBLIC_DATADOG_CLIENT_TOKEN = "ct"
    mockEnv.EXPO_PUBLIC_DATADOG_APPLICATION_ID = "app"
    mockEnv.EXPO_PUBLIC_DATADOG_SESSION_SAMPLE_RATE = "20"
    expect(getDatadogRumConfig()?.sessionSampleRate).toBe(20)
  })

  it("reads replaySampleRate from its own env var (prod dial-down, U11)", () => {
    mockEnv.EXPO_PUBLIC_DATADOG_CLIENT_TOKEN = "ct"
    mockEnv.EXPO_PUBLIC_DATADOG_APPLICATION_ID = "app"
    mockEnv.EXPO_PUBLIC_DATADOG_REPLAY_SAMPLE_RATE = "20"
    expect(getDatadogRumConfig()?.replaySampleRate).toBe(20)
  })

  it("honors explicit site / env / version overrides", () => {
    mockEnv.EXPO_PUBLIC_DATADOG_CLIENT_TOKEN = "ct"
    mockEnv.EXPO_PUBLIC_DATADOG_APPLICATION_ID = "app"
    mockEnv.EXPO_PUBLIC_DATADOG_SITE = "EU1"
    mockEnv.EXPO_PUBLIC_DATADOG_ENV = "production"
    mockEnv.EXPO_PUBLIC_DATADOG_VERSION = "1.2.3"
    expect(getDatadogRumConfig()).toMatchObject({
      site: "EU1",
      envName: "production",
      version: "1.2.3",
    })
  })
})

describe("reportDatadogError (never-throw contract)", () => {
  it("forwards message, stack, and context to DdRum.addError", () => {
    const err = new Error("boom")
    reportDatadogError(err, { origin: "test" })
    expect(mockAddError).toHaveBeenCalledWith(
      "boom",
      "SOURCE",
      err.stack ?? "",
      {
        origin: "test",
      },
    )
  })

  it("coerces non-Error values via new Error(String(...))", () => {
    reportDatadogError("plain failure")
    expect(mockAddError).toHaveBeenCalledWith(
      "plain failure",
      "SOURCE",
      expect.any(String),
      {},
    )
  })

  it("swallows a synchronously-throwing DdRum.addError", () => {
    mockAddError.mockImplementationOnce(() => {
      throw new Error("native bridge down")
    })
    expect(() => reportDatadogError(new Error("x"))).not.toThrow()
  })

  it("swallows an async DdRum.addError rejection", async () => {
    mockAddError.mockRejectedValueOnce(new Error("intake unreachable"))
    expect(() => reportDatadogError(new Error("x"))).not.toThrow()
    await flushMicrotasks() // an uncaught rejection here would fail the test run
  })
})

describe("isDatadogProvisioned (cheap hot-path gate)", () => {
  it("mirrors getDatadogRumConfig's both-credentials gate", () => {
    expect(isDatadogProvisioned()).toBe(false)
    mockEnv.EXPO_PUBLIC_DATADOG_CLIENT_TOKEN = "ct"
    expect(isDatadogProvisioned()).toBe(false)
    mockEnv.EXPO_PUBLIC_DATADOG_APPLICATION_ID = "app"
    expect(isDatadogProvisioned()).toBe(true)
  })
})

describe("resolveViewName (route-pattern view identity)", () => {
  it("names by route pattern, keys by literal pathname", () => {
    const a = resolveViewName(["series", "[slug]"], "/series/mark")
    const b = resolveViewName(["series", "[slug]"], "/series/luke")
    expect(a).toEqual({ key: "/series/mark", name: "series/[slug]" })
    // Bounded name cardinality: one facetable "series" view across all slugs.
    expect(b.name).toBe(a.name)
    expect(b.key).not.toBe(a.key)
  })

  it("maps the root index route to a stable home name", () => {
    expect(resolveViewName([], "/")).toEqual({ key: "/", name: "home" })
  })

  it("names static routes by their pattern", () => {
    expect(resolveViewName(["search"], "/search")).toEqual({
      key: "/search",
      name: "search",
    })
  })

  it("falls back to the pathname when segments are empty off-root", () => {
    expect(resolveViewName([], "/unknown")).toEqual({
      key: "/unknown",
      name: "/unknown",
    })
  })
})

describe("datadogGraphqlHeaders (per-operation attribution)", () => {
  it("maps a named operation to the SDK's attribution headers", () => {
    expect(datadogGraphqlHeaders("GetVideoBySlug", "query")).toEqual({
      [DATADOG_GRAPH_QL_OPERATION_NAME_HEADER]: "GetVideoBySlug",
      [DATADOG_GRAPH_QL_OPERATION_TYPE_HEADER]: "query",
    })
  })

  it("omits the type header when the operation type is unknown", () => {
    expect(datadogGraphqlHeaders("Search", undefined)).toEqual({
      [DATADOG_GRAPH_QL_OPERATION_NAME_HEADER]: "Search",
    })
  })

  it("returns no headers for anonymous operations", () => {
    expect(datadogGraphqlHeaders(undefined, "query")).toEqual({})
    expect(datadogGraphqlHeaders("", "query")).toEqual({})
  })
})

describe("startDatadogView (never-throw contract)", () => {
  it("forwards key and name to DdRum.startView", () => {
    startDatadogView("/series/mark", "series/[slug]")
    expect(mockStartView).toHaveBeenCalledWith("/series/mark", "series/[slug]")
  })

  it("swallows a synchronously-throwing DdRum.startView", () => {
    mockStartView.mockImplementationOnce(() => {
      throw new Error("native bridge down")
    })
    expect(() => startDatadogView("/", "home")).not.toThrow()
  })

  it("swallows an async DdRum.startView rejection", async () => {
    mockStartView.mockRejectedValueOnce(new Error("intake unreachable"))
    expect(() => startDatadogView("/", "home")).not.toThrow()
    await flushMicrotasks()
  })
})

describe("addDatadogTiming (never-throw contract)", () => {
  it("forwards the timing name to DdRum.addTiming", () => {
    addDatadogTiming("home_feed_ready")
    expect(mockAddTiming).toHaveBeenCalledWith("home_feed_ready")
  })

  it("swallows a synchronously-throwing DdRum.addTiming", () => {
    mockAddTiming.mockImplementationOnce(() => {
      throw new Error("native bridge down")
    })
    expect(() => addDatadogTiming("t")).not.toThrow()
  })

  it("swallows an async DdRum.addTiming rejection", async () => {
    mockAddTiming.mockRejectedValueOnce(new Error("intake unreachable"))
    expect(() => addDatadogTiming("t")).not.toThrow()
    await flushMicrotasks()
  })
})

describe("createDatadogInitWatchdog (one-shot per process)", () => {
  let warnSpy: jest.SpyInstance

  beforeEach(() => {
    jest.useFakeTimers()
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => undefined)
  })

  afterEach(() => {
    jest.useRealTimers()
    warnSpy.mockRestore()
  })

  it("stays silent when init completes before the deadline", () => {
    const wd = createDatadogInitWatchdog({ dev: true })
    wd.arm()
    wd.markInitialized()
    jest.advanceTimersByTime(20_000)
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it("warns exactly once when the deadline passes without init", () => {
    const wd = createDatadogInitWatchdog({ dev: true })
    wd.arm()
    jest.advanceTimersByTime(10_000)
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy.mock.calls[0][0]).toContain("[datadog]")
    jest.advanceTimersByTime(30_000)
    expect(warnSpy).toHaveBeenCalledTimes(1)
  })

  it("treats a second arm as a no-op (Fast Refresh double mount)", () => {
    const wd = createDatadogInitWatchdog({ dev: true })
    wd.arm()
    wd.arm()
    jest.advanceTimersByTime(20_000)
    expect(warnSpy).toHaveBeenCalledTimes(1)
  })

  it("never re-arms after init completed (remount against a live SDK)", () => {
    // onInitialization fires at most once per JS process (the SDK inits behind
    // a globalThis singleton) — a remount must not start a fresh false-warn timer.
    const wd = createDatadogInitWatchdog({ dev: true })
    wd.arm()
    wd.markInitialized()
    wd.arm()
    jest.advanceTimersByTime(20_000)
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it("never warns in release builds", () => {
    const wd = createDatadogInitWatchdog({ dev: false })
    wd.arm()
    jest.advanceTimersByTime(20_000)
    expect(warnSpy).not.toHaveBeenCalled()
  })
})

describe("datadogLog (never-throw contract)", () => {
  it("forwards message and context to DdLogs", () => {
    datadogLog.info("hello", { a: 1 })
    expect(mockLogInfo).toHaveBeenCalledWith("hello", { a: 1 })
    datadogLog.warn("careful", { b: 2 })
    expect(mockLogWarn).toHaveBeenCalledWith("careful", { b: 2 })
    datadogLog.error("boom", { c: 3 })
    expect(mockLogError).toHaveBeenCalledWith("boom", { c: 3 })
  })

  it("swallows a synchronously-throwing DdLogs call on every level", () => {
    for (const mock of [mockLogInfo, mockLogWarn, mockLogError]) {
      mock.mockImplementationOnce(() => {
        throw new Error("native bridge down")
      })
    }
    expect(() => datadogLog.info("x")).not.toThrow()
    expect(() => datadogLog.warn("x")).not.toThrow()
    expect(() => datadogLog.error("x")).not.toThrow()
  })

  it("swallows an async DdLogs rejection", async () => {
    mockLogInfo.mockRejectedValueOnce(new Error("intake unreachable"))
    expect(() => datadogLog.info("hello")).not.toThrow()
    await flushMicrotasks()
  })
})

// CombinedGraphQLErrors concatenates every error — prod carried "Unexpected
// error." x200 as one message. Error Tracking groups by message, so uncapped it
// bloats payloads AND splits one fault into many count-dependent issues.
describe("capErrorMessage (runaway CombinedGraphQLErrors messages)", () => {
  it("leaves a normal message untouched", () => {
    expect(capErrorMessage("rate limited")).toBe("rate limited")
  })

  it("collapses a repeated fault to a single grouping key", () => {
    expect(capErrorMessage("Unexpected error.\nUnexpected error.")).toBe(
      "Unexpected error.",
    )
  })

  it("reduces the real prod shape to one short line", () => {
    const capped = capErrorMessage("Unexpected error.\n".repeat(200))
    expect(capped).toBe("Unexpected error.")
  })

  // THE point of the change: prod produced five separate Error Tracking issues
  // for one fault because each response carried a different number of copies.
  // Every length of the same repeated fault must now be byte-identical.
  it.each([2, 9, 13, 60, 200])(
    "yields an identical message for a run of %i copies",
    (n) => {
      expect(capErrorMessage("Unexpected error.\n".repeat(n))).toBe(
        capErrorMessage("Unexpected error."),
      )
    },
  )

  // A dropped blank line must not let two identical faults survive as distinct
  // grouping keys — the exact hole a raw previous-element compare left open.
  it("collapses duplicates separated by a blank line", () => {
    expect(capErrorMessage("Unexpected error.\n\nUnexpected error.")).toBe(
      capErrorMessage("Unexpected error."),
    )
    expect(capErrorMessage("Unexpected error.\n\n".repeat(50))).toBe(
      "Unexpected error.",
    )
  })

  // Dedupe must not erase genuinely different errors in a partial-failure body.
  it("keeps distinct errors while collapsing the repeats around them", () => {
    const mixed = "Unexpected error.\nUnexpected error.\nrate limited\n"
    expect(capErrorMessage(mixed)).toBe("Unexpected error. rate limited")
  })

  // A message still over the cap after deduping must be truncated.
  it("caps a long run of distinct errors", () => {
    const distinct = Array.from(
      { length: 60 },
      (_, i) => `field ${i} is invalid`,
    ).join("\n")
    const capped = capErrorMessage(distinct)
    expect(capped.length).toBeLessThan(360)
    expect(capped.endsWith("… (truncated)")).toBe(true)
  })

  // THE property this function exists for. A length-dependent suffix made two
  // different-length renderings of one fault into two Error Tracking issues —
  // exactly the splitting the cap was added to stop.
  it("gives two different over-cap lengths of one fault the same message", () => {
    const run = (n: number) =>
      capErrorMessage(
        Array.from({ length: n }, (_, i) => `field ${i} is invalid`).join("\n"),
      )
    expect(run(60)).toBe(run(70))
  })

  // The dropped-byte count still has to survive — in the context, not the message.
  it("reports the dropped char count out of band", () => {
    const long = "x".repeat(1000)
    expect(capErrorMessageWithMeta(long).truncatedChars).toBe(700)
    expect(capErrorMessageWithMeta("short").truncatedChars).toBe(0)
  })

  it("attaches message_truncated_chars to the RUM context when truncated", () => {
    mockAddError.mockClear()
    reportDatadogError(new Error("x".repeat(1000)), { origin: "test" })
    const ctx = mockAddError.mock.calls[0]?.[3] as Record<string, unknown>
    expect(ctx.message_truncated_chars).toBe(700)
  })

  it("omits message_truncated_chars when nothing was dropped", () => {
    mockAddError.mockClear()
    reportDatadogError(new Error("short"), { origin: "test" })
    const ctx = mockAddError.mock.calls[0]?.[3] as Record<string, unknown>
    expect(ctx).not.toHaveProperty("message_truncated_chars")
  })

  it("reports the error message through DdRum capped, not raw", () => {
    mockAddError.mockClear()
    reportDatadogError(new Error("Unexpected error.\n".repeat(200)))
    const [message] = mockAddError.mock.calls[0] as [string]
    expect(message.length).toBeLessThan(360)
  })
})

// Sheets are real routes, so each used to end the watch view and start its own —
// fragmenting one playback into several short views and under-reporting watch
// time. Matched on the route PATTERN, never the literal path.
describe("isSheetViewRoute", () => {
  it.each([
    ["watch", "language"],
    ["watch", "subtitle"],
    ["watch", "download"],
    ["series", "language"],
    ["series", "subtitle"],
    ["series", "download"],
  ])("treats %s/%s as a sheet", (a, b) => {
    expect(isSheetViewRoute([a, b])).toBe(true)
  })

  // The discriminating case: a dynamic slug resolves to the "[slug]" pattern, so
  // a video whose slug is literally "language" still starts its own view.
  it("does not treat watch/[slug] as a sheet", () => {
    expect(isSheetViewRoute(["watch", "[slug]"])).toBe(false)
  })

  it.each([
    [["(tabs)"]],
    [["(tabs)", "library"]],
    [["series", "[slug]"]],
    [["experience", "[slug]"]],
  ])("does not treat %s as a sheet", (segments) => {
    expect(isSheetViewRoute(segments as string[])).toBe(false)
  })
})
