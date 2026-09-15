import { afterEach, describe, expect, it, vi } from "vitest"

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})
describe("Studio release configuration", () => {
  it("defaults both new-work controls off and enables them independently", async () => {
    // Exercise real validation without relying on developer or CI auth settings.
    vi.stubEnv("DATABASE_URL", "postgresql://fixture@127.0.0.1:55463/fixture")
    vi.stubEnv(
      "ADMIN_SESSION_SECRET",
      "studio-controls-fixture-at-least-32-characters",
    )
    vi.stubEnv("AUTH_ISSUER_URL", "http://127.0.0.1:55469")
    vi.stubEnv("AUTH_ADMIN_CLIENT_ID", "studio-controls-fixture")
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
