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
  readSession: jest.fn(async (): Promise<unknown> => null),
  getSnapshot: jest.fn(() => ({ status: "signedOut", user: null })),
}

jest.mock("../authSession", () => ({
  getAuthClient: () => mockAuthClient,
  getAuthSession: () => mockSessionStore,
}))

jest.mock("../datadog", () => ({ reportDatadogAction: jest.fn() }))

import { clearNewAccountNotice, getNewAccountNotice } from "../newAccountNotice"
import { reportDatadogAction } from "../datadog"
import {
  deleteAccount,
  lookupLoginMethod,
  signInWithEmail,
  signInWithHostedPage,
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

describe("signInWithHostedPage", () => {
  // A fixed SERVER clock, deliberately far from the device's Date.now():
  // an implementation that let the device clock into the new-account check
  // would fail the marked/unmarked cases below.
  const SERVER_NOW = 1_800_000_000_000
  const OAUTH_OK = {
    data: { url: "https://auth", redirect: true },
    error: null,
  }

  it("joins a concurrent second call — only one browser session opens (AE2)", async () => {
    let release: (value: typeof OAUTH_OK) => void = () => {}
    mockAuthClient.signIn.oauth2.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve
        }),
    )
    mockSessionStore.readSession.mockResolvedValue({ id: "user-1" })

    const first = signInWithHostedPage()
    const second = signInWithHostedPage()

    expect(mockAuthClient.signIn.oauth2).toHaveBeenCalledTimes(1)
    release(OAUTH_OK)
    await expect(first).resolves.toEqual({ status: "success" })
    await expect(second).resolves.toEqual({ status: "success" })
  })

  it("launches a fresh browser session once the previous attempt settled", async () => {
    mockAuthClient.signIn.oauth2.mockResolvedValue(OAUTH_OK)
    mockSessionStore.readSession.mockResolvedValue(null)

    await signInWithHostedPage()
    await signInWithHostedPage()

    expect(mockAuthClient.signIn.oauth2).toHaveBeenCalledTimes(2)
  })

  it("classifies a signed-out session read as a quiet cancel (AE2)", async () => {
    mockAuthClient.signIn.oauth2.mockResolvedValue(OAUTH_OK)
    // A stale signed-in snapshot must not read as success; the fresh
    // read's null is the truth.
    mockSessionStore.getSnapshot.mockReturnValue({
      status: "signedIn",
      user: { id: "user-stale" },
    } as never)
    mockSessionStore.readSession.mockResolvedValue(null)

    await expect(signInWithHostedPage()).resolves.toEqual({
      status: "cancelled",
    })
    expect(reportDatadogAction).not.toHaveBeenCalled()
    expect(getNewAccountNotice()).toBeNull()
  })

  it("retries a thrown session read once — a network fault is not a cancel", async () => {
    mockAuthClient.signIn.oauth2.mockResolvedValue(OAUTH_OK)
    mockSessionStore.readSession
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce({ id: "user-1" })

    await expect(signInWithHostedPage()).resolves.toEqual({
      status: "success",
    })
    expect(mockSessionStore.readSession).toHaveBeenCalledTimes(2)
    expect(reportDatadogAction).toHaveBeenCalledWith("sign_in_completed", {})
  })

  it("reports a retryable error — never a cancel — when the read fails twice (AE6)", async () => {
    mockAuthClient.signIn.oauth2.mockResolvedValue(OAUTH_OK)
    mockSessionStore.readSession.mockRejectedValue(new Error("network down"))

    await expect(signInWithHostedPage()).resolves.toEqual({ status: "error" })
    expect(mockSessionStore.readSession).toHaveBeenCalledTimes(2)
    expect(reportDatadogAction).not.toHaveBeenCalled()
  })

  it("classifies a thrown browser open through the failure classifier", async () => {
    mockAuthClient.signIn.oauth2.mockRejectedValueOnce({
      code: "ERR_REQUEST_CANCELED",
    })
    await expect(signInWithHostedPage()).resolves.toEqual({
      status: "cancelled",
    })

    mockAuthClient.signIn.oauth2.mockRejectedValueOnce(new TypeError("network"))
    await expect(signInWithHostedPage()).resolves.toEqual({ status: "error" })
    expect(mockSessionStore.readSession).not.toHaveBeenCalled()
  })

  it("reports an error when the sign-in request itself is rejected", async () => {
    mockAuthClient.signIn.oauth2.mockResolvedValue({
      data: null,
      error: { message: "provider misconfigured" },
    })

    await expect(signInWithHostedPage()).resolves.toEqual({ status: "error" })
    expect(mockSessionStore.readSession).not.toHaveBeenCalled()
  })

  it("marks the R15 notice for an account this sign-in created (server clocks only)", async () => {
    mockAuthClient.signIn.oauth2.mockResolvedValue(OAUTH_OK)
    mockSessionStore.readSession.mockResolvedValue({
      id: "user-hosted",
      createdAt: new Date(SERVER_NOW - 2_000).toISOString(),
      sessionCreatedAt: new Date(SERVER_NOW).toISOString(),
    })

    await expect(signInWithHostedPage()).resolves.toEqual({
      status: "success",
    })
    expect(getNewAccountNotice()).toBe("user-hosted")
    expect(reportDatadogAction).toHaveBeenCalledWith("sign_in_completed", {})
  })

  it("does not mark the notice for an established account", async () => {
    mockAuthClient.signIn.oauth2.mockResolvedValue(OAUTH_OK)
    mockSessionStore.readSession.mockResolvedValue({
      id: "user-old",
      createdAt: new Date(SERVER_NOW - 400 * 24 * 3600 * 1000).toISOString(),
      sessionCreatedAt: new Date(SERVER_NOW).toISOString(),
    })

    await expect(signInWithHostedPage()).resolves.toEqual({
      status: "success",
    })
    expect(getNewAccountNotice()).toBeNull()
  })

  it("does not mark the notice when the timestamps are absent — and does not crash", async () => {
    mockAuthClient.signIn.oauth2.mockResolvedValue(OAUTH_OK)
    mockSessionStore.readSession.mockResolvedValue({ id: "user-1" })

    await expect(signInWithHostedPage()).resolves.toEqual({
      status: "success",
    })
    expect(getNewAccountNotice()).toBeNull()
  })

  it("does not substitute the device clock when the session stamp is missing", async () => {
    mockAuthClient.signIn.oauth2.mockResolvedValue(OAUTH_OK)
    // createdAt is fresh relative to the DEVICE clock; without a session
    // stamp the check must stay silent, not fall back to Date.now().
    mockSessionStore.readSession.mockResolvedValue({
      id: "user-1",
      createdAt: new Date().toISOString(),
    })

    await expect(signInWithHostedPage()).resolves.toEqual({
      status: "success",
    })
    expect(getNewAccountNotice()).toBeNull()
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
