import {
  ALLOW_PRODUCTION_ADMIN_ENV_VAR,
  LOCAL_ADMIN_GRAPHQL_URL,
  PRODUCTION_ADMIN_GRAPHQL_URL,
  classifyAdminHost,
  decideAdminEndpointAccess,
  formatAdminEndpointReport,
  normalizeAdminHost,
  reportAdminEndpoint,
  resolveAdminGraphqlUrl,
} from "../adminEndpoint"

const PROD = PRODUCTION_ADMIN_GRAPHQL_URL
const LAN = "http://192.168.1.20:3003/api/graphql"

describe("resolveAdminGraphqlUrl", () => {
  it("falls back to local admin in a development bundle with nothing configured", () => {
    expect(resolveAdminGraphqlUrl(undefined, true, "ios")).toBe(
      LOCAL_ADMIN_GRAPHQL_URL,
    )
  })

  it("falls back to production admin in a release bundle with nothing configured", () => {
    expect(resolveAdminGraphqlUrl(undefined, false, "ios")).toBe(PROD)
  })

  it("returns a configured production URL verbatim in a release bundle", () => {
    expect(resolveAdminGraphqlUrl(PROD, false, "android")).toBe(PROD)
  })

  it("returns a configured local URL, normalized for the platform", () => {
    expect(
      resolveAdminGraphqlUrl("http://127.0.0.1:3003/api/graphql", true, "ios"),
    ).toBe("http://127.0.0.1:3003/api/graphql")
    expect(
      resolveAdminGraphqlUrl(
        "http://127.0.0.1:3003/api/graphql",
        true,
        "android",
      ),
    ).toBe("http://10.0.2.2:3003/api/graphql")
  })

  it("normalizes the development default for the Android emulator", () => {
    expect(resolveAdminGraphqlUrl(undefined, true, "android")).toBe(
      "http://10.0.2.2:3003/api/graphql",
    )
  })
})

describe("normalizeAdminHost", () => {
  it.each(["localhost", "127.0.0.1"])(
    "rewrites %s to the Android emulator alias in development",
    (host) => {
      expect(
        normalizeAdminHost(`http://${host}:3003/api/graphql`, "android", true),
      ).toBe("http://10.0.2.2:3003/api/graphql")
    },
  )

  it.each(["localhost", "127.0.0.1"])("leaves %s alone on iOS", (host) => {
    const url = `http://${host}:3003/api/graphql`
    expect(normalizeAdminHost(url, "ios", true)).toBe(url)
  })

  it.each([
    ["android", "localhost"],
    ["android", "127.0.0.1"],
    ["ios", "localhost"],
    ["ios", "127.0.0.1"],
  ])("does not rewrite on %s outside development (%s)", (platform, host) => {
    const url = `http://${host}:3003/api/graphql`
    expect(normalizeAdminHost(url, platform, false)).toBe(url)
  })

  it("leaves a non-local host alone on Android in development", () => {
    expect(normalizeAdminHost(PROD, "android", true)).toBe(PROD)
    expect(
      normalizeAdminHost(
        "http://192.168.1.20:3003/api/graphql",
        "android",
        true,
      ),
    ).toBe("http://192.168.1.20:3003/api/graphql")
  })

  it("does not rewrite a path or query that merely mentions localhost", () => {
    const url = "https://admin.jesusfilm.org/api/graphql?from=localhost"
    expect(normalizeAdminHost(url, "android", true)).toBe(url)
  })

  it.each(["", "not-a-url", "localhost:3003", "http://"])(
    "returns %p unchanged rather than throwing",
    (url) => {
      expect(() => normalizeAdminHost(url, "android", true)).not.toThrow()
      expect(normalizeAdminHost(url, "android", true)).toBe(url)
    },
  )
})

describe("classifyAdminHost", () => {
  it.each([
    "http://localhost:3003/api/graphql",
    "http://127.0.0.1:3003/api/graphql",
    "http://[::1]:3003/api/graphql",
    "http://10.0.2.2:3003/api/graphql",
  ])("classifies %s as local", (url) => {
    expect(classifyAdminHost(url)).toBe("local")
  })

  it("classifies the production admin host as production", () => {
    expect(classifyAdminHost(PROD)).toBe("production")
    expect(classifyAdminHost("https://admin.jesusfilm.org/anything")).toBe(
      "production",
    )
  })

  it.each([
    // A LAN address for physical-device work — the documented workflow.
    "http://192.168.1.20:3003/api/graphql",
    "http://10.1.2.3:3003/api/graphql",
    // A tunnel.
    "https://abcdef.ngrok-free.app/api/graphql",
    // A teammate's host.
    "http://macbook.local:3003/api/graphql",
  ])("classifies %s as other", (url) => {
    expect(classifyAdminHost(url)).toBe("other")
  })

  it.each([
    "https://admin.jesusfilm.org.evil.example/api/graphql",
    "https://notadmin.jesusfilm.org/api/graphql",
    "https://example.com/admin.jesusfilm.org/api/graphql",
    "https://example.com/api/graphql?to=admin.jesusfilm.org",
  ])("does not classify %s as production on a substring match", (url) => {
    expect(classifyAdminHost(url)).toBe("other")
  })

  it.each([undefined, null, "", "not-a-url", "localhost:3003", "http://"])(
    "classifies %p as other rather than throwing",
    (url) => {
      expect(() => classifyAdminHost(url)).not.toThrow()
      expect(classifyAdminHost(url)).toBe("other")
    },
  )
})

