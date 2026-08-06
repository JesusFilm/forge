import {
  classifySignInFailure,
  appleNameForIdToken,
  isProviderCancel,
} from "../authFlows"

describe("classifySignInFailure", () => {
  it("treats a provider-sheet cancel as cancelled — no error UI", () => {
    for (const code of ["ERR_REQUEST_CANCELED", "SIGN_IN_CANCELLED", "12501"]) {
      expect(classifySignInFailure("provider-sheet", { code })).toBe(
        "cancelled",
      )
    }
  })

  it("classifies a post-provider-success exchange failure as retryable, not cancel — the discriminating case", () => {
    // Even a cancel-shaped code after the sheet succeeded is retryable: the
    // user completed Face ID / the account picker and must see the outcome.
    expect(
      classifySignInFailure("exchange", { code: "ERR_REQUEST_CANCELED" }),
    ).toBe("retryable")
    expect(
      classifySignInFailure("exchange", new Error("network request failed")),
    ).toBe("retryable")
  })

  it("treats unknown provider-sheet failures as retryable", () => {
    expect(
      classifySignInFailure("provider-sheet", new Error("sheet exploded")),
    ).toBe("retryable")
    expect(classifySignInFailure("provider-sheet", undefined)).toBe("retryable")
  })
})

describe("isProviderCancel", () => {
  it("recognizes only typed cancel codes, never message text", () => {
    expect(isProviderCancel({ code: "ERR_REQUEST_CANCELED" })).toBe(true)
    expect(isProviderCancel(new Error("The user canceled the sign-in"))).toBe(
      false,
    )
    expect(isProviderCancel(null)).toBe(false)
  })
})

describe("appleNameForIdToken", () => {
  it("maps the sheet's parts to Better Auth's idToken.user.name shape", () => {
    expect(
      appleNameForIdToken({ givenName: "Urim", familyName: "Chae" }),
    ).toEqual({ firstName: "Urim", lastName: "Chae" })
  })

  it("tolerates a partial name", () => {
    expect(
      appleNameForIdToken({ givenName: "Urim", familyName: null }),
    ).toEqual({ firstName: "Urim", lastName: undefined })
    expect(
      appleNameForIdToken({ givenName: null, familyName: "Chae" }),
    ).toEqual({ firstName: undefined, lastName: "Chae" })
  })

  it("returns undefined when Apple sends no name — the repeat-sign-in case", () => {
    // Apple omits fullName on every authorization after the first, so this
    // is the common path. It must be undefined rather than an empty object:
    // Better Auth branches on `token.user?.name` being present at all, so
    // `{}` would overwrite the stored name with "".
    expect(appleNameForIdToken(null)).toBeUndefined()
    expect(appleNameForIdToken(undefined)).toBeUndefined()
    expect(appleNameForIdToken({})).toBeUndefined()
    expect(
      appleNameForIdToken({ givenName: "  ", familyName: "  " }),
    ).toBeUndefined()
  })
})
