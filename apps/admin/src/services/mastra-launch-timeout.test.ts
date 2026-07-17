import { describe, expect, it } from "vitest"

import { resolveMastraLaunchTimeoutMs } from "@/services/mastra-launch-timeout"

describe("resolveMastraLaunchTimeoutMs", () => {
  it("accepts positive integer numbers and numeric env strings", () => {
    expect(resolveMastraLaunchTimeoutMs(300_000)).toBe(300_000)
    expect(resolveMastraLaunchTimeoutMs("1200000")).toBe(1_200_000)
  })

  it("falls back for missing or invalid runtime values", () => {
    expect(resolveMastraLaunchTimeoutMs(undefined)).toBe(120_000)
    expect(resolveMastraLaunchTimeoutMs("")).toBe(120_000)
    expect(resolveMastraLaunchTimeoutMs("5m")).toBe(120_000)
    expect(resolveMastraLaunchTimeoutMs("1.5")).toBe(120_000)
    expect(resolveMastraLaunchTimeoutMs("-1")).toBe(120_000)
  })
})
