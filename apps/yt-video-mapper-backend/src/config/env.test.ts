import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const originalEnv = { ...process.env }
const envKeys = [
  "NODE_ENV",
  "DATABASE_URL",
  "ADMIN_GRAPHQL_URL",
  "ADMIN_SERVICE_BEARER_TOKEN",
  "MAPPER_API_TOKEN",
  "MATCH_JOB_WORKER_ENABLED",
  "MATCH_JOB_CLEANER_ENABLED",
  "MATCH_JOB_WORKER_POLL_INTERVAL_MS",
  "MEDIA_SIGNATURE_ALGORITHM_VERSION",
  "MEDIA_INDEX_PAGE_SIZE",
  "MEDIA_INDEX_MAX_FETCH_BYTES",
  "MEDIA_INDEX_FETCH_TIMEOUT_MS",
  "MEDIA_INDEX_ALLOWED_HOSTS",
  "MEDIA_INDEX_RESUME_AFTER_VARIANT_ID",
]

describe("runtime env", () => {
  beforeEach(() => {
    vi.resetModules()
    resetProcessEnv()
  })

  afterEach(() => {
    vi.resetModules()
    resetProcessEnv()
  })

  it("allows production startup without catalog sync vars", async () => {
    const { assertRuntimeEnv, env } = await loadEnv({
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://forge:forge@localhost:5432/mapper",
      MAPPER_API_TOKEN: "a".repeat(32),
      ADMIN_GRAPHQL_URL: "",
      ADMIN_SERVICE_BEARER_TOKEN: "",
    })

    expect(env.ADMIN_GRAPHQL_URL).toBeUndefined()
    expect(env.ADMIN_SERVICE_BEARER_TOKEN).toBeUndefined()
    expect(assertRuntimeEnv).not.toThrow()
  })

  it("requires the Admin GraphQL URL when running catalog sync", async () => {
    const { assertAdminCatalogSyncEnv } = await loadEnv({
      ADMIN_SERVICE_BEARER_TOKEN: "service-token",
    })

    expect(assertAdminCatalogSyncEnv).toThrow(
      "ADMIN_GRAPHQL_URL is required to sync the yt-video-mapper catalog",
    )
  })

  it("requires the Admin service bearer token when running catalog sync", async () => {
    const { assertAdminCatalogSyncEnv } = await loadEnv({
      ADMIN_GRAPHQL_URL: "https://admin.example.com/graphql",
    })

    expect(assertAdminCatalogSyncEnv).toThrow(
      "ADMIN_SERVICE_BEARER_TOKEN is required to sync the yt-video-mapper catalog",
    )
  })

  it("returns Admin catalog sync configuration when both sync vars are set", async () => {
    const { assertAdminCatalogSyncEnv } = await loadEnv({
      ADMIN_GRAPHQL_URL: "https://admin.example.com/graphql",
      ADMIN_SERVICE_BEARER_TOKEN: "service-token",
    })

    expect(assertAdminCatalogSyncEnv()).toEqual({
      adminGraphqlUrl: "https://admin.example.com/graphql",
      adminServiceBearerToken: "service-token",
    })
  })

  it("defaults media indexing settings and treats empty resume cursor as unset", async () => {
    const { env } = await loadEnv({
      MATCH_JOB_WORKER_ENABLED: "",
      MATCH_JOB_CLEANER_ENABLED: "",
      MATCH_JOB_WORKER_POLL_INTERVAL_MS: "",
      MEDIA_SIGNATURE_ALGORITHM_VERSION: "",
      MEDIA_INDEX_PAGE_SIZE: "",
      MEDIA_INDEX_MAX_FETCH_BYTES: "",
      MEDIA_INDEX_FETCH_TIMEOUT_MS: "",
      MEDIA_INDEX_ALLOWED_HOSTS: "",
      MEDIA_INDEX_RESUME_AFTER_VARIANT_ID: "",
    })

    expect(env.MATCH_JOB_WORKER_ENABLED).toBe("true")
    expect(env.MATCH_JOB_CLEANER_ENABLED).toBe("true")
    expect(env.MATCH_JOB_WORKER_POLL_INTERVAL_MS).toBe(1_000)
    expect(env.MEDIA_SIGNATURE_ALGORITHM_VERSION).toBe(
      "official-media-signature-v1",
    )
    expect(env.MEDIA_INDEX_PAGE_SIZE).toBe(100)
    expect(env.MEDIA_INDEX_MAX_FETCH_BYTES).toBe(262_144)
    expect(env.MEDIA_INDEX_FETCH_TIMEOUT_MS).toBe(15_000)
    expect(env.MEDIA_INDEX_ALLOWED_HOSTS).toBeUndefined()
    expect(env.MEDIA_INDEX_RESUME_AFTER_VARIANT_ID).toBeUndefined()
  })

  it("parses worker and cleaner settings without boolean coercion", async () => {
    const { env } = await loadEnv({
      MATCH_JOB_WORKER_ENABLED: "false",
      MATCH_JOB_CLEANER_ENABLED: "false",
      MATCH_JOB_WORKER_POLL_INTERVAL_MS: "2500",
    })

    expect(env.MATCH_JOB_WORKER_ENABLED).toBe("false")
    expect(env.MATCH_JOB_CLEANER_ENABLED).toBe("false")
    expect(env.MATCH_JOB_WORKER_POLL_INTERVAL_MS).toBe(2_500)
  })

  it("parses media indexing overrides", async () => {
    const { env } = await loadEnv({
      MEDIA_SIGNATURE_ALGORITHM_VERSION: "official-media-signature-v2",
      MEDIA_INDEX_PAGE_SIZE: "25",
      MEDIA_INDEX_MAX_FETCH_BYTES: "1024",
      MEDIA_INDEX_FETCH_TIMEOUT_MS: "5000",
      MEDIA_INDEX_ALLOWED_HOSTS: "media.example.com,cdn.example.com",
      MEDIA_INDEX_RESUME_AFTER_VARIANT_ID: "catalog-variant-123",
    })

    expect(env.MEDIA_SIGNATURE_ALGORITHM_VERSION).toBe(
      "official-media-signature-v2",
    )
    expect(env.MEDIA_INDEX_PAGE_SIZE).toBe(25)
    expect(env.MEDIA_INDEX_MAX_FETCH_BYTES).toBe(1_024)
    expect(env.MEDIA_INDEX_FETCH_TIMEOUT_MS).toBe(5_000)
    expect(env.MEDIA_INDEX_ALLOWED_HOSTS).toBe(
      "media.example.com,cdn.example.com",
    )
    expect(env.MEDIA_INDEX_RESUME_AFTER_VARIANT_ID).toBe("catalog-variant-123")
  })

  it("requires DATABASE_URL in production", async () => {
    const { assertRuntimeEnv } = await loadEnv({
      NODE_ENV: "production",
      MAPPER_API_TOKEN: "a".repeat(32),
    })

    expect(assertRuntimeEnv).toThrow(
      "DATABASE_URL is required for yt-video-mapper-backend production",
    )
  })

  it("requires MAPPER_API_TOKEN in production", async () => {
    const { assertRuntimeEnv } = await loadEnv({
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://forge:forge@localhost:5432/mapper",
    })

    expect(assertRuntimeEnv).toThrow(
      "MAPPER_API_TOKEN is required for yt-video-mapper-backend production",
    )
  })

  it("requires an official media host allowlist for production indexing", async () => {
    const { assertMediaIndexEnv } = await loadEnv({
      NODE_ENV: "production",
      MEDIA_INDEX_ALLOWED_HOSTS: "",
    })

    expect(assertMediaIndexEnv).toThrow(
      "MEDIA_INDEX_ALLOWED_HOSTS is required to index yt-video-mapper official media in production",
    )
  })

  it("returns media index configuration when the production allowlist is set", async () => {
    const { assertMediaIndexEnv } = await loadEnv({
      NODE_ENV: "production",
      MEDIA_INDEX_ALLOWED_HOSTS: "stream.mux.com,api-media-core.jesusfilm.org",
    })

    expect(assertMediaIndexEnv()).toEqual({
      allowedHosts: "stream.mux.com,api-media-core.jesusfilm.org",
    })
  })
})

async function loadEnv(overrides: NodeJS.ProcessEnv) {
  Object.assign(process.env, overrides)

  return import("./env.js")
}

function resetProcessEnv() {
  for (const key of envKeys) {
    delete process.env[key]
  }

  Object.assign(process.env, originalEnv)
}
