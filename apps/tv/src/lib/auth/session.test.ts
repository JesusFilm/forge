import * as SecureStore from "expo-secure-store"

import type { RefreshOutcome } from "./deviceGrantClient"
import {
  __resetSessionForTests,
  adoptTokens,
  getValidAccessToken,
  hydrateSession,
  signOut,
  subscribeToSession,
} from "./session"
import { loadSession, needsRefresh, REFRESH_SKEW_MS } from "./tokenStore"

const mockRefreshAccessToken = jest.fn<Promise<RefreshOutcome>, unknown[]>()
const mockRevokeToken = jest.fn<Promise<void>, unknown[]>()

// The whole transport is mocked rather than partially replaced: the real
// module reads `env` at import time, and the app's env schema is not satisfied
// under jest. Session logic is what is under test here; the transport's own
// response parsing is covered in deviceGrantClient.test.ts.
jest.mock("./deviceGrantClient", () => ({
  getDeviceGrantConfig: () => ({
    authBaseUrl: "https://auth.example.test",
    clientId: "jfp_tv_local",
  }),
  refreshAccessToken: (...args: unknown[]) => mockRefreshAccessToken(...args),
  revokeToken: (...args: unknown[]) => mockRevokeToken(...args),
}))

/** A promise plus the handle to settle it, so tests control the race. */
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

async function clearKeychain() {
  for (const key of [
    "forge.tv.auth.access_token",
    "forge.tv.auth.refresh_token",
    "forge.tv.auth.expires_at",
  ]) {
    await SecureStore.deleteItemAsync(key)
  }
}

beforeEach(async () => {
  __resetSessionForTests()
  mockRefreshAccessToken.mockReset()
  mockRevokeToken.mockReset()
  mockRevokeToken.mockResolvedValue(undefined)
  await clearKeychain()
})

describe("token storage", () => {
  it("round-trips a granted session through the keychain", async () => {
    await adoptTokens({
      accessToken: "jfp_at_a",
      refreshToken: "jfp_rt_a",
      expiresInSeconds: 3600,
    })
    const stored = await loadSession()
    expect(stored).toMatchObject({
      accessToken: "jfp_at_a",
      refreshToken: "jfp_rt_a",
    })
    expect(stored?.expiresAtMs).toBeGreaterThan(Date.now())
  })

  it("reports signed out when the keychain is empty", async () => {
    expect(await hydrateSession()).toEqual({ kind: "signed_out" })
  })

  it("does not refresh a session that has no refresh token", async () => {
    // Otherwise every request would attempt a refresh it cannot possibly do.
    expect(
      needsRefresh(
        { accessToken: "a", refreshToken: null, expiresAtMs: 0 },
        Date.now(),
      ),
    ).toBe(false)
  })

  it("refreshes before expiry, not at it", async () => {
    // A token that expires mid-request is a request that fails. The skew has
    // to be wider than the request timeout or the guard buys nothing.
    const expiresAtMs = 1_000_000
    const session = {
      accessToken: "a",
      refreshToken: "r",
      expiresAtMs,
    }
    expect(needsRefresh(session, expiresAtMs - REFRESH_SKEW_MS - 1)).toBe(false)
    expect(needsRefresh(session, expiresAtMs - REFRESH_SKEW_MS)).toBe(true)
  })
})

