import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const originalEnv = { ...process.env }
const envKeys = [
  "NODE_ENV",
  "DATABASE_URL",
  "ADMIN_GRAPHQL_URL",
  "ADMIN_SERVICE_BEARER_TOKEN",
  "MAPPER_API_TOKEN",
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
