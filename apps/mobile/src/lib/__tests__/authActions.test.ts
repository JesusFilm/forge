/**
 * The orchestrator behind every sign-in, sign-up, and deletion. Its pure
 * collaborators are each tested on their own; what is only testable here is
 * the COMPOSITION — that a failed exchange never applies a session, that a
 * success applies one and raises the R15 notice only for a fresh account,
 * and that deletion clears local state only when the account really went.
 *
 * The native sheets (`signInWithApple`/`signInWithGoogle`) require native
 * modules and stay out of scope; every other export is reachable by faking
 * the auth client.
 */

const mockAuthClient = {
  getSession: jest.fn(),
  signOut: jest.fn(async () => ({})),
  deleteUser: jest.fn(),
  signIn: { social: jest.fn(), email: jest.fn(), oauth2: jest.fn() },
  signUp: { email: jest.fn() },
  $fetch: jest.fn(),
}

const mockSessionStore = {
  applySignedIn: jest.fn(),
  signOut: jest.fn(async () => {}),
  refresh: jest.fn(async () => {}),
  getSnapshot: jest.fn(() => ({ status: "signedOut", user: null })),
}

jest.mock("../authSession", () => ({
  getAuthClient: () => mockAuthClient,
  getAuthSession: () => mockSessionStore,
}))

jest.mock("../datadog", () => ({ reportDatadogAction: jest.fn() }))

import { clearNewAccountNotice, getNewAccountNotice } from "../newAccountNotice"
import {
  deleteAccount,
  lookupLoginMethod,
  signInWithEmail,
  signOut,
  signUpWithEmail,
} from "../authActions"

const FRESH = new Date().toISOString()
const OLD = new Date(Date.now() - 400 * 24 * 3600 * 1000).toISOString()

beforeEach(() => {
  jest.clearAllMocks()
  clearNewAccountNotice()
  mockSessionStore.getSnapshot.mockReturnValue({
    status: "signedOut",
    user: null,
  })
})

describe("signInWithEmail", () => {
  it("applies the session and reports success", async () => {
    mockAuthClient.signIn.email.mockResolvedValue({
      data: { user: { id: "user-1", email: "p@example.com", createdAt: OLD } },
    })

    await expect(signInWithEmail("  P@Example.com ", "pw")).resolves.toEqual({
      status: "success",
    })

    // The address is normalized before it leaves the app, so one person
    // cannot end up with two accounts differing only by case.
    expect(mockAuthClient.signIn.email).toHaveBeenCalledWith({
      email: "p@example.com",
      password: "pw",
    })
    expect(mockSessionStore.applySignedIn).toHaveBeenCalledWith(
      expect.objectContaining({ id: "user-1" }),
    )
  })

  it("never applies a session when the server rejects the credentials", async () => {
    mockAuthClient.signIn.email.mockResolvedValue({
      data: null,
      error: { code: "INVALID_EMAIL_OR_PASSWORD" },
    })

    await expect(signInWithEmail("p@example.com", "wrong")).resolves.toEqual({
      status: "failed",
      reason: "invalid-credentials",
    })
    expect(mockSessionStore.applySignedIn).not.toHaveBeenCalled()
  })

  it("treats a thrown request as retryable, not as a bad password", async () => {
    mockAuthClient.signIn.email.mockRejectedValue(new TypeError("network"))

    await expect(signInWithEmail("p@example.com", "pw")).resolves.toEqual({
      status: "failed",
      reason: "retryable",
    })
    expect(mockSessionStore.applySignedIn).not.toHaveBeenCalled()
  })

  it("fails rather than signing in when the response carries no user", async () => {
    mockAuthClient.signIn.email.mockResolvedValue({ data: {} })

    await expect(signInWithEmail("p@example.com", "pw")).resolves.toEqual({
      status: "failed",
      reason: "retryable",
    })
    expect(mockSessionStore.applySignedIn).not.toHaveBeenCalled()
  })
})

describe("signUpWithEmail", () => {
  it("raises the R15 notice for an account it just created", async () => {
    mockAuthClient.signUp.email.mockResolvedValue({
      data: { user: { id: "user-new", createdAt: FRESH } },
    })

    await expect(signUpWithEmail("new@example.com", "pw")).resolves.toEqual({
      status: "success",
    })
    expect(getNewAccountNotice()).toBe("user-new")
  })

  it("does not raise the notice for a long-standing account", async () => {
    // The returning user signing in on a second device must never be told
    // their account is new.
    mockAuthClient.signUp.email.mockResolvedValue({
      data: { user: { id: "user-old", createdAt: OLD } },
    })

    await signUpWithEmail("old@example.com", "pw")

    expect(getNewAccountNotice()).toBeNull()
  })

  it("reports a taken email distinctly so the sheet can offer sign-in", async () => {
    mockAuthClient.signUp.email.mockResolvedValue({
      data: null,
      error: { code: "USER_ALREADY_EXISTS" },
    })

    await expect(signUpWithEmail("p@example.com", "pw")).resolves.toEqual({
      status: "failed",
      reason: "email-taken",
    })
  })
})

describe("lookupLoginMethod", () => {
  it("routes an email owned by a social account to that provider", async () => {
    mockAuthClient.$fetch.mockResolvedValue({
      data: { method: "provider", provider: "google" },
    })

    await expect(lookupLoginMethod("P@Example.com")).resolves.toEqual({
      kind: "provider",
      provider: "google",
    })
    expect(mockAuthClient.$fetch).toHaveBeenCalledWith(
      "/login-method",
      expect.objectContaining({ body: { email: "p@example.com" } }),
    )
  })

  it("falls through to the password form when the lookup fails", async () => {
    // Advisory UX only; the server still enforces. Blocking on a failed
    // lookup would strand a legitimate password user with no way in.
    mockAuthClient.$fetch.mockRejectedValue(new Error("offline"))

    await expect(lookupLoginMethod("p@example.com")).resolves.toEqual({
      kind: "password",
    })
  })
})

describe("deleteAccount", () => {
  it("clears local state once the account is gone", async () => {
    mockAuthClient.deleteUser.mockResolvedValue({})

    await expect(deleteAccount()).resolves.toEqual({ status: "deleted" })
    expect(mockSessionStore.signOut).toHaveBeenCalled()
  })

  it("keeps the user signed in when deletion needs a fresh session", async () => {
    mockAuthClient.deleteUser.mockResolvedValue({
      error: { code: "SESSION_EXPIRED" },
    })

    await expect(deleteAccount()).resolves.toEqual({
      status: "fresh-session-required",
    })
    expect(mockSessionStore.signOut).not.toHaveBeenCalled()
  })

  it("keeps the user signed in when deletion fails outright", async () => {
    // Strict deletion aborts with the account intact, so signing the user
    // out locally would contradict the state the server is actually in.
    mockAuthClient.deleteUser.mockResolvedValue({
      error: { code: "INTERNAL_SERVER_ERROR" },
    })

    await expect(deleteAccount()).resolves.toEqual({ status: "error" })
    expect(mockSessionStore.signOut).not.toHaveBeenCalled()
  })

  it("reports an error rather than throwing when the call rejects", async () => {
    mockAuthClient.deleteUser.mockRejectedValue(new Error("offline"))

    await expect(deleteAccount()).resolves.toEqual({ status: "error" })
    expect(mockSessionStore.signOut).not.toHaveBeenCalled()
  })
})

describe("signOut", () => {
  it("delegates to the session store, which owns the local clear", async () => {
    await signOut()
    expect(mockSessionStore.signOut).toHaveBeenCalledTimes(1)
  })
})
