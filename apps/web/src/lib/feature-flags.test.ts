import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const ORIGINAL_ENV = { ...process.env }

function setRequiredWebEnv() {
  process.env.ADMIN_GRAPHQL_URL = "http://localhost:3003/api/graphql"
  process.env.WEB_ADMIN_API_KEYS = "test-admin-bearer-key"
  process.env.REVALIDATION_SECRET = "test-revalidation-secret"
  process.env.NEXT_PUBLIC_CANONICAL_ORIGIN = "http://localhost:3000"
  delete process.env.LAUNCHDARKLY_SDK_KEY
  delete process.env.FORGE_WATCH_PLAYER_MIGRATION_DEFAULT
  delete process.env.FORGE_WATCH_HERO_MUX_VIDEO_DEFAULT
  delete process.env.NEXT_PUBLIC_FORGE_WATCH_PLAYER_MIGRATION
  delete process.env.NEXT_PUBLIC_FORGE_WATCH_HERO_MUX_VIDEO
}

describe("web feature flag helpers", () => {
  beforeEach(() => {
    vi.resetModules()
    process.env = { ...ORIGINAL_ENV }
    setRequiredWebEnv()
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
  })

  it("falls back to existing NEXT_PUBLIC watch defaults when LaunchDarkly is unconfigured", async () => {
    delete process.env.LAUNCHDARKLY_SDK_KEY
    process.env.NEXT_PUBLIC_FORGE_WATCH_PLAYER_MIGRATION = "true"
    process.env.NEXT_PUBLIC_FORGE_WATCH_HERO_MUX_VIDEO = "false"

    const { isWatchPlayerMigrationEnabled, isWatchHeroMuxVideoEnabled } =
      await import("./feature-flags")

    await expect(isWatchPlayerMigrationEnabled()).resolves.toBe(true)
    await expect(isWatchHeroMuxVideoEnabled()).resolves.toBe(false)
  })

  it("treats empty public watch flag env vars as false defaults", async () => {
    delete process.env.LAUNCHDARKLY_SDK_KEY
    process.env.NEXT_PUBLIC_FORGE_WATCH_PLAYER_MIGRATION = ""
    process.env.NEXT_PUBLIC_FORGE_WATCH_HERO_MUX_VIDEO = ""

    const { isWatchPlayerMigrationEnabled, isWatchHeroMuxVideoEnabled } =
      await import("./feature-flags")

    await expect(isWatchPlayerMigrationEnabled()).resolves.toBe(false)
    await expect(isWatchHeroMuxVideoEnabled()).resolves.toBe(false)
  })

  it("lets server-side local defaults override public build defaults", async () => {
    delete process.env.LAUNCHDARKLY_SDK_KEY
    process.env.NEXT_PUBLIC_FORGE_WATCH_HERO_MUX_VIDEO = "false"
    process.env.FORGE_WATCH_HERO_MUX_VIDEO_DEFAULT = "true"

    const { isWatchHeroMuxVideoEnabled } = await import("./feature-flags")

    await expect(isWatchHeroMuxVideoEnabled()).resolves.toBe(true)
  })

  it("creates a stable service context with caller custom attributes", async () => {
    const { createWebFeatureFlagContext } = await import("./feature-flags")

    expect(
      createWebFeatureFlagContext({
        key: "preview-request",
        custom: { route: "/watch/the-covenant/english" },
      }),
    ).toEqual({
      kind: "service",
      key: "preview-request",
      name: "Forge Web",
      email: undefined,
      anonymous: undefined,
      custom: {
        app: "web",
        canonicalOrigin: "http://localhost:3000",
        route: "/watch/the-covenant/english",
      },
    })
  })
})
