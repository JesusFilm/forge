// @vitest-environment node
// The LD node SDK (transitively imported via @forge/feature-flags) targets the
// node runtime, and the module under test is server-only — no DOM needed.
import {
  featureFlags,
  resetFeatureFlagClientCacheForTests,
  type FeatureFlagContext,
  type LaunchDarklyClientLike,
} from "@forge/feature-flags"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { createChatFeatureFlagClient } from "./feature-flags"

const context: FeatureFlagContext = {
  kind: "user",
  key: "dogfooder@example.com",
}

// The package caches LD clients by sdkKey in module state; isolate each case.
beforeEach(resetFeatureFlagClientCacheForTests)
afterEach(resetFeatureFlagClientCacheForTests)

describe("createChatFeatureFlagClient", () => {
  it("AE9: deployed mode ignores a granting override without an SDK key (resolves default false)", async () => {
    const client = createChatFeatureFlagClient({
      sdkKey: undefined,
      nodeEnv: "production",
      overrideEnvValue: "true",
    })

    await expect(
      client.booleanVariationDetail(featureFlags.chatSeekerDogfood, context),
    ).resolves.toEqual({ value: false, source: "default" })
  })

  it("development mode honors the granting override env (R12 local path)", async () => {
    const client = createChatFeatureFlagClient({
      sdkKey: undefined,
      nodeEnv: "development",
      overrideEnvValue: "true",
    })

    await expect(
      client.booleanVariationDetail(featureFlags.chatSeekerDogfood, context),
    ).resolves.toEqual({ value: true, source: "override" })
  })

  it("development mode without the override still resolves the default", async () => {
    const client = createChatFeatureFlagClient({
      sdkKey: undefined,
      nodeEnv: "development",
      overrideEnvValue: undefined,
    })

    await expect(
      client.booleanVariationDetail(featureFlags.chatSeekerDogfood, context),
    ).resolves.toEqual({ value: false, source: "default" })
  })

  it("constructs the LD client with analytics events and diagnostics OFF (KTD3)", async () => {
    let capturedOptions: unknown
    const fakeClient: LaunchDarklyClientLike = {
      async waitForInitialization() {
        return undefined
      },
      async variation() {
        return true
      },
      async boolVariationDetail() {
        return { value: true, reason: { kind: "FALLTHROUGH" } }
      },
    }

    const client = createChatFeatureFlagClient({
      sdkKey: "fake-sdk-key",
      nodeEnv: "production",
      initClient: (_sdkKey, options) => {
        capturedOptions = options
        return fakeClient
      },
    })

    await expect(
      client.booleanVariationDetail(featureFlags.chatSeekerDogfood, context),
    ).resolves.toEqual({ value: true, source: "launchdarkly" })
    expect(capturedOptions).toEqual({
      sendEvents: false,
      diagnosticOptOut: true,
    })
  })

  it("exposes the module-level singleton the app evaluates through", async () => {
    const { chatFeatureFlagClient } = await import("./feature-flags")
    expect(typeof chatFeatureFlagClient.booleanVariation).toBe("function")
    expect(typeof chatFeatureFlagClient.booleanVariationDetail).toBe("function")
  })
})
