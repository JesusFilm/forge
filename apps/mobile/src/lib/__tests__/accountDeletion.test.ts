import {
  classifyDeleteFailure,
  decidePostReauth,
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

describe("decidePostReauth (KTD5)", () => {
  it("a cancelled sheet returns quietly to needsReauth", () => {
    // Same ids on purpose: success here would retry, so only the
    // cancelled branch can produce this result.
    expect(
      decidePostReauth({
        capturedUserId: "user-a",
        outcome: "cancelled",
        signedInUserId: "user-a",
      }),
    ).toBe("needs-reauth")
  })

  it("a retryable sign-in failure keeps needsReauth with the sign-in message", () => {
    expect(
      decidePostReauth({
        capturedUserId: "user-a",
        outcome: "error",
        signedInUserId: "user-a",
      }),
    ).toBe("needs-reauth-sign-in-failed")
  })

  it("the same subject signed in again — retry the deletion (AE4)", () => {
    expect(
      decidePostReauth({
        capturedUserId: "user-a",
        outcome: "success",
        signedInUserId: "user-a",
      }),
    ).toBe("retry-deletion")
  })

  it("a different subject signed in — non-destructive wrong-account (AE7)", () => {
    expect(
      decidePostReauth({
        capturedUserId: "user-a",
        outcome: "success",
        signedInUserId: "user-b",
      }),
    ).toBe("wrong-account")
  })

  it("success with no signed-in snapshot cannot verify identity — sign-in failed", () => {
    expect(
      decidePostReauth({
        capturedUserId: "user-a",
        outcome: "success",
        signedInUserId: null,
      }),
    ).toBe("needs-reauth-sign-in-failed")
  })

  it("an uncaptured subject never authorizes a retry", () => {
    expect(
      decidePostReauth({
        capturedUserId: null,
        outcome: "success",
        signedInUserId: "user-a",
      }),
    ).toBe("wrong-account")
  })
})
