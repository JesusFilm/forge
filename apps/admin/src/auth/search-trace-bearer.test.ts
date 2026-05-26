import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/config/env", () => ({
  env: {} as { SEARCH_TRACE_SAMPLING_API_KEYS?: string },
}))

const { env } = await import("@/config/env")
const { isValidSearchTraceSamplingBearer } =
  await import("@/auth/search-trace-bearer")

const envMutable = env as { SEARCH_TRACE_SAMPLING_API_KEYS?: string }

describe("search trace sampling bearer validation", () => {
  beforeEach(() => {
    envMutable.SEARCH_TRACE_SAMPLING_API_KEYS = "trace-a,trace-b"
  })

  afterEach(() => {
    envMutable.SEARCH_TRACE_SAMPLING_API_KEYS = undefined
  })

  it("accepts a matching dedicated sampling bearer", () => {
    expect(isValidSearchTraceSamplingBearer("Bearer trace-a")).toBe(true)
    expect(isValidSearchTraceSamplingBearer("bearer trace-b")).toBe(true)
  })

  it("rejects missing, malformed, unknown, and empty bearer values", () => {
    expect(isValidSearchTraceSamplingBearer(null)).toBe(false)
    expect(isValidSearchTraceSamplingBearer("Basic trace-a")).toBe(false)
    expect(isValidSearchTraceSamplingBearer("Bearer wrong")).toBe(false)
    expect(isValidSearchTraceSamplingBearer("Bearer    ")).toBe(false)
  })

  it("rejects when the allowlist is unset or empty", () => {
    envMutable.SEARCH_TRACE_SAMPLING_API_KEYS = undefined
    expect(isValidSearchTraceSamplingBearer("Bearer trace-a")).toBe(false)

    envMutable.SEARCH_TRACE_SAMPLING_API_KEYS = " , "
    expect(isValidSearchTraceSamplingBearer("Bearer trace-a")).toBe(false)
  })

  it("rejects jfp_search partner-token shaped values even when pasted into the sampling allowlist", () => {
    const partnerToken =
      "jfp_search_ABCDEFGHJKLM_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    envMutable.SEARCH_TRACE_SAMPLING_API_KEYS = partnerToken

    expect(isValidSearchTraceSamplingBearer(`Bearer ${partnerToken}`)).toBe(
      false,
    )
  })

  it("does not throw for length-mismatched unicode keys", () => {
    envMutable.SEARCH_TRACE_SAMPLING_API_KEYS = "tréce"
    expect(() => isValidSearchTraceSamplingBearer("Bearer trace")).not.toThrow()
    expect(isValidSearchTraceSamplingBearer("Bearer trace")).toBe(false)
  })
})
