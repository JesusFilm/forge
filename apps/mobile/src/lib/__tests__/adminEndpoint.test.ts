import {
  LOCAL_ADMIN_GRAPHQL_URL,
  PRODUCTION_ADMIN_GRAPHQL_URL,
  classifyAdminHost,
  normalizeAdminHost,
  resolveAdminGraphqlUrl,
} from "../adminEndpoint"

const PROD = PRODUCTION_ADMIN_GRAPHQL_URL

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