describe("single-flight refresh", () => {
  async function signInExpiring() {
    await adoptTokens({
      accessToken: "jfp_at_old",
      refreshToken: "jfp_rt_old",
      expiresInSeconds: 1,
    })
  }

  it("collapses concurrent callers into ONE network refresh", async () => {
    // The bug this prevents: with rotation on, five parallel refreshes mean
    // the first response invalidates the token the other four are using, and
    // the viewer is signed out by their own app.
    await signInExpiring()
    const gate = deferred<RefreshOutcome>()
    mockRefreshAccessToken.mockReturnValue(gate.promise)

    const callers = [
      getValidAccessToken(),
      getValidAccessToken(),
      getValidAccessToken(),
    ]
    await Promise.resolve()

    gate.resolve({
      kind: "refreshed",
      tokens: {
        accessToken: "jfp_at_new",
        refreshToken: "jfp_rt_new",
        expiresInSeconds: 3600,
      },
    })

    expect(await Promise.all(callers)).toEqual([
      "jfp_at_new",
      "jfp_at_new",
      "jfp_at_new",
    ])
    expect(mockRefreshAccessToken).toHaveBeenCalledTimes(1)
  })

  it("releases the slot so a LATER caller can refresh again", async () => {
    // The slot-leak this pins: a body-internal `finally` clears the slot
    // before the assignment lands, so every subsequent caller joins a dead,
    // already-settled flight and the app never refreshes again.
    await signInExpiring()
    mockRefreshAccessToken.mockResolvedValue({
      kind: "refreshed",
      tokens: {
        accessToken: "jfp_at_1",
        refreshToken: "jfp_rt_1",
        expiresInSeconds: 1,
      },
    })
    expect(await getValidAccessToken()).toBe("jfp_at_1")

    mockRefreshAccessToken.mockResolvedValue({
      kind: "refreshed",
      tokens: {
        accessToken: "jfp_at_2",
        refreshToken: "jfp_rt_2",
        expiresInSeconds: 3600,
      },
    })
    expect(await getValidAccessToken()).toBe("jfp_at_2")
    expect(mockRefreshAccessToken).toHaveBeenCalledTimes(2)
  })

  it("keeps the rotated refresh token, not the one it was issued with", async () => {
    await signInExpiring()
    mockRefreshAccessToken.mockResolvedValue({
      kind: "refreshed",
      tokens: {
        accessToken: "jfp_at_new",
        refreshToken: "jfp_rt_rotated",
        expiresInSeconds: 3600,
      },
    })
    await getValidAccessToken()
    expect((await loadSession())?.refreshToken).toBe("jfp_rt_rotated")
  })

  it("keeps the OLD refresh token when the server does not rotate", async () => {
    // The discriminating case: storing `undefined` here would wipe the only
    // credential that can renew the session, so the next refresh signs the
    // viewer out even though nothing was wrong.
    await signInExpiring()
    mockRefreshAccessToken.mockResolvedValue({
      kind: "refreshed",
      tokens: { accessToken: "jfp_at_new", expiresInSeconds: 3600 },
    })
    await getValidAccessToken()
    expect((await loadSession())?.refreshToken).toBe("jfp_rt_old")
  })

  it("does not let a settling flight clear its SUCCESSOR's slot", async () => {
    // Why the release is identity-checked. Sign-out drops the slot while a
    // refresh is still in the air; if that straggler's release fired blindly it
    // would clear the NEXT viewer's flight, and every later caller would start
    // its own duplicate refresh — the exact stampede single-flight exists to
    // stop, reappearing only after a sign-out.
    const gateA = deferred<RefreshOutcome>()
    const gateB = deferred<RefreshOutcome>()
    mockRefreshAccessToken
      .mockReturnValueOnce(gateA.promise)
      .mockReturnValueOnce(gateB.promise)

    await signInExpiring()
    const straggler = getValidAccessToken()
    await Promise.resolve()

    await signOut()
    await adoptTokens({
      accessToken: "jfp_at_second",
      refreshToken: "jfp_rt_second",
      expiresInSeconds: 1,
    })

    const second = getValidAccessToken()
    await Promise.resolve()

    // The first flight lands LAST, after the second has claimed the slot.
    gateA.resolve({ kind: "retryable" })
    await straggler
    await Promise.resolve()

    const third = getValidAccessToken()
    gateB.resolve({
      kind: "refreshed",
      tokens: {
        accessToken: "jfp_at_b",
        refreshToken: "jfp_rt_b",
        expiresInSeconds: 3600,
      },
    })
    await Promise.all([second, third])

    expect(mockRefreshAccessToken).toHaveBeenCalledTimes(2)
  })

  it("discards a refresh that lands after the viewer signed out", async () => {
    // The token is genuinely valid — that is what makes this dangerous. On a
    // shared TV, writing it would sign the PREVIOUS viewer back in seconds
    // after they chose to leave.
    const gate = deferred<RefreshOutcome>()
    mockRefreshAccessToken.mockReturnValue(gate.promise)

    await signInExpiring()
    const pending = getValidAccessToken()
    await Promise.resolve()

    await signOut()

    gate.resolve({
      kind: "refreshed",
      tokens: {
        accessToken: "jfp_at_ghost",
        refreshToken: "jfp_rt_ghost",
        expiresInSeconds: 3600,
      },
    })

    expect(await pending).toBeNull()
    expect(await loadSession()).toBeNull()
    expect(await getValidAccessToken()).toBeNull()
  })

  it("does not reject joiners when the flight throws", async () => {
    // A rejected shared promise with no joiner-side catch takes down every
    // caller that merely happened to arrive during it — and an unhandled
    // rejection in dev escalates to an all-native RCTFatal with no JS message.
    await signInExpiring()
    mockRefreshAccessToken.mockRejectedValue(new Error("keychain exploded"))

    const results = await Promise.all([
      getValidAccessToken(),
      getValidAccessToken(),
    ])
    expect(results).toEqual(["jfp_at_old", "jfp_at_old"])
  })
})

