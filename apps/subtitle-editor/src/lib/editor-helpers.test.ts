import { describe, expect, it } from "vitest"
import {
  MIN_SUPPORTED_VIEWPORT_WIDTH,
  buildManagerJobUrl,
  decodeLaunchEnvelope,
  encodeLaunchEnvelope,
  isSupportedViewportWidth,
} from "@/lib/editor-helpers"

describe("launch envelope helpers", () => {
  it("round-trips a launch envelope through a URL-safe payload", () => {
    const value = encodeLaunchEnvelope({
      jobId: "job-123",
      launchCode: "launch-abc",
    })

    expect(decodeLaunchEnvelope(value)).toEqual({
      jobId: "job-123",
      launchCode: "launch-abc",
    })
  })

  it("still accepts the simple jobId::launchCode fallback format", () => {
    expect(decodeLaunchEnvelope("job-123::launch-abc")).toEqual({
      jobId: "job-123",
      launchCode: "launch-abc",
    })
  })

  it("returns null for malformed launch values", () => {
    expect(decodeLaunchEnvelope("")).toBeNull()
    expect(decodeLaunchEnvelope("not-a-launch")).toBeNull()
  })
})

describe("viewport helpers", () => {
  it("keeps the minimum viewport boundary explicit", () => {
    expect(MIN_SUPPORTED_VIEWPORT_WIDTH).toBe(1024)
    expect(isSupportedViewportWidth(1024)).toBe(true)
    expect(isSupportedViewportWidth(1023)).toBe(false)
  })
})

describe("manager return helpers", () => {
  it("builds a stable job detail URL", () => {
    expect(buildManagerJobUrl("http://localhost:3002", "job-123")).toBe(
      "http://localhost:3002/dashboard/jobs/job-123",
    )
  })
})
