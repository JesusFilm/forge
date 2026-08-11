/**
 * The orchestrator behind hosted sign-in, sign-out, and deletion. Its pure
 * collaborators are each tested on their own; what is only testable here is
 * the COMPOSITION — that a failed handoff never reads as success, that a
 * completed sign-in raises the R15 notice only for a fresh account, and
 * that deletion clears local state only when the account really went.
 * Every export is reachable by faking the auth client.
 */

const mockAuthClient = {
  deleteUser: jest.fn(),
  signIn: { oauth2: jest.fn() },
}

const mockSessionStore = {
  signOut: jest.fn(async () => {}),
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
import { deleteAccount, signInWithHostedPage, signOut } from "../authActions"

beforeEach(() => {
  jest.clearAllMocks()
  clearNewAccountNotice()
  mockSessionStore.getSnapshot.mockReturnValue({
    status: "signedOut",
    user: null,
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

  it("classifies any thrown browser open as a retryable error, never a cancel", async () => {
    // A real user cancel settles session-less instead of throwing, so even
    // a cancel-shaped provider code is a failure the user must see.
    mockAuthClient.signIn.oauth2.mockRejectedValueOnce({
      code: "ERR_REQUEST_CANCELED",
    })
    await expect(signInWithHostedPage()).resolves.toEqual({ status: "error" })

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