describe("refresh outcomes", () => {
  beforeEach(async () => {
    await adoptTokens({
      accessToken: "jfp_at_old",
      refreshToken: "jfp_rt_old",
      expiresInSeconds: 1,
    })
  })

  it("signs out when the server revokes the grant", async () => {
    mockRefreshAccessToken.mockResolvedValue({
      kind: "revoked",
      code: "invalid_grant",
    })
    expect(await getValidAccessToken()).toBeNull()
    expect(await loadSession()).toBeNull()
  })

  it("KEEPS the session when the failure is only retryable", async () => {
    // The falsifying case for treating every failure alike: a TV on flaky
    // wifi must not be signed out, or viewers get logged out overnight for no
    // reason and have to re-do the whole device flow on a remote control.
    mockRefreshAccessToken.mockResolvedValue({ kind: "retryable" })
    expect(await getValidAccessToken()).toBe("jfp_at_old")
    expect((await loadSession())?.refreshToken).toBe("jfp_rt_old")
  })
})

describe("sign out", () => {
  it("clears local state and revokes upstream", async () => {
    await adoptTokens({
      accessToken: "jfp_at_a",
      refreshToken: "jfp_rt_a",
      expiresInSeconds: 3600,
    })
    await signOut()
    expect(await loadSession()).toBeNull()
    expect(await getValidAccessToken()).toBeNull()
    expect(mockRevokeToken).toHaveBeenCalledWith(expect.anything(), "jfp_rt_a")
  })

  it("still signs out locally when revocation fails", async () => {
    // Sign-out is a promise to the person holding the remote. It cannot be
    // contingent on the network.
    await adoptTokens({ accessToken: "jfp_at_a", refreshToken: "jfp_rt_a" })
    mockRevokeToken.mockRejectedValue(new Error("offline"))
    await expect(signOut()).resolves.toBeUndefined()
    expect(await loadSession()).toBeNull()
  })

  it("tells subscribers", async () => {
    const seen: string[] = []
    const unsubscribe = subscribeToSession((s) => seen.push(s.kind))
    await adoptTokens({ accessToken: "jfp_at_a", refreshToken: "jfp_rt_a" })
    await signOut()
    unsubscribe()
    expect(seen).toEqual(["signed_in", "signed_out"])
  })
})
