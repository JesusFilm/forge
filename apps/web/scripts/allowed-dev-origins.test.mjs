import { afterEach, describe, expect, it, vi } from "vitest"

async function loadAllowedDevOrigins(canonicalOrigin) {
  vi.stubEnv("NEXT_PUBLIC_CANONICAL_ORIGIN", canonicalOrigin)
  vi.resetModules()
  const { default: nextConfig } = await import("../next.config.mjs")
  return nextConfig.allowedDevOrigins
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe("allowed development origins", () => {
  it("adds the explicitly configured canonical hostname", async () => {
    await expect(
      loadAllowedDevOrigins("https://remote-qa.example.test/watch"),
    ).resolves.toEqual(["127.0.0.1", "remote-qa.example.test"])
  })

  it("keeps the loopback fallback when the canonical origin is absent", async () => {
    await expect(loadAllowedDevOrigins(undefined)).resolves.toEqual([
      "127.0.0.1",
    ])
  })

  it("keeps the loopback fallback when the canonical origin is malformed", async () => {
    await expect(loadAllowedDevOrigins("not a URL")).resolves.toEqual([
      "127.0.0.1",
    ])
  })

  it("does not duplicate the existing loopback hostname", async () => {
    await expect(
      loadAllowedDevOrigins("http://127.0.0.1:3000/watch"),
    ).resolves.toEqual(["127.0.0.1"])
  })
})
