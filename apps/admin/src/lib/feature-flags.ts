import {
  createFeatureFlagClient,
  featureFlags,
  type FeatureFlagContext,
} from "@forge/feature-flags"

import { env } from "@/config/env"

// Same precedence as apps/web/src/lib/feature-flags.ts: LaunchDarkly when the
// SDK key is set and initialised, else the FORGE_* env fallback, else false.
const adminFeatureFlagClient = createFeatureFlagClient({
  sdkKey: env.LAUNCHDARKLY_SDK_KEY,
  localEnv: {
    FORGE_WATCH_AUDIENCE_DEFAULT: env.FORGE_WATCH_AUDIENCE_DEFAULT,
  },
  defaultValues: {
    "forge.watch.audience": false,
  },
  timeoutSeconds: 0.25,
  logger: console,
})

const ADMIN_FEATURE_FLAG_CONTEXT = {
  kind: "service",
  key: "forge-admin",
  name: "Forge Admin",
  custom: { app: "admin" },
} satisfies FeatureFlagContext

/**
 * Release gate for Admin's Watch audience surfaces. Default-off and fail
 * closed: an unreadable flag is off. Never use it to gate erasure, reset, or
 * any other deletion of data a viewer already saved.
 */
export async function isWatchAudienceEnabled(): Promise<boolean> {
  try {
    return await adminFeatureFlagClient.booleanVariation(
      featureFlags.watchAudience,
      ADMIN_FEATURE_FLAG_CONTEXT,
    )
  } catch {
    return false
  }
}
