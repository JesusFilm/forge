import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const isValidSearchTraceSamplingBearer = vi.fn(() => false)

vi.mock("@/auth/search-trace-bearer", () => ({
  isValidSearchTraceSamplingBearer,
}))

const { isValidCandidateSearchEvalBearer } =
  await import("@/auth/candidate-search-eval-bearer")

describe("candidate search evaluation bearer validation", () => {
  beforeEach(() => {
    process.env.CANDIDATE_SEARCH_EVAL_API_KEYS = "candidate-a,candidate-b"
    isValidSearchTraceSamplingBearer.mockReturnValue(false)
  })

  afterEach(() => {
    delete process.env.CANDIDATE_SEARCH_EVAL_API_KEYS
    vi.clearAllMocks()
  })

  it("accepts only a dedicated candidate evaluation bearer", () => {
    expect(isValidCandidateSearchEvalBearer("Bearer candidate-a")).toBe(true)
    expect(isValidCandidateSearchEvalBearer("bearer candidate-b")).toBe(true)
    expect(isValidCandidateSearchEvalBearer("Bearer unknown")).toBe(false)
  })

  it("rejects missing, malformed, and unconfigured credentials", () => {
    expect(isValidCandidateSearchEvalBearer(null)).toBe(false)
    expect(isValidCandidateSearchEvalBearer("Basic candidate-a")).toBe(false)
    expect(isValidCandidateSearchEvalBearer("Bearer   ")).toBe(false)

    delete process.env.CANDIDATE_SEARCH_EVAL_API_KEYS
    expect(isValidCandidateSearchEvalBearer("Bearer candidate-a")).toBe(false)
  })

  it("rejects any bearer already authorized for trace sampling", () => {
    isValidSearchTraceSamplingBearer.mockReturnValue(true)
    expect(isValidCandidateSearchEvalBearer("Bearer candidate-a")).toBe(false)
  })

  it("rejects public partner-token shaped credentials", () => {
    const partnerToken =
      "jfp_search_ABCDEFGHJKLM_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    process.env.CANDIDATE_SEARCH_EVAL_API_KEYS = partnerToken
    expect(isValidCandidateSearchEvalBearer(`Bearer ${partnerToken}`)).toBe(
      false,
    )
  })

  it("does not throw for length-mismatched unicode credentials", () => {
    process.env.CANDIDATE_SEARCH_EVAL_API_KEYS = "candidaté"
    expect(() =>
      isValidCandidateSearchEvalBearer("Bearer candidate"),
    ).not.toThrow()
  })
})
