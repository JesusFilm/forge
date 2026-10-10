// Factory returns literals only (no outer refs) to avoid jest hoist/TDZ issues;
// tests mutate the mocked `env` object, which datadog.ts reads by reference.
jest.mock("../env", () => ({
  env: {
    EXPO_PUBLIC_GRAPHQL_URL: "https://admin.jesusfilm.org/api/graphql",
    EXPO_PUBLIC_ADMIN_GRAPHQL_TOKEN: undefined,
    EXPO_PUBLIC_DATADOG_CLIENT_TOKEN: undefined,
    EXPO_PUBLIC_DATADOG_APPLICATION_ID: undefined,
    EXPO_PUBLIC_DATADOG_SITE: undefined,
    EXPO_PUBLIC_DATADOG_ENV: undefined,
    EXPO_PUBLIC_DATADOG_VERSION: undefined,
  },
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
  createDatadogInitWatchdog,
  datadogGraphqlHeaders,
  datadogLog,
  getDatadogRumConfig,
  hostFromUrl,
  isDatadogProvisioned,
  reportDatadogError,
  resolveViewName,
  SERIES_FIRST_RAIL_READY_TIMING,
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
  mockEnv.EXPO_PUBLIC_GRAPHQL_URL = "https://admin.jesusfilm.org/api/graphql"
  mockEnv.EXPO_PUBLIC_DATADOG_CLIENT_TOKEN = undefined
  mockEnv.EXPO_PUBLIC_DATADOG_APPLICATION_ID = undefined
  mockEnv.EXPO_PUBLIC_DATADOG_SITE = undefined
  mockEnv.EXPO_PUBLIC_DATADOG_ENV = undefined
  mockEnv.EXPO_PUBLIC_DATADOG_VERSION = undefined
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

  it("maps env to config when both are provisioned, defaulting site/env", () => {
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
      { origin: "test" },
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
    expect(datadogGraphqlHeaders("GetSeriesBySlug", "query")).toEqual({
      [DATADOG_GRAPH_QL_OPERATION_NAME_HEADER]: "GetSeriesBySlug",
      [DATADOG_GRAPH_QL_OPERATION_TYPE_HEADER]: "query",
    })
  })

  it("omits the type header when the operation type is unknown", () => {
    expect(datadogGraphqlHeaders("SemanticSearch", undefined)).toEqual({
      [DATADOG_GRAPH_QL_OPERATION_NAME_HEADER]: "SemanticSearch",
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
    addDatadogTiming(SERIES_FIRST_RAIL_READY_TIMING)
    expect(mockAddTiming).toHaveBeenCalledWith("series_first_rail_ready")
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
