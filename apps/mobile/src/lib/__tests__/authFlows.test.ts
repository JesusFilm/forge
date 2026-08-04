import {
  NEW_ACCOUNT_WINDOW_MS,
  classifySignInFailure,
  isNewlyCreatedAccount,
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

describe("isNewlyCreatedAccount (R15)", () => {
  const NOW = Date.parse("2026-08-04T00:01:00.000Z")

  it("detects an account created within the sign-in window", () => {
    expect(
      isNewlyCreatedAccount(
        { createdAt: new Date(NOW - 5_000).toISOString() },
        NOW,
      ),
    ).toBe(true)
  })

  it("does not flag an existing account", () => {
    expect(
      isNewlyCreatedAccount(
        { createdAt: new Date(NOW - NEW_ACCOUNT_WINDOW_MS - 1).toISOString() },
        NOW,
      ),
    ).toBe(false)
  })

  it("accepts Date instances and degrades malformed values to false", () => {
    expect(
      isNewlyCreatedAccount({ createdAt: new Date(NOW - 1_000) }, NOW),
    ).toBe(true)
    expect(isNewlyCreatedAccount({ createdAt: "not-a-date" }, NOW)).toBe(false)
    expect(isNewlyCreatedAccount({}, NOW)).toBe(false)
    expect(isNewlyCreatedAccount(null, NOW)).toBe(false)
  })
})
