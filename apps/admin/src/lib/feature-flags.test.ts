import { afterEach, describe, expect, it, vi } from "vitest"

const env = vi.hoisted(() => ({
  LAUNCHDARKLY_SDK_KEY: undefined as string | undefined,
  FORGE_WATCH_AUDIENCE_DEFAULT: undefined as string | undefined,
}))
vi.mock("@/config/env", () => ({ env }))

async function loadGate() {
  vi.resetModules()
  return (await import("./feature-flags")).isWatchAudienceEnabled
}

afterEach(() => {
  env.LAUNCHDARKLY_SDK_KEY = undefined
  env.FORGE_WATCH_AUDIENCE_DEFAULT = undefined
})

describe("Admin forge.watch.audience gate", () => {
  it("is off by default with no LaunchDarkly key and no env fallback", async () => {
    expect(await (await loadGate())()).toBe(false)
  })

  it.each([
    ["true", true],
    ["false", false],
    ["not-a-boolean", false],
  ])(
    "uses FORGE_WATCH_AUDIENCE_DEFAULT=%s when LaunchDarkly is absent",
    async (value, expected) => {
      env.FORGE_WATCH_AUDIENCE_DEFAULT = value
      expect(await (await loadGate())()).toBe(expected)
    },
  )
})
