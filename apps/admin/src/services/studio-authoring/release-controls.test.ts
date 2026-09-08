import { afterEach, describe, expect, it, vi } from "vitest"

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})
describe("Studio release configuration", () => {
  it("defaults both new-work controls off and enables them independently", async () => {
    vi.stubEnv("CI", undefined)
    vi.stubEnv("STUDIO_PRODUCTION_ENABLED", undefined)
    vi.stubEnv("STUDIO_PUBLICATION_ENABLED", undefined)
    vi.resetModules()
    expect((await import("@/config/env")).env).toMatchObject({
      STUDIO_PRODUCTION_ENABLED: "false",
      STUDIO_PUBLICATION_ENABLED: "false",
    })
    vi.stubEnv("STUDIO_PRODUCTION_ENABLED", "true")
    vi.resetModules()
    expect((await import("@/config/env")).env).toMatchObject({
      STUDIO_PRODUCTION_ENABLED: "true",
      STUDIO_PUBLICATION_ENABLED: "false",
    })
    vi.stubEnv("STUDIO_PRODUCTION_ENABLED", "false")
    vi.stubEnv("STUDIO_PUBLICATION_ENABLED", "true")
    vi.resetModules()
    expect((await import("@/config/env")).env).toMatchObject({
      STUDIO_PRODUCTION_ENABLED: "false",
      STUDIO_PUBLICATION_ENABLED: "true",
    })
  })
})
