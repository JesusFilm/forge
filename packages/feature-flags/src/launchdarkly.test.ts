import { afterEach, describe, expect, it, vi } from "vitest"

import {
  createFeatureFlagClient,
  resetFeatureFlagClientCacheForTests,
  type LaunchDarklyClientLike,
} from "./launchdarkly"
import { featureFlags } from "./registry"

const context = {
  kind: "user",
  key: "test-user",
  name: "Test User",
}

describe("createFeatureFlagClient", () => {
  afterEach(() => {
    resetFeatureFlagClientCacheForTests()
  })

  it("returns the registry fallback without initializing LaunchDarkly when sdk key is absent", async () => {
    const initClient = vi.fn()
    const client = createFeatureFlagClient({ initClient })

    await expect(
      client.booleanVariation(featureFlags.watchPlayerMigration, context),
    ).resolves.toBe(false)
    expect(initClient).not.toHaveBeenCalled()
  })

  it("uses local boolean overrides when LaunchDarkly is not configured", async () => {
    const client = createFeatureFlagClient({
      localEnv: {
        FORGE_WATCH_PLAYER_MIGRATION_DEFAULT: "yes",
        FORGE_WATCH_ALGOLIA_SEARCH_DEFAULT: "on",
      },
    })

    await expect(
      client.booleanVariation(featureFlags.watchPlayerMigration, context),
    ).resolves.toBe(true)
    await expect(
      client.booleanVariation(featureFlags.watchAlgoliaSearch, context),
    ).resolves.toBe(true)
  })

  it("uses caller-provided defaults when no local override is present", async () => {
    const client = createFeatureFlagClient({
      defaultValues: {
        "forge.watch.playerMigration": true,
      },
    })

    await expect(
      client.booleanVariation(featureFlags.watchPlayerMigration, context),
    ).resolves.toBe(true)
  })

  it("ignores invalid local boolean overrides and uses caller-provided defaults", async () => {
    const client = createFeatureFlagClient({
      localEnv: {
        FORGE_WATCH_PLAYER_MIGRATION_DEFAULT: "maybe",
      },
      defaultValues: {
        "forge.watch.playerMigration": true,
      },
    })

    await expect(
      client.booleanVariation(featureFlags.watchPlayerMigration, context),
    ).resolves.toBe(true)
  })

  it("returns the LaunchDarkly variation when the SDK is configured and ready", async () => {
    const ldClient: LaunchDarklyClientLike = {
      waitForInitialization: vi.fn(async () => undefined),
      variation: vi.fn(async () => true),
    }
    const initClient = vi.fn(() => ldClient)

    const client = createFeatureFlagClient({
      sdkKey: "sdk-test",
      initClient,
    })

    await expect(
      client.booleanVariation(featureFlags.watchPlayerMigration, context),
    ).resolves.toBe(true)
    expect(initClient).toHaveBeenCalledOnce()
    expect(ldClient.variation).toHaveBeenCalledWith(
      "forge.watch.playerMigration",
      expect.objectContaining({
        kind: "user",
        key: "test-user",
        name: "Test User",
      }),
      false,
    )
  })

  it("does not let custom attributes override LaunchDarkly context identity", async () => {
    const ldClient: LaunchDarklyClientLike = {
      waitForInitialization: vi.fn(async () => undefined),
      variation: vi.fn(async () => true),
    }

    const client = createFeatureFlagClient({
      sdkKey: "sdk-test",
      initClient: () => ldClient,
    })

    await client.booleanVariation(featureFlags.watchPlayerMigration, {
      kind: "user",
      key: "test-user",
      custom: {
        kind: "org",
        key: "custom-key",
        route: "/watch/the-covenant/english",
      },
    })

    expect(ldClient.variation).toHaveBeenCalledWith(
      "forge.watch.playerMigration",
      expect.objectContaining({
        kind: "user",
        key: "test-user",
        route: "/watch/the-covenant/english",
      }),
      false,
    )
  })

  it("falls back when LaunchDarkly initialization times out or fails", async () => {
    const warn = vi.fn()
    const ldClient: LaunchDarklyClientLike = {
      waitForInitialization: vi.fn(async () => {
        throw new Error("timeout")
      }),
      variation: vi.fn(async () => true),
    }

    const client = createFeatureFlagClient({
      sdkKey: "sdk-test",
      initClient: () => ldClient,
      localEnv: {
        FORGE_WATCH_PLAYER_MIGRATION_DEFAULT: "true",
      },
      logger: { warn },
    })

    await expect(
      client.booleanVariation(featureFlags.watchPlayerMigration, context),
    ).resolves.toBe(true)
    expect(ldClient.variation).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledOnce()
  })

  it("uses an initialization failure cooldown before retrying LaunchDarkly", async () => {
    const warn = vi.fn()
    const ldClient: LaunchDarklyClientLike = {
      waitForInitialization: vi.fn(async () => {
        throw new Error("timeout")
      }),
      variation: vi.fn(async () => true),
    }

    const client = createFeatureFlagClient({
      sdkKey: "sdk-test",
      initClient: () => ldClient,
      localEnv: {
        FORGE_WATCH_PLAYER_MIGRATION_DEFAULT: "true",
      },
      logger: { warn },
    })

    await expect(
      client.booleanVariation(featureFlags.watchPlayerMigration, context),
    ).resolves.toBe(true)
    await expect(
      client.booleanVariation(featureFlags.watchPlayerMigration, context),
    ).resolves.toBe(true)
    expect(ldClient.waitForInitialization).toHaveBeenCalledOnce()
    expect(warn).toHaveBeenCalledOnce()
  })

  it("falls back when LaunchDarkly variation evaluation fails", async () => {
    const warn = vi.fn()
    const ldClient: LaunchDarklyClientLike = {
      waitForInitialization: vi.fn(async () => undefined),
      variation: vi.fn(async () => {
        throw new Error("network unavailable")
      }),
    }

    const client = createFeatureFlagClient({
      sdkKey: "sdk-test",
      initClient: () => ldClient,
      localEnv: {
        FORGE_WATCH_PLAYER_MIGRATION_DEFAULT: "true",
      },
      logger: { warn },
    })

    await expect(
      client.booleanVariation(featureFlags.watchPlayerMigration, context),
    ).resolves.toBe(true)
    expect(warn).toHaveBeenCalledOnce()
  })

  it("falls back when LaunchDarkly returns a non-boolean variation", async () => {
    const ldClient: LaunchDarklyClientLike = {
      waitForInitialization: vi.fn(async () => undefined),
      variation: vi.fn(async () => "not-a-boolean"),
    }

    const client = createFeatureFlagClient({
      sdkKey: "sdk-test",
      initClient: () => ldClient,
      localEnv: {
        FORGE_WATCH_PLAYER_MIGRATION_DEFAULT: "false",
      },
    })

    await expect(
      client.booleanVariation(featureFlags.watchPlayerMigration, context),
    ).resolves.toBe(false)
  })
})
