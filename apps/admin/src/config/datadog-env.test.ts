import { describe, expect, it } from "vitest"

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
