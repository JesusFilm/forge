import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const ORIGINAL_ENV = { ...process.env }

function useBaseEnv() {
  process.env.ADMIN_GRAPHQL_URL = "http://localhost:1437/admin/api/graphql"
  process.env.WEB_ADMIN_API_KEYS = "test-admin-bearer-key"
  process.env.REVALIDATION_SECRET = "test-revalidation-secret"
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
  delete process.env.NEXT_PUBLIC_GOOGLE_ANALYTICS_MEASUREMENT_ID
  delete process.env.RAILWAY_ENVIRONMENT_NAME
  delete process.env.RAILWAY_GIT_COMMIT_SHA
  delete process.env.VERCEL_ENV
  delete process.env.VERCEL_GIT_COMMIT_SHA
  delete process.env.GIT_COMMIT_SHA
  delete process.env.WATCH_SEARCH_PRIMARY_MODE
  delete process.env.WATCH_SEARCH_DEFAULT_SHADOW_ENABLED
}

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
    expect(env.NEXT_PUBLIC_GOOGLE_ANALYTICS_MEASUREMENT_ID).toBeUndefined()
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
    process.env.NEXT_PUBLIC_GOOGLE_ANALYTICS_MEASUREMENT_ID = "G-TEST12345"

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
    expect(env.NEXT_PUBLIC_GOOGLE_ANALYTICS_MEASUREMENT_ID).toBe("G-TEST12345")
  })

  it("normalizes deployment env and release fallbacks for Datadog", async () => {
    process.env.RAILWAY_ENVIRONMENT_NAME = "production"
    process.env.RAILWAY_GIT_COMMIT_SHA = "railway-sha"

    const { env } = await import("./env")

    expect(env.NEXT_PUBLIC_DATADOG_ENV).toBe("prod")
    expect(env.NEXT_PUBLIC_DATADOG_VERSION).toBe("railway-sha")
  })
})

describe("web env — Admin GraphQL URL", () => {
  beforeEach(() => {
    vi.resetModules()
    process.env = { ...ORIGINAL_ENV }
    useBaseEnv()
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
  })

  it("allows Railway private-network Admin GraphQL URLs", async () => {
    process.env.ADMIN_GRAPHQL_URL =
      "http://forgeadmin.railway.internal:8080/api/graphql"

    const { env } = await import("./env")

    expect(env.ADMIN_GRAPHQL_URL).toBe(
      "http://forgeadmin.railway.internal:8080/api/graphql",
    )
  })

  it("still rejects known non-GraphQL jesusfilm.org hosts", async () => {
    process.env.ADMIN_GRAPHQL_URL = "https://auth.jesusfilm.org/api/graphql"

    await expect(import("./env")).rejects.toThrow(
      "Invalid environment variables",
    )
  })
})

describe("web env — Watch search rollout", () => {
  beforeEach(() => {
    vi.resetModules()
    process.env = { ...ORIGINAL_ENV }
    useBaseEnv()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    process.env = { ...ORIGINAL_ENV }
  })

  it("keeps local and test processes on DEFAULT", async () => {
    vi.stubEnv("NODE_ENV", "test")

    const { env } = await import("./env")

    expect(env.WATCH_SEARCH_PRIMARY_MODE).toBe("DEFAULT")
    expect(env.WATCH_SEARCH_DEFAULT_SHADOW_ENABLED).toBe(true)
  })

  it("defaults production-mode builds to MODERN", async () => {
    vi.stubEnv("NODE_ENV", "production")

    const { env } = await import("./env")

    expect(env.WATCH_SEARCH_PRIMARY_MODE).toBe("MODERN")
  })

  it("honors the DEFAULT traffic rollback and shadow kill switch", async () => {
    vi.stubEnv("NODE_ENV", "production")
    process.env.WATCH_SEARCH_PRIMARY_MODE = "DEFAULT"
    process.env.WATCH_SEARCH_DEFAULT_SHADOW_ENABLED = "false"

    const { env } = await import("./env")

    expect(env.WATCH_SEARCH_PRIMARY_MODE).toBe("DEFAULT")
    expect(env.WATCH_SEARCH_DEFAULT_SHADOW_ENABLED).toBe(false)
  })
})

describe("web env — user playlist UX rollout", () => {
  beforeEach(() => {
    vi.resetModules()
    process.env = { ...ORIGINAL_ENV }
    useBaseEnv()
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
  })

  it("keeps authoring and anonymous-public-read UX off by default", async () => {
    const { resolveUserPlaylistUxControls } = await import("./env")

    expect(resolveUserPlaylistUxControls()).toMatchObject({
      authoringEnabled: false,
      anonymousPublicReadEnabled: false,
    })
  })

  it("fails malformed UX mirrors closed", async () => {
    const { resolveUserPlaylistUxControls } = await import("./env")

    expect(
      resolveUserPlaylistUxControls({
        authoringEnabled: "invalid",
        anonymousPublicReadEnabled: "true",
        emergencyPublicReadDisabled: "invalid",
      }),
    ).toEqual({
      authoringEnabled: false,
      anonymousPublicReadEnabled: false,
      emergencyPublicReadDisabled: true,
      malformed: true,
    })
  })
})