describe("decideAdminEndpointAccess", () => {
  it("refuses a development bundle resolved to production admin", () => {
    const decision = decideAdminEndpointAccess(PROD, true, undefined)
    expect(decision.allowed).toBe(false)
    if (decision.allowed) throw new Error("expected a refusal")
    expect(decision.message).toContain("admin.jesusfilm.org")
    expect(decision.message).toContain(ALLOW_PRODUCTION_ADMIN_ENV_VAR)
  })

  it("allows production admin when the override is set", () => {
    expect(decideAdminEndpointAccess(PROD, true, "1").allowed).toBe(true)
  })

  it("never refuses in a release bundle", () => {
    expect(decideAdminEndpointAccess(PROD, false, undefined).allowed).toBe(true)
  })

  it.each([LOCAL_ADMIN_GRAPHQL_URL, "http://10.0.2.2:3003/api/graphql"])(
    "allows a development bundle on %s",
    (url) => {
      expect(decideAdminEndpointAccess(url, true, undefined).allowed).toBe(true)
    },
  )

  it("allows a LAN address without the override — physical-device work", () => {
    expect(decideAdminEndpointAccess(LAN, true, undefined).allowed).toBe(true)
  })

  it("treats an empty-string override as absent", () => {
    expect(decideAdminEndpointAccess(PROD, true, "").allowed).toBe(false)
  })
})

describe("reportAdminEndpoint", () => {
  let info: jest.SpyInstance

  beforeEach(() => {
    info = jest.spyOn(console, "info").mockImplementation(() => {})
  })

  afterEach(() => {
    info.mockRestore()
  })

  it.each([
    ["the local default", LOCAL_ADMIN_GRAPHQL_URL],
    ["a configured local endpoint", "http://127.0.0.1:3003/api/graphql"],
    ["a LAN address", LAN],
    ["production on the override path", PROD],
  ])("names %s", (_label, url) => {
    reportAdminEndpoint(url, true)
    expect(info).toHaveBeenCalledTimes(1)
    expect(String(info.mock.calls[0][0])).toContain(url)
  })

  it("emits nothing in a release bundle", () => {
    reportAdminEndpoint(PROD, false)
    expect(info).not.toHaveBeenCalled()
  })

  it("names the resolved host kind so a production session is obvious", () => {
    expect(formatAdminEndpointReport(PROD)).toContain("production")
    expect(formatAdminEndpointReport(LOCAL_ADMIN_GRAPHQL_URL)).toContain(
      "local",
    )
  })

  // Datadog drops these attribute names silently on ingest. The report is a
  // plain console line today; this pins that it never grows a bare reserved key.
  it.each(["host", "source", "service", "status", "message", "trace_id"])(
    "uses no key named %s",
    (reserved) => {
      const line = formatAdminEndpointReport(PROD)
      expect(line).not.toMatch(new RegExp(`(^|\\s)${reserved}=`))
    },
  )
})

// Fresh module per test: the unreachable latch is module scope, and "once per
// launch" is exactly what a shared instance across tests would hide.
describe("admin endpoint unreachable signal", () => {
  let mod: typeof import("../adminEndpoint")
  let error: jest.SpyInstance

  beforeEach(() => {
    jest.resetModules()
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mod = require("../adminEndpoint")
    error = jest.spyOn(console, "error").mockImplementation(() => {})
  })

  afterEach(() => {
    error.mockRestore()
  })

  it("starts with no endpoint marked unreachable", () => {
    expect(mod.getUnreachableAdminEndpoint()).toBeNull()
  })

  it("records the endpoint and names it in a loud console error", () => {
    mod.noteAdminEndpointUnreachable(LOCAL_ADMIN_GRAPHQL_URL)
    expect(mod.getUnreachableAdminEndpoint()).toBe(LOCAL_ADMIN_GRAPHQL_URL)
    expect(String(error.mock.calls[0][0])).toContain(LOCAL_ADMIN_GRAPHQL_URL)
  })

  it("emits once per launch, not once per failed query", () => {
    mod.noteAdminEndpointUnreachable(LOCAL_ADMIN_GRAPHQL_URL)
    mod.noteAdminEndpointUnreachable(LOCAL_ADMIN_GRAPHQL_URL)
    mod.noteAdminEndpointUnreachable(LAN)
    expect(error).toHaveBeenCalledTimes(1)
    expect(mod.getUnreachableAdminEndpoint()).toBe(LOCAL_ADMIN_GRAPHQL_URL)
  })

  it("notifies subscribers, and stops after unsubscribe", () => {
    const seen: string[] = []
    const unsubscribe = mod.subscribeAdminEndpointUnreachable(() => {
      seen.push(mod.getUnreachableAdminEndpoint() ?? "")
    })
    mod.noteAdminEndpointUnreachable(LOCAL_ADMIN_GRAPHQL_URL)
    unsubscribe()
    expect(seen).toEqual([LOCAL_ADMIN_GRAPHQL_URL])
  })
})
