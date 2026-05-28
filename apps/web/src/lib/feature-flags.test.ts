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
  delete process.env.FORGE_WATCH_CTA_TEXT_COPY_DEFAULT
  delete process.env.FORGE_WATCH_YOUVERSION_BIBLE_QUOTES_DEFAULT
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

  it("evaluates the watch CTA text copy flag from the server-side fallback", async () => {
    delete process.env.LAUNCHDARKLY_SDK_KEY
    process.env.FORGE_WATCH_CTA_TEXT_COPY_DEFAULT = "true"

    const { isWatchCtaTextCopyEnabled } = await import("./feature-flags")

    await expect(isWatchCtaTextCopyEnabled()).resolves.toBe(true)
  })

  it("evaluates the YouVersion Bible Quotes flag from the server-side fallback and defaults off", async () => {
    delete process.env.LAUNCHDARKLY_SDK_KEY

    const { isWatchYouVersionBibleQuotesEnabled } =
      await import("./feature-flags")

    await expect(isWatchYouVersionBibleQuotesEnabled()).resolves.toBe(false)

    vi.resetModules()
    process.env.FORGE_WATCH_YOUVERSION_BIBLE_QUOTES_DEFAULT = "true"

    const { isWatchYouVersionBibleQuotesEnabled: enabledWithFallback } =
      await import("./feature-flags")

    await expect(enabledWithFallback()).resolves.toBe(true)
  })

  it("passes the LaunchDarkly SDK key and local fallbacks into the shared client", async () => {
    process.env.LAUNCHDARKLY_SDK_KEY = "sdk-test"
    process.env.NEXT_PUBLIC_FORGE_WATCH_PLAYER_MIGRATION = "false"
    process.env.NEXT_PUBLIC_FORGE_WATCH_HERO_MUX_VIDEO = "true"
    process.env.FORGE_WATCH_PLAYER_MIGRATION_DEFAULT = "true"
    process.env.FORGE_WATCH_CTA_TEXT_COPY_DEFAULT = "false"
    process.env.FORGE_WATCH_YOUVERSION_BIBLE_QUOTES_DEFAULT = "true"
    const booleanVariation = vi.fn(async () => false)
    const createFeatureFlagClient = vi.fn(() => ({ booleanVariation }))

    vi.doMock("@forge/feature-flags", async () => {
      const actual = await vi.importActual<
        typeof import("@forge/feature-flags")
      >("@forge/feature-flags")
      return {
        ...actual,
        createFeatureFlagClient,
      }
    })

    const { isWatchPlayerMigrationEnabled } = await import("./feature-flags")

    await expect(isWatchPlayerMigrationEnabled()).resolves.toBe(false)
    expect(createFeatureFlagClient).toHaveBeenCalledWith(
      expect.objectContaining({
        sdkKey: "sdk-test",
        localEnv: {
          FORGE_WATCH_PLAYER_MIGRATION_DEFAULT: "true",
          FORGE_WATCH_HERO_MUX_VIDEO_DEFAULT: "true",
          FORGE_WATCH_CTA_TEXT_COPY_DEFAULT: "false",
          FORGE_WATCH_YOUVERSION_BIBLE_QUOTES_DEFAULT: "true",
        },
        defaultValues: {
          "forge.watch.playerMigration": false,
          "forge.watch.heroMuxVideo": true,
          "forge.watch.ctaTextCopy": false,
          "forge.watch.youVersionBibleQuotes": false,
        },
      }),
    )
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
