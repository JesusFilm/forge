import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const ORIGINAL_ENV = { ...process.env }

function setRequiredWebEnv() {
  process.env.ADMIN_GRAPHQL_URL = "http://localhost:3003/api/graphql"
  process.env.WEB_ADMIN_API_KEYS = "test-admin-bearer-key"
  process.env.REVALIDATION_SECRET = "test-revalidation-secret"
  process.env.NEXT_PUBLIC_CANONICAL_ORIGIN = "http://localhost:3000"
  delete process.env.LAUNCHDARKLY_SDK_KEY
  delete process.env.FORGE_WATCH_PLAYER_MIGRATION_DEFAULT
  delete process.env.FORGE_WATCH_CTA_TEXT_COPY_DEFAULT
  delete process.env.FORGE_WATCH_DOWNLOAD_ACCOUNT_GATE_DEFAULT
  delete process.env.FORGE_WATCH_QUESTION_PANEL_DEFAULT
  delete process.env.FORGE_WATCH_HIDE_BIBLE_QUOTES_DEFAULT
  delete process.env.FORGE_WATCH_ALGOLIA_SEARCH_DEFAULT
  delete process.env.ALGOLIA_APP_ID
  delete process.env.ALGOLIA_SEARCH_API_KEY
  delete process.env.ALGOLIA_INDEX
  delete process.env.NEXT_PUBLIC_FORGE_WATCH_PLAYER_MIGRATION
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

    const { isWatchPlayerMigrationEnabled } = await import("./feature-flags")

    await expect(isWatchPlayerMigrationEnabled()).resolves.toBe(true)
  })

  it("treats empty public watch flag env vars as false defaults", async () => {
    delete process.env.LAUNCHDARKLY_SDK_KEY
    process.env.NEXT_PUBLIC_FORGE_WATCH_PLAYER_MIGRATION = ""

    const { isWatchPlayerMigrationEnabled } = await import("./feature-flags")

    await expect(isWatchPlayerMigrationEnabled()).resolves.toBe(false)
  })

  it("lets server-side local defaults override public build defaults", async () => {
    delete process.env.LAUNCHDARKLY_SDK_KEY
    process.env.NEXT_PUBLIC_FORGE_WATCH_PLAYER_MIGRATION = "false"
    process.env.FORGE_WATCH_PLAYER_MIGRATION_DEFAULT = "true"

    const { isWatchPlayerMigrationEnabled } = await import("./feature-flags")

    await expect(isWatchPlayerMigrationEnabled()).resolves.toBe(true)
  })

  it("evaluates the watch CTA text copy flag from the server-side fallback", async () => {
    delete process.env.LAUNCHDARKLY_SDK_KEY
    process.env.FORGE_WATCH_CTA_TEXT_COPY_DEFAULT = "true"

    const { isWatchCtaTextCopyEnabled } = await import("./feature-flags")

    await expect(isWatchCtaTextCopyEnabled()).resolves.toBe(true)
  })

  it("keeps the watch download account gate disabled by default", async () => {
    delete process.env.LAUNCHDARKLY_SDK_KEY

    const { isWatchDownloadAccountGateEnabled } =
      await import("./feature-flags")

    await expect(isWatchDownloadAccountGateEnabled()).resolves.toBe(false)
  })

  it("evaluates the watch download account gate from the server-side fallback", async () => {
    delete process.env.LAUNCHDARKLY_SDK_KEY
    process.env.FORGE_WATCH_DOWNLOAD_ACCOUNT_GATE_DEFAULT = "true"

    const { isWatchDownloadAccountGateEnabled } =
      await import("./feature-flags")

    await expect(isWatchDownloadAccountGateEnabled()).resolves.toBe(true)
  })

  it("evaluates the watch Bible Quotes visibility flag from the server-side fallback and defaults off", async () => {
    delete process.env.LAUNCHDARKLY_SDK_KEY

    const { isWatchHideBibleQuotesEnabled } = await import("./feature-flags")

    await expect(isWatchHideBibleQuotesEnabled()).resolves.toBe(false)

    vi.resetModules()
    process.env.FORGE_WATCH_HIDE_BIBLE_QUOTES_DEFAULT = "true"

    const { isWatchHideBibleQuotesEnabled: enabledWithFallback } =
      await import("./feature-flags")

    await expect(enabledWithFallback()).resolves.toBe(true)
  })

  it("keeps the watch question panel disabled by default", async () => {
    delete process.env.LAUNCHDARKLY_SDK_KEY

    const { isWatchQuestionPanelEnabled } = await import("./feature-flags")

    await expect(isWatchQuestionPanelEnabled()).resolves.toBe(false)
  })

  it("evaluates the watch question panel flag from the server-side fallback", async () => {
    delete process.env.LAUNCHDARKLY_SDK_KEY
    process.env.FORGE_WATCH_QUESTION_PANEL_DEFAULT = "true"

    const { isWatchQuestionPanelEnabled } = await import("./feature-flags")

    await expect(isWatchQuestionPanelEnabled()).resolves.toBe(true)
  })

  it("keeps the watch Algolia search flag disabled by default", async () => {
    delete process.env.LAUNCHDARKLY_SDK_KEY

    const { isWatchAlgoliaSearchEnabled } = await import("./feature-flags")

    await expect(isWatchAlgoliaSearchEnabled()).resolves.toBe(false)
  })

  it("evaluates the watch Algolia search flag from the server-side fallback", async () => {
    delete process.env.LAUNCHDARKLY_SDK_KEY
    process.env.FORGE_WATCH_ALGOLIA_SEARCH_DEFAULT = "true"

    const { isWatchAlgoliaSearchEnabled } = await import("./feature-flags")

    await expect(isWatchAlgoliaSearchEnabled()).resolves.toBe(true)
  })

  it("passes the LaunchDarkly SDK key and local fallbacks into the shared client", async () => {
    process.env.LAUNCHDARKLY_SDK_KEY = "sdk-test"
    process.env.NEXT_PUBLIC_FORGE_WATCH_PLAYER_MIGRATION = "false"
    process.env.FORGE_WATCH_PLAYER_MIGRATION_DEFAULT = "true"
    process.env.FORGE_WATCH_CTA_TEXT_COPY_DEFAULT = "false"
    process.env.FORGE_WATCH_DOWNLOAD_ACCOUNT_GATE_DEFAULT = "true"
    process.env.FORGE_WATCH_QUESTION_PANEL_DEFAULT = "true"
    process.env.FORGE_WATCH_HIDE_BIBLE_QUOTES_DEFAULT = "false"
    process.env.FORGE_WATCH_ALGOLIA_SEARCH_DEFAULT = "false"
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
          FORGE_WATCH_CTA_TEXT_COPY_DEFAULT: "false",
          FORGE_WATCH_DOWNLOAD_ACCOUNT_GATE_DEFAULT: "true",
          FORGE_WATCH_QUESTION_PANEL_DEFAULT: "true",
          FORGE_WATCH_HIDE_BIBLE_QUOTES_DEFAULT: "false",
          FORGE_WATCH_ALGOLIA_SEARCH_DEFAULT: "false",
        },
        defaultValues: {
          "forge.watch.playerMigration": false,
          "forge.watch.ctaTextCopy": false,
          "forge.watch.downloadAccountGate": false,
          "forge.watch.questionPanel": false,
          "forge.watch.hideBibleQuotes": false,
          "forge.watch.algoliaSearch": false,
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
