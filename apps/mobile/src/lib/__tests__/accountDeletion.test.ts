import {
  classifyDeleteFailure,
  outcomeFromDeleteResult,
} from "../accountDeletion"

describe("classifyDeleteFailure", () => {
  it("recognizes the typed stale-session code first", () => {
    expect(classifyDeleteFailure({ code: "SESSION_EXPIRED" })).toBe(
      "fresh-session-required",
    )
  })

  it("backstops on a narrow stale-session message shape", () => {
    expect(
      classifyDeleteFailure({ message: "Session expired. Re-authenticate." }),
    ).toBe("fresh-session-required")
    expect(classifyDeleteFailure({ message: "Session is not fresh" })).toBe(
      "fresh-session-required",
    )
  })

  it("classifies everything else as retryable — the account stays intact", () => {
    expect(classifyDeleteFailure({ message: "network request failed" })).toBe(
      "retryable",
    )
    expect(classifyDeleteFailure({})).toBe("retryable")
  })
})

describe("outcomeFromDeleteResult", () => {
  it("maps a clean result to deleted", () => {
    expect(outcomeFromDeleteResult({})).toEqual({ status: "deleted" })
    expect(outcomeFromDeleteResult({ error: null })).toEqual({
      status: "deleted",
    })
  })

  it("maps a stale session to the re-auth path and other errors to retryable", () => {
    expect(
      outcomeFromDeleteResult({ error: { code: "SESSION_EXPIRED" } }),
    ).toEqual({ status: "fresh-session-required" })
    expect(outcomeFromDeleteResult({ error: { message: "boom" } })).toEqual({
      status: "error",
    })
  })
})
