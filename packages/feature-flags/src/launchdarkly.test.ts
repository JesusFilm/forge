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
      boolVariationDetail: vi.fn(async () => ({
        value: true,
        reason: { kind: "FALLTHROUGH" },
      })),
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
    expect(ldClient.boolVariationDetail).toHaveBeenCalledWith(
      "forge.watch.playerMigration",
      expect.objectContaining({
        kind: "user",
        key: "test-user",
        name: "Test User",
      }),
      false,
    )
    expect(ldClient.variation).not.toHaveBeenCalled()
  })

  it("does not let custom attributes override LaunchDarkly context identity", async () => {
    const ldClient: LaunchDarklyClientLike = {
      waitForInitialization: vi.fn(async () => undefined),
      variation: vi.fn(async () => true),
      boolVariationDetail: vi.fn(async () => ({
        value: true,
        reason: { kind: "FALLTHROUGH" },
      })),
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

    expect(ldClient.boolVariationDetail).toHaveBeenCalledWith(
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
      boolVariationDetail: vi.fn(async () => ({
        value: true,
        reason: { kind: "FALLTHROUGH" },
      })),
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
    expect(ldClient.boolVariationDetail).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledOnce()
  })

  it("uses an initialization failure cooldown before retrying LaunchDarkly", async () => {
    const warn = vi.fn()
    const ldClient: LaunchDarklyClientLike = {
      waitForInitialization: vi.fn(async () => {
        throw new Error("timeout")
      }),
      variation: vi.fn(async () => true),
      boolVariationDetail: vi.fn(async () => ({
        value: true,
        reason: { kind: "FALLTHROUGH" },
      })),
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
      variation: vi.fn(async () => true),
      boolVariationDetail: vi.fn(async () => {
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
      boolVariationDetail: vi.fn(async () => ({
        value: "not-a-boolean",
        reason: { kind: "FALLTHROUGH" },
      })),
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

  describe("booleanVariationDetail", () => {
    it("returns source launchdarkly when LaunchDarkly evaluates true", async () => {
      const ldClient: LaunchDarklyClientLike = {
        waitForInitialization: vi.fn(async () => undefined),
        variation: vi.fn(async () => true),
        boolVariationDetail: vi.fn(async () => ({
          value: true,
          reason: { kind: "TARGET_MATCH" },
        })),
      }

      const client = createFeatureFlagClient({
        sdkKey: "sdk-test",
        initClient: () => ldClient,
      })

      await expect(
        client.booleanVariationDetail(
          featureFlags.watchPlayerMigration,
          context,
        ),
      ).resolves.toEqual({ value: true, source: "launchdarkly" })
      expect(ldClient.boolVariationDetail).toHaveBeenCalledWith(
        "forge.watch.playerMigration",
        expect.objectContaining({ kind: "user", key: "test-user" }),
        false,
      )
    })

    it("returns source launchdarkly when LaunchDarkly evaluates false despite a truthy override", async () => {
      const ldClient: LaunchDarklyClientLike = {
        waitForInitialization: vi.fn(async () => undefined),
        variation: vi.fn(async () => false),
        boolVariationDetail: vi.fn(async () => ({
          value: false,
          reason: { kind: "FALLTHROUGH" },
        })),
      }

      const client = createFeatureFlagClient({
        sdkKey: "sdk-test",
        initClient: () => ldClient,
        localEnv: {
          FORGE_WATCH_PLAYER_MIGRATION_DEFAULT: "true",
        },
      })

      await expect(
        client.booleanVariationDetail(
          featureFlags.watchPlayerMigration,
          context,
        ),
      ).resolves.toEqual({ value: false, source: "launchdarkly" })
    })

    it("returns source default without initializing LaunchDarkly when sdk key is absent", async () => {
      const initClient = vi.fn()
      const client = createFeatureFlagClient({ initClient })

      await expect(
        client.booleanVariationDetail(
          featureFlags.watchPlayerMigration,
          context,
        ),
      ).resolves.toEqual({ value: false, source: "default" })
      expect(initClient).not.toHaveBeenCalled()
    })

    it("returns source override when the local override env is set and sdk key is absent", async () => {
      const client = createFeatureFlagClient({
        localEnv: {
          FORGE_WATCH_PLAYER_MIGRATION_DEFAULT: "yes",
        },
      })

      await expect(
        client.booleanVariationDetail(
          featureFlags.watchPlayerMigration,
          context,
        ),
      ).resolves.toEqual({ value: true, source: "override" })
    })

    it("falls back with source override when LaunchDarkly initialization times out", async () => {
      const warn = vi.fn()
      const ldClient: LaunchDarklyClientLike = {
        waitForInitialization: vi.fn(async () => {
          throw new Error("timeout")
        }),
        variation: vi.fn(async () => false),
        boolVariationDetail: vi.fn(async () => ({
          value: false,
          reason: { kind: "FALLTHROUGH" },
        })),
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
        client.booleanVariationDetail(
          featureFlags.watchPlayerMigration,
          context,
        ),
      ).resolves.toEqual({ value: true, source: "override" })
      expect(ldClient.boolVariationDetail).not.toHaveBeenCalled()
      expect(warn).toHaveBeenCalledOnce()
    })

    it("falls back with source default when LaunchDarkly evaluation throws", async () => {
      const warn = vi.fn()
      const ldClient: LaunchDarklyClientLike = {
        waitForInitialization: vi.fn(async () => undefined),
        variation: vi.fn(async () => true),
        boolVariationDetail: vi.fn(async () => {
          throw new Error("network unavailable")
        }),
      }

      const client = createFeatureFlagClient({
        sdkKey: "sdk-test",
        initClient: () => ldClient,
        defaultValues: {
          "forge.watch.playerMigration": true,
        },
        logger: { warn },
      })

      await expect(
        client.booleanVariationDetail(
          featureFlags.watchPlayerMigration,
          context,
        ),
      ).resolves.toEqual({ value: true, source: "default" })
      expect(warn).toHaveBeenCalledOnce()
    })

    it("falls back with source override when LaunchDarkly returns a non-boolean value", async () => {
      const ldClient: LaunchDarklyClientLike = {
        waitForInitialization: vi.fn(async () => undefined),
        variation: vi.fn(async () => "not-a-boolean"),
        boolVariationDetail: vi.fn(async () => ({
          value: "not-a-boolean",
          reason: { kind: "FALLTHROUGH" },
        })),
      }

      const client = createFeatureFlagClient({
        sdkKey: "sdk-test",
        initClient: () => ldClient,
        localEnv: {
          FORGE_WATCH_PLAYER_MIGRATION_DEFAULT: "true",
        },
      })

      await expect(
        client.booleanVariationDetail(
          featureFlags.watchPlayerMigration,
          context,
        ),
      ).resolves.toEqual({ value: true, source: "override" })
    })

    it("routes an in-LD ERROR resolution to source default, never launchdarkly", async () => {
      const ldClient: LaunchDarklyClientLike = {
        waitForInitialization: vi.fn(async () => undefined),
        variation: vi.fn(async () => false),
        boolVariationDetail: vi.fn(async () => ({
          value: false,
          reason: { kind: "ERROR", errorKind: "FLAG_NOT_FOUND" },
        })),
      }

      const client = createFeatureFlagClient({
        sdkKey: "sdk-test",
        initClient: () => ldClient,
      })

      await expect(
        client.booleanVariationDetail(
          featureFlags.watchPlayerMigration,
          context,
        ),
      ).resolves.toEqual({ value: false, source: "default" })
    })

    it("routes an in-LD ERROR resolution to source override when the override env is set", async () => {
      const ldClient: LaunchDarklyClientLike = {
        waitForInitialization: vi.fn(async () => undefined),
        variation: vi.fn(async () => false),
        boolVariationDetail: vi.fn(async () => ({
          value: false,
          reason: { kind: "ERROR", errorKind: "CLIENT_NOT_READY" },
        })),
      }

      const client = createFeatureFlagClient({
        sdkKey: "sdk-test",
        initClient: () => ldClient,
        localEnv: {
          FORGE_WATCH_PLAYER_MIGRATION_DEFAULT: "true",
        },
      })

      await expect(
        client.booleanVariationDetail(
          featureFlags.watchPlayerMigration,
          context,
        ),
      ).resolves.toEqual({ value: true, source: "override" })
    })

    it("keeps the fallback source without re-initializing during the failure cooldown", async () => {
      const warn = vi.fn()
      const ldClient: LaunchDarklyClientLike = {
        waitForInitialization: vi.fn(async () => {
          throw new Error("timeout")
        }),
        variation: vi.fn(async () => true),
        boolVariationDetail: vi.fn(async () => ({
          value: true,
          reason: { kind: "FALLTHROUGH" },
        })),
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
        client.booleanVariationDetail(
          featureFlags.watchPlayerMigration,
          context,
        ),
      ).resolves.toEqual({ value: true, source: "override" })
      await expect(
        client.booleanVariationDetail(
          featureFlags.watchPlayerMigration,
          context,
        ),
      ).resolves.toEqual({ value: true, source: "override" })
      expect(ldClient.waitForInitialization).toHaveBeenCalledOnce()
      expect(ldClient.boolVariationDetail).not.toHaveBeenCalled()
      expect(warn).toHaveBeenCalledOnce()
    })

    it("routes an in-LD ERROR resolution to fallback even when its value is true", async () => {
      // Fail-closed keystone: a true value carried on an ERROR reason must
      // resolve BEFORE the boolean-value check, so a missing/archived flag can
      // never read as a genuine LaunchDarkly grant.
      const ldClient: LaunchDarklyClientLike = {
        waitForInitialization: vi.fn(async () => undefined),
        variation: vi.fn(async () => true),
        boolVariationDetail: vi.fn(async () => ({
          value: true,
          reason: { kind: "ERROR", errorKind: "FLAG_NOT_FOUND" },
        })),
      }

      const client = createFeatureFlagClient({
        sdkKey: "sdk-test",
        initClient: () => ldClient,
      })

      await expect(
        client.booleanVariationDetail(
          featureFlags.watchPlayerMigration,
          context,
        ),
      ).resolves.toEqual({ value: false, source: "default" })
    })

    it("falls back and arms the cooldown when client construction throws", async () => {
      const warn = vi.fn()
      const initClient = vi.fn(() => {
        throw new Error("init exploded")
      })

      const client = createFeatureFlagClient({
        sdkKey: "sdk-test",
        initClient,
        localEnv: {
          FORGE_WATCH_PLAYER_MIGRATION_DEFAULT: "true",
        },
        logger: { warn },
      })

      // Must resolve, never throw: consumers await this without a catch of
      // their own, so a construction throw here would surface as a 500 / an
      // errored stream instead of failing closed.
      await expect(
        client.booleanVariationDetail(
          featureFlags.watchPlayerMigration,
          context,
        ),
      ).resolves.toEqual({ value: true, source: "override" })
      // Cooldown armed → a second call inside the window doesn't re-attempt init.
      await expect(
        client.booleanVariationDetail(
          featureFlags.watchPlayerMigration,
          context,
        ),
      ).resolves.toEqual({ value: true, source: "override" })
      expect(initClient).toHaveBeenCalledOnce()
      expect(warn).toHaveBeenCalledOnce()
    })
  })
})
