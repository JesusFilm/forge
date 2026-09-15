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
  signIn: { social: jest.fn() },
}

const mockSessionStore = {
  signOut: jest.fn(async () => {}),
  readSession: jest.fn(async (): Promise<unknown> => null),
  refresh: jest.fn(async () => {}),
  getSnapshot: jest.fn(() => ({ status: "signedOut", user: null })),
}

jest.mock("../authSession", () => ({
  getAuthClient: () => mockAuthClient,
  getAuthSession: () => mockSessionStore,
  // The REAL helpers: the timeout-wiring tests below pin the actual values.
  authFetchOptions:
    jest.requireActual<typeof import("../authSession")>("../authSession")
      .authFetchOptions,
  deleteFetchOptions:
    jest.requireActual<typeof import("../authSession")>("../authSession")
      .deleteFetchOptions,
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
  // A session minted days ago: valid in SecureStore, stale for deletion.
  const STALE_STAMP = new Date(SERVER_NOW - 3 * 24 * 3600 * 1000).toISOString()
  const OAUTH_OK = {
    data: { url: "https://auth", redirect: true },
    error: null,
  }

  it("joins a concurrent second call — only one browser session opens (AE2)", async () => {
    let release: (value: typeof OAUTH_OK) => void = () => {}
    mockAuthClient.signIn.social.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve
        }),
    )
    mockSessionStore.readSession.mockResolvedValue({ id: "user-1" })

    const first = signInWithHostedPage()
    const second = signInWithHostedPage()

    expect(mockAuthClient.signIn.social).toHaveBeenCalledTimes(1)
    release(OAUTH_OK)
    await expect(first).resolves.toEqual({ status: "success" })
    await expect(second).resolves.toEqual({ status: "success" })
  })

  it("launches a fresh browser session once the previous attempt settled", async () => {
    mockAuthClient.signIn.social.mockResolvedValue(OAUTH_OK)
    mockSessionStore.readSession.mockResolvedValue(null)

    await signInWithHostedPage()
    await signInWithHostedPage()

    expect(mockAuthClient.signIn.social).toHaveBeenCalledTimes(2)
  })

  it("classifies a signed-out session read as a quiet cancel (AE2)", async () => {
    mockAuthClient.signIn.social.mockResolvedValue(OAUTH_OK)
    // The pre-flight snapshot now feeds the unchanged-session classifier;
    // a null read is still a cancel regardless of what it holds.
    mockSessionStore.getSnapshot.mockReturnValue({
      status: "signedIn",
      user: { id: "user-stale", sessionCreatedAt: STALE_STAMP },
    } as never)
    mockSessionStore.readSession.mockResolvedValue(null)

    await expect(signInWithHostedPage()).resolves.toEqual({
      status: "cancelled",
    })
    expect(reportDatadogAction).not.toHaveBeenCalled()
    expect(getNewAccountNotice()).toBeNull()
  })

  it("classifies an unchanged session read-back as a cancel — deletion re-auth sheet dismissed", async () => {
    // The stale-but-valid session survives a dismissed sheet in SecureStore;
    // reading it back must NOT count as a completed re-auth.
    mockAuthClient.signIn.social.mockResolvedValue(OAUTH_OK)
    mockSessionStore.getSnapshot.mockReturnValue({
      status: "signedIn",
      user: { id: "user-1", sessionCreatedAt: STALE_STAMP },
    } as never)
    mockSessionStore.readSession.mockResolvedValue({
      id: "user-1",
      sessionCreatedAt: STALE_STAMP,
    })

    await expect(signInWithHostedPage()).resolves.toEqual({
      status: "cancelled",
    })
    expect(reportDatadogAction).not.toHaveBeenCalled()
    expect(getNewAccountNotice()).toBeNull()
  })

  it("treats a same-user read-back with NO session stamps as success, not a cancel", async () => {
    // If the payload ever omits sessionCreatedAt, `undefined === undefined`
    // would misread every real re-auth as a cancel and loop deletion forever.
    // The presence guard makes an absent pre-flight stamp fall through to
    // success — deleting either OR-clause of that guard fails this test.
    mockAuthClient.signIn.social.mockResolvedValue(OAUTH_OK)
    mockSessionStore.getSnapshot.mockReturnValue({
      status: "signedIn",
      user: { id: "user-1" },
    } as never)
    mockSessionStore.readSession.mockResolvedValue({ id: "user-1" })

    await expect(signInWithHostedPage()).resolves.toEqual({
      status: "success",
    })
    expect(reportDatadogAction).toHaveBeenCalledWith("sign_in_completed", {})
  })

  it("classifies a NEW session stamp for the same user as a completed re-auth", async () => {
    mockAuthClient.signIn.social.mockResolvedValue(OAUTH_OK)
    mockSessionStore.getSnapshot.mockReturnValue({
      status: "signedIn",
      user: { id: "user-1", sessionCreatedAt: STALE_STAMP },
    } as never)
    mockSessionStore.readSession.mockResolvedValue({
      id: "user-1",
      sessionCreatedAt: new Date(SERVER_NOW).toISOString(),
    })

    await expect(signInWithHostedPage()).resolves.toEqual({
      status: "success",
    })
    expect(reportDatadogAction).toHaveBeenCalledWith("sign_in_completed", {})
  })

  it("classifies a different user signing in as success — the caller handles wrong-account", async () => {
    mockAuthClient.signIn.social.mockResolvedValue(OAUTH_OK)
    mockSessionStore.getSnapshot.mockReturnValue({
      status: "signedIn",
      user: { id: "user-1", sessionCreatedAt: STALE_STAMP },
    } as never)
    mockSessionStore.readSession.mockResolvedValue({
      id: "user-2",
      sessionCreatedAt: new Date(SERVER_NOW).toISOString(),
    })

    await expect(signInWithHostedPage()).resolves.toEqual({
      status: "success",
    })
    expect(reportDatadogAction).toHaveBeenCalledWith("sign_in_completed", {})
  })

  it("bounds the pre-browser authorize-URL fetch with the shared auth timeout", async () => {
    mockAuthClient.signIn.social.mockResolvedValue(OAUTH_OK)
    mockSessionStore.readSession.mockResolvedValue({ id: "user-1" })

    await signInWithHostedPage()

    const { authFetchOptions } =
      jest.requireActual<typeof import("../authSession")>("../authSession")
    expect(authFetchOptions().fetchOptions.timeout).toBeGreaterThan(0)
    expect(mockAuthClient.signIn.social).toHaveBeenCalledWith({
      provider: "jfp",
      callbackURL: "/",
      ...authFetchOptions(),
    })
  })

  it("retries a thrown session read once — a network fault is not a cancel", async () => {
    mockAuthClient.signIn.social.mockResolvedValue(OAUTH_OK)
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
    mockAuthClient.signIn.social.mockResolvedValue(OAUTH_OK)
    mockSessionStore.readSession.mockRejectedValue(new Error("network down"))

    await expect(signInWithHostedPage()).resolves.toEqual({ status: "error" })
    expect(mockSessionStore.readSession).toHaveBeenCalledTimes(2)
    expect(reportDatadogAction).not.toHaveBeenCalled()
    // Re-sync the snapshot so a stale baseline can't later read a cancel as
    // success and delete the account (#3).
    expect(mockSessionStore.refresh).toHaveBeenCalled()
  })

  it("classifies any thrown browser open as a retryable error, never a cancel", async () => {
    // A real user cancel settles session-less instead of throwing, so even
    // a cancel-shaped provider code is a failure the user must see.
    mockAuthClient.signIn.social.mockRejectedValueOnce({
      code: "ERR_REQUEST_CANCELED",
    })
    await expect(signInWithHostedPage()).resolves.toEqual({ status: "error" })

    mockAuthClient.signIn.social.mockRejectedValueOnce(new TypeError("network"))
    await expect(signInWithHostedPage()).resolves.toEqual({ status: "error" })
    expect(mockSessionStore.readSession).not.toHaveBeenCalled()
  })

  it("reports an error when the sign-in request itself is rejected", async () => {
    mockAuthClient.signIn.social.mockResolvedValue({
      data: null,
      error: { message: "provider misconfigured" },
    })

    await expect(signInWithHostedPage()).resolves.toEqual({ status: "error" })
    expect(mockSessionStore.readSession).not.toHaveBeenCalled()
  })

  it("marks the R15 notice for an account this sign-in created (server clocks only)", async () => {
    mockAuthClient.signIn.social.mockResolvedValue(OAUTH_OK)
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
    mockAuthClient.signIn.social.mockResolvedValue(OAUTH_OK)
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
    mockAuthClient.signIn.social.mockResolvedValue(OAUTH_OK)
    mockSessionStore.readSession.mockResolvedValue({ id: "user-1" })

    await expect(signInWithHostedPage()).resolves.toEqual({
      status: "success",
    })
    expect(getNewAccountNotice()).toBeNull()
  })

  it("does not substitute the device clock when the session stamp is missing", async () => {
    mockAuthClient.signIn.social.mockResolvedValue(OAUTH_OK)
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

  it("still reports the account deleted when the post-delete signOut throws", async () => {
    // signOut's commit() invokes subscribers synchronously; a throwing
    // subscriber must not convert a completed deletion into a reported
    // failure. Without the try around signOut, this resolves rejected.
    mockAuthClient.deleteUser.mockResolvedValue({})
    mockSessionStore.signOut.mockRejectedValueOnce(
      new Error("subscriber threw"),
    )

    await expect(deleteAccount()).resolves.toEqual({ status: "deleted" })
    expect(mockSessionStore.signOut).toHaveBeenCalled()
  })

  it("bounds the destructive mutation with the dedicated delete timeout", async () => {
    mockAuthClient.deleteUser.mockResolvedValue({})

    await deleteAccount()

    const { authFetchOptions, deleteFetchOptions } =
      jest.requireActual<typeof import("../authSession")>("../authSession")
    // The delete ceiling must sit ABOVE the shared 5s so a legitimate slow
    // server delete (Apple revoke + admin erasure, ~10s) is not aborted —
    // reverting to authFetchOptions() (5s) fails this comparison.
    expect(deleteFetchOptions().fetchOptions.timeout).toBeGreaterThan(
      authFetchOptions().fetchOptions.timeout,
    )
    expect(deleteFetchOptions().fetchOptions.timeout).toBeGreaterThanOrEqual(
      15000,
    )
    expect(mockAuthClient.deleteUser).toHaveBeenCalledWith(deleteFetchOptions())
  })

  it("classifies a deleteUser timeout as an error when the session survives, never fresh-session-required", async () => {
    // KTD5 guard: a timeout/abort must NOT route to fresh-session-required, or
    // the auto-retry would mis-fire re-auth on a hung (not stale) session. With
    // the account still present after the abort, it is a plain retryable error.
    mockAuthClient.deleteUser.mockRejectedValue(
      Object.assign(new Error("timeout"), { name: "TimeoutError" }),
    )
    mockSessionStore.readSession.mockResolvedValue({ id: "user-1" })

    await expect(deleteAccount()).resolves.toEqual({ status: "error" })
    expect(mockSessionStore.signOut).not.toHaveBeenCalled()
  })

  it("treats an abort as a completed deletion when the session is then gone", async () => {
    // An abort does not cancel the server hook; a now-empty session means the
    // delete likely finished, so clear locally instead of lying "nothing changed".
    mockAuthClient.deleteUser.mockRejectedValue(
      Object.assign(new Error("aborted"), { name: "AbortError" }),
    )
    mockSessionStore.readSession.mockResolvedValue(null)

    await expect(deleteAccount()).resolves.toEqual({ status: "deleted" })
    expect(mockSessionStore.signOut).toHaveBeenCalled()
  })

  it("reports unconfirmed when the post-abort session probe itself fails", async () => {
    mockAuthClient.deleteUser.mockRejectedValue(
      Object.assign(new Error("timeout"), { name: "TimeoutError" }),
    )
    mockSessionStore.readSession.mockRejectedValue(new Error("still offline"))

    await expect(deleteAccount()).resolves.toEqual({ status: "unconfirmed" })
    expect(mockSessionStore.signOut).not.toHaveBeenCalled()
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

  it("reports an error rather than throwing when the call rejects and the session survives", async () => {
    mockAuthClient.deleteUser.mockRejectedValue(new Error("offline"))
    mockSessionStore.readSession.mockResolvedValue({ id: "user-1" })

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
