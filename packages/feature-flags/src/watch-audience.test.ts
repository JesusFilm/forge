import { describe, expect, it } from "vitest"
import { featureFlags, resolveLocalBooleanFallback } from "./registry"

describe("Watch audience rollout", () => {
  it("stays off without an explicit rollout configuration", () => {
    expect(featureFlags.watchAudience.defaultValue).toBe(false)
    expect(resolveLocalBooleanFallback(featureFlags.watchAudience, {})).toBe(
      false,
    )
    expect(
      resolveLocalBooleanFallback(featureFlags.watchAudience, {
        FORGE_WATCH_AUDIENCE_DEFAULT: "true",
      }),
    ).toBe(true)
  })
})
