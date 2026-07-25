import { afterEach, describe, expect, it, vi } from "vitest"

import { normalizeDatadogEnv } from "./datadog-env"

describe("normalizeDatadogEnv", () => {
  it("normalizes common production aliases to the org's Datadog environment name", () => {
    expect(normalizeDatadogEnv("prod")).toBe("prod")
    expect(normalizeDatadogEnv("production")).toBe("prod")
    expect(normalizeDatadogEnv("PRODUCTION")).toBe("prod")
  })

  it("normalizes other common environment aliases", () => {
    expect(normalizeDatadogEnv("stage")).toBe("stage")
    expect(normalizeDatadogEnv("dev")).toBe("development")
    expect(normalizeDatadogEnv("test")).toBe("test")
    expect(normalizeDatadogEnv("preview")).toBe("preview")
  })

  it("preserves unknown lowercase environment names", () => {
    expect(normalizeDatadogEnv("Sandbox")).toBe("sandbox")
    expect(normalizeDatadogEnv("")).toBeUndefined()
    expect(normalizeDatadogEnv(undefined)).toBeUndefined()
  })
})

describe("datadogRumEnv", () => {
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_DATADOG_VERSION
    delete process.env.RAILWAY_GIT_COMMIT_SHA
    delete process.env.VERCEL_GIT_COMMIT_SHA
    delete process.env.GIT_COMMIT_SHA
    vi.resetModules()
  })

  it("uses the same Railway release fallback as the sourcemap upload script", async () => {
    process.env.RAILWAY_GIT_COMMIT_SHA = "railway-sha"

    const { datadogRumEnv } = await import("./datadog-rum-env")

    expect(datadogRumEnv.NEXT_PUBLIC_DATADOG_VERSION).toBe("railway-sha")
  })

  it("prefers the explicit public Datadog version over git fallbacks", async () => {
    process.env.NEXT_PUBLIC_DATADOG_VERSION = "release-1"
    process.env.RAILWAY_GIT_COMMIT_SHA = "railway-sha"

    const { datadogRumEnv } = await import("./datadog-rum-env")

    expect(datadogRumEnv.NEXT_PUBLIC_DATADOG_VERSION).toBe("release-1")
  })
})
