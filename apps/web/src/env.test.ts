import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const ORIGINAL_ENV = { ...process.env }

function useBaseEnv() {
  process.env.ADMIN_GRAPHQL_URL = "http://localhost:1437/admin/api/graphql"
  process.env.WEB_ADMIN_API_KEYS = "test-admin-bearer-key"
  process.env.REVALIDATION_SECRET = "test-revalidation-secret"
  delete process.env.YOUVERSION_APP_KEY
  delete process.env.YOUVERSION_DEFAULT_VERSION_ID
  delete process.env.FORGE_WATCH_YOUVERSION_BIBLE_QUOTES_DEFAULT
  delete process.env.DD_AGENT_HOST
  delete process.env.DD_TRACE_AGENT_PORT
  delete process.env.DD_AGENT_SYSLOG_PORT
  delete process.env.DD_ENV
  delete process.env.DD_SERVICE
  delete process.env.DD_VERSION
  delete process.env.NEXT_PUBLIC_DATADOG_APPLICATION_ID
  delete process.env.NEXT_PUBLIC_DATADOG_CLIENT_TOKEN
  delete process.env.NEXT_PUBLIC_DATADOG_SITE
  delete process.env.NEXT_PUBLIC_DATADOG_ENV
  delete process.env.NEXT_PUBLIC_DATADOG_VERSION
  delete process.env.RAILWAY_ENVIRONMENT_NAME
  delete process.env.RAILWAY_GIT_COMMIT_SHA
  delete process.env.VERCEL_ENV
  delete process.env.VERCEL_GIT_COMMIT_SHA
  delete process.env.GIT_COMMIT_SHA
}

describe("web env — YouVersion server config", () => {
  beforeEach(() => {
    vi.resetModules()
    process.env = { ...ORIGINAL_ENV }
    useBaseEnv()
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
  })

  it("imports cleanly without YouVersion config and defaults the Bible version", async () => {
    const { env } = await import("./env")

    expect(env.YOUVERSION_APP_KEY).toBeUndefined()
    expect(env.YOUVERSION_DEFAULT_VERSION_ID).toBe(3034)
    expect(env.FORGE_WATCH_YOUVERSION_BIBLE_QUOTES_DEFAULT).toBeUndefined()
  })

  it("reads the optional YouVersion Bible Quotes LaunchDarkly fallback", async () => {
    process.env.FORGE_WATCH_YOUVERSION_BIBLE_QUOTES_DEFAULT = "true"

    const { env } = await import("./env")

    expect(env.FORGE_WATCH_YOUVERSION_BIBLE_QUOTES_DEFAULT).toBe("true")
  })

  it("treats an empty YouVersion default version as absent", async () => {
    process.env.YOUVERSION_DEFAULT_VERSION_ID = ""

    const { env } = await import("./env")

    expect(env.YOUVERSION_DEFAULT_VERSION_ID).toBe(3034)
  })

  it("coerces a configured YouVersion default version id", async () => {
    process.env.YOUVERSION_APP_KEY = "test-yv-app-key"
    process.env.YOUVERSION_DEFAULT_VERSION_ID = "59"

    const { env } = await import("./env")

    expect(env.YOUVERSION_APP_KEY).toBe("test-yv-app-key")
    expect(env.YOUVERSION_DEFAULT_VERSION_ID).toBe(59)
  })

  it.each(["abc", "0"])(
    "falls back to the default Bible version when configured as %s",
    async (configuredValue) => {
      process.env.YOUVERSION_DEFAULT_VERSION_ID = configuredValue

      const { env } = await import("./env")

      expect(env.YOUVERSION_DEFAULT_VERSION_ID).toBe(3034)
    },
  )
})

describe("web env — Datadog RUM config", () => {
  beforeEach(() => {
    vi.resetModules()
    process.env = { ...ORIGINAL_ENV }
    useBaseEnv()
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
  })

  it("imports cleanly without optional Datadog config", async () => {
    const { env } = await import("./env")

    expect(env.DD_AGENT_HOST).toBeUndefined()
    expect(env.DD_TRACE_AGENT_PORT).toBe(8126)
    expect(env.DD_AGENT_SYSLOG_PORT).toBe(514)
    expect(env.DD_ENV).toBe("test")
    expect(env.DD_SERVICE).toBeUndefined()
    expect(env.DD_VERSION).toBeUndefined()
    expect(env.NEXT_PUBLIC_DATADOG_APPLICATION_ID).toBeUndefined()
    expect(env.NEXT_PUBLIC_DATADOG_CLIENT_TOKEN).toBeUndefined()
    expect(env.NEXT_PUBLIC_DATADOG_SITE).toBe("datadoghq.com")
    expect(env.NEXT_PUBLIC_DATADOG_ENV).toBe("test")
    expect(env.NEXT_PUBLIC_DATADOG_VERSION).toBeUndefined()
  })

  it("reads explicit Datadog config", async () => {
    process.env.DD_AGENT_HOST = "forge-datadog-agent-prd.railway.internal"
    process.env.DD_TRACE_AGENT_PORT = "8127"
    process.env.DD_AGENT_SYSLOG_PORT = "1514"
    process.env.DD_ENV = "prod"
    process.env.DD_SERVICE = "forge-web"
    process.env.DD_VERSION = "server-release-1"
    process.env.NEXT_PUBLIC_DATADOG_APPLICATION_ID = "rum-app-id"
    process.env.NEXT_PUBLIC_DATADOG_CLIENT_TOKEN = "rum-client-token"
    process.env.NEXT_PUBLIC_DATADOG_SITE = "us5.datadoghq.com"
    process.env.NEXT_PUBLIC_DATADOG_ENV = "stage"
    process.env.NEXT_PUBLIC_DATADOG_VERSION = "release-1"

    const { env } = await import("./env")

    expect(env.DD_AGENT_HOST).toBe("forge-datadog-agent-prd.railway.internal")
    expect(env.DD_TRACE_AGENT_PORT).toBe(8127)
    expect(env.DD_AGENT_SYSLOG_PORT).toBe(1514)
    expect(env.DD_ENV).toBe("prod")
    expect(env.DD_SERVICE).toBe("forge-web")
    expect(env.DD_VERSION).toBe("server-release-1")
    expect(env.NEXT_PUBLIC_DATADOG_APPLICATION_ID).toBe("rum-app-id")
    expect(env.NEXT_PUBLIC_DATADOG_CLIENT_TOKEN).toBe("rum-client-token")
    expect(env.NEXT_PUBLIC_DATADOG_SITE).toBe("us5.datadoghq.com")
    expect(env.NEXT_PUBLIC_DATADOG_ENV).toBe("stage")
    expect(env.NEXT_PUBLIC_DATADOG_VERSION).toBe("release-1")
  })

  it("normalizes deployment env and release fallbacks for Datadog", async () => {
    process.env.RAILWAY_ENVIRONMENT_NAME = "production"
    process.env.RAILWAY_GIT_COMMIT_SHA = "railway-sha"

    const { env } = await import("./env")

    expect(env.NEXT_PUBLIC_DATADOG_ENV).toBe("prod")
    expect(env.NEXT_PUBLIC_DATADOG_VERSION).toBe("railway-sha")
  })
})
