import "server-only"

import {
  createFeatureFlagClient,
  type FeatureFlagClient,
  type FeatureFlagClientOptions,
} from "@forge/feature-flags"

import { env } from "@/config/env"

/**
 * Injectable inputs for the chat feature-flag client factory. Every field
 * defaults to the app's real wiring (validated env + the LD SDK's own init)
 * so tests can pin sdkKey/nodeEnv/override without touching process.env or
 * module state. The env-derived fields are presence-checked (not `??`):
 * passing an explicit `undefined` simulates an unset var regardless of the
 * ambient environment.
 */
export type ChatFeatureFlagClientInput = {
  sdkKey?: string
  nodeEnv?: string
  overrideEnvValue?: string
  initClient?: FeatureFlagClientOptions["initClient"]
  logger?: FeatureFlagClientOptions["logger"]
}

/**
 * Builds chat's LaunchDarkly client with the deployed configuration locked
 * in: analytics events + diagnostics are OFF (KTD3 — evaluation contexts
 * carry emails; chat must never ship them to LD analytics), and the seeker
 * override env reaches the fallback chain ONLY when NODE_ENV is
 * "development" (KTD5 — a deliberate divergence from apps/web's
 * feature-flags module, which passes overrides unconditionally). This is the
 * factory seam for tests; the app uses the singleton below.
 */
export function createChatFeatureFlagClient(
  input: ChatFeatureFlagClientInput = {},
): FeatureFlagClient {
  const sdkKey = "sdkKey" in input ? input.sdkKey : env.LAUNCHDARKLY_SDK_KEY
  const nodeEnv = "nodeEnv" in input ? input.nodeEnv : env.NODE_ENV
  const overrideEnvValue =
    "overrideEnvValue" in input
      ? input.overrideEnvValue
      : env.FORGE_CHAT_SEEKER_DOGFOOD_DEFAULT

  return createFeatureFlagClient({
    sdkKey,
    // KTD3: the SDK defaults events ON; both opt-outs are non-negotiable.
    options: { sendEvents: false, diagnosticOptOut: true },
    timeoutSeconds: 0.25,
    // KTD5: deployed builds never expose the override to the fallback chain.
    localEnv:
      nodeEnv === "development"
        ? { FORGE_CHAT_SEEKER_DOGFOOD_DEFAULT: overrideEnvValue }
        : {},
    logger: input.logger ?? console,
    initClient: input.initClient,
  })
}

/**
 * The app's shared feature-flag client (module-level singleton). Downstream
 * gates evaluate flags through this with a caller-supplied context, e.g.
 * chatFeatureFlagClient.booleanVariationDetail(featureFlags.chatSeekerDogfood,
 * context).
 */
export const chatFeatureFlagClient: FeatureFlagClient =
  createChatFeatureFlagClient()
