import {
  EMAIL_FAILURE_MESSAGES,
  MIN_PASSWORD_LENGTH,
  canSubmitEmailForm,
  classifyEmailAuthFailure,
  classifyLoginMethod,
  isPlausibleEmail,
  normalizeEmail,
  providerLabel,
} from "../emailAuth"

describe("normalizeEmail", () => {
  it("trims and lowercases so the same address is one account", () => {
    expect(normalizeEmail("  Person@Example.COM ")).toBe("person@example.com")
  })
})

describe("isPlausibleEmail", () => {
  it("accepts ordinary addresses, including uppercase and padding", () => {
    expect(isPlausibleEmail("person@example.com")).toBe(true)
    expect(isPlausibleEmail("  Person@Example.com  ")).toBe(true)
    expect(isPlausibleEmail("a.b+tag@sub.example.co.nz")).toBe(true)
  })

  it("rejects input that cannot be an address", () => {
    expect(isPlausibleEmail("")).toBe(false)
    expect(isPlausibleEmail("person")).toBe(false)
    expect(isPlausibleEmail("person@example")).toBe(false)
    expect(isPlausibleEmail("person @example.com")).toBe(false)
  })
})

describe("classifyLoginMethod", () => {
  it("routes an email owned by a social account to that provider", () => {
    // The duplicate-account guard: without this the person creates a second
    // account against the address they already use with Google.
    expect(
      classifyLoginMethod({ method: "provider", provider: "google" }),
    ).toEqual({ kind: "provider", provider: "google" })
  })

  it("falls back to password for every unrecognised shape", () => {
    // Guessing "provider" from a malformed response would strand a real
    // password user with no way in; the server rejects a bad attempt anyway.
    expect(classifyLoginMethod({ method: "password" })).toEqual({
      kind: "password",
    })
    expect(classifyLoginMethod({ method: "provider" })).toEqual({
      kind: "password",
    })
    expect(classifyLoginMethod({ method: "provider", provider: "" })).toEqual({
      kind: "password",
    })
    expect(classifyLoginMethod({ method: "agent-handle" })).toEqual({
      kind: "password",
    })
    expect(classifyLoginMethod(null)).toEqual({ kind: "password" })
    expect(classifyLoginMethod("nonsense")).toEqual({ kind: "password" })
    expect(classifyLoginMethod(undefined)).toEqual({ kind: "password" })
  })
})

describe("providerLabel", () => {
  it("uses human names for the providers auth offers", () => {
    expect(providerLabel("google")).toBe("Google")
    expect(providerLabel("facebook")).toBe("Facebook")
  })

  it("falls back to the raw id rather than showing nothing", () => {
    expect(providerLabel("some-new-idp")).toBe("some-new-idp")
  })
})

describe("classifyEmailAuthFailure", () => {
  it("recognises a wrong password from the typed code", () => {
    expect(
      classifyEmailAuthFailure({ code: "INVALID_EMAIL_OR_PASSWORD" }),
    ).toBe("invalid-credentials")
    expect(classifyEmailAuthFailure({ code: "USER_NOT_FOUND" })).toBe(
      "invalid-credentials",
    )
  })

  it("recognises a taken email and a weak password", () => {
    expect(classifyEmailAuthFailure({ code: "USER_ALREADY_EXISTS" })).toBe(
      "email-taken",
    )
    expect(classifyEmailAuthFailure({ code: "PASSWORD_TOO_SHORT" })).toBe(
      "weak-password",
    )
  })

  it("reads the message when only text comes back", () => {
    expect(classifyEmailAuthFailure({ message: "User already exists" })).toBe(
      "email-taken",
    )
    expect(
      classifyEmailAuthFailure({ message: "Invalid email or password" }),
    ).toBe("invalid-credentials")
    expect(
      classifyEmailAuthFailure({
        message: "Password must be at least 8 characters",
      }),
    ).toBe("weak-password")
  })

  it("treats an unknown failure as retryable, not as a bad password", () => {
    // Telling someone their password is wrong when the server was merely
    // unreachable sends them to a password reset they do not need.
    expect(classifyEmailAuthFailure({})).toBe("retryable")
    expect(classifyEmailAuthFailure({ code: "INTERNAL_SERVER_ERROR" })).toBe(
      "retryable",
    )
    expect(
      classifyEmailAuthFailure({ message: "network request failed" }),
    ).toBe("retryable")
  })

  it("has a message for every failure kind", () => {
    for (const kind of [
      "invalid-credentials",
      "email-taken",
      "weak-password",
      "retryable",
    ] as const) {
      expect(EMAIL_FAILURE_MESSAGES[kind]).toBeTruthy()
    }
  })
})

describe("canSubmitEmailForm", () => {
  const base = {
    email: "person@example.com",
    password: "hunter2!!",
    busy: false,
  }

  it("enables submit once both fields are usable", () => {
    expect(canSubmitEmailForm({ ...base, mode: "sign-in" })).toBe(true)
    expect(canSubmitEmailForm({ ...base, mode: "sign-up" })).toBe(true)
  })

  it("stays disabled while a request is in flight", () => {
    // Otherwise a double tap creates two accounts.
    expect(canSubmitEmailForm({ ...base, mode: "sign-up", busy: true })).toBe(
      false,
    )
  })

  it("requires a plausible email in both modes", () => {
    expect(
      canSubmitEmailForm({ ...base, email: "person", mode: "sign-in" }),
    ).toBe(false)
    expect(canSubmitEmailForm({ ...base, email: "", mode: "sign-up" })).toBe(
      false,
    )
  })

  it("enforces the minimum length only when creating an account", () => {
    // An existing account may predate the current minimum, so sign-in must
    // not lock its owner out of their own password.
    const short = "a".repeat(MIN_PASSWORD_LENGTH - 1)
    expect(
      canSubmitEmailForm({ ...base, password: short, mode: "sign-up" }),
    ).toBe(false)
    expect(
      canSubmitEmailForm({ ...base, password: short, mode: "sign-in" }),
    ).toBe(true)
  })

  it("requires some password even when signing in", () => {
    expect(canSubmitEmailForm({ ...base, password: "", mode: "sign-in" })).toBe(
      false,
    )
  })
})
