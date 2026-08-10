import {
  JWT_EXPIRY_SKEW_MS,
  createAuthSessionStore,
  createSecureStorageAdapter,
  decodeJwtExpiryMs,
  isJwtFresh,
  rumUserFromSession,
  userFromSessionResult,
  SessionFetchError,
  type AuthSessionDeps,
} from "../authSession"

function fakeJwt(expSeconds: number): string {
  const payload = btoa(JSON.stringify({ exp: expSeconds }))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
  return `header.${payload}.signature`
}

function buildStore(overrides: Partial<AuthSessionDeps> = {}) {
  const deps: AuthSessionDeps = {
    fetchSession: jest.fn(async () => ({ id: "user-1" })),
    fetchToken: jest.fn(async () => fakeJwt(2_000_000_000)),
    signOutRemote: jest.fn(async () => {}),
    now: () => 1_000_000_000_000,
    ...overrides,
  }
  return { store: createAuthSessionStore(deps), deps }
}

describe("session snapshot lifecycle", () => {
  it("transitions signed-out → signed-in → signed-out", async () => {
    const fetchSession = jest
      .fn<Promise<{ id: string } | null>, []>()
      .mockResolvedValueOnce({ id: "user-1" })
      .mockResolvedValueOnce(null)
    const { store } = buildStore({ fetchSession })

    expect(store.getSnapshot()).toEqual({ status: "signedOut", user: null })

    await store.refresh()
    expect(store.getSnapshot()).toEqual({
      status: "signedIn",
      user: { id: "user-1" },
    })

    await store.refresh()
    expect(store.getSnapshot()).toEqual({ status: "signedOut", user: null })
  })

  it("keeps the last snapshot when a refresh throws (offline tolerance)", async () => {
    const fetchSession = jest
      .fn<Promise<{ id: string } | null>, []>()
      .mockResolvedValueOnce({ id: "user-1" })
      .mockRejectedValueOnce(new Error("network down"))
    const { store } = buildStore({ fetchSession })

    await store.refresh()
    await store.refresh()

    expect(store.getSnapshot().status).toBe("signedIn")
  })

  it("notifies subscribers on every transition", async () => {
    const { store } = buildStore()
    const listener = jest.fn()
    store.subscribe(listener)

    await store.refresh()
    expect(listener).toHaveBeenCalledTimes(1)

    // A same-identity refresh must not thrash subscribers.
    await store.refresh()
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it("applySignedIn commits immediately after a completed sign-in flow", () => {
    const { store } = buildStore()
    store.applySignedIn({ id: "user-2", email: "p@example.com" })

    expect(store.getSnapshot()).toEqual({
      status: "signedIn",
      user: { id: "user-2", email: "p@example.com" },
    })
  })
})

describe("JWT fetch and refresh (KTD9/KTD10)", () => {
  it("returns null when signed out — public traffic never fetches a token", async () => {
    const { store, deps } = buildStore()
    await expect(store.getFreshJwt()).resolves.toBeNull()
    expect(deps.fetchToken).not.toHaveBeenCalled()
  })

  it("mints once and reuses a fresh token", async () => {
    const { store, deps } = buildStore()
    await store.refresh()

    const first = await store.getFreshJwt()
    const second = await store.getFreshJwt()

    expect(first).toBe(second)
    expect(deps.fetchToken).toHaveBeenCalledTimes(1)
  })

  it("refreshes when the held token is inside the expiry skew", async () => {
    const nowMs = 1_000_000_000_000
    const nearExpiry = fakeJwt((nowMs + JWT_EXPIRY_SKEW_MS / 2) / 1000)
    const fresh = fakeJwt((nowMs + 15 * 60_000) / 1000)
    const fetchToken = jest
      .fn<Promise<string | null>, []>()
      .mockResolvedValueOnce(nearExpiry)
      .mockResolvedValueOnce(fresh)
    const { store, deps } = buildStore({ fetchToken, now: () => nowMs })
    await store.refresh()

    await store.getFreshJwt()
    const second = await store.getFreshJwt()

    expect(second).toBe(fresh)
    expect(deps.fetchToken).toHaveBeenCalledTimes(2)
  })

  it("shares one in-flight mint between concurrent callers", async () => {
    const { store, deps } = buildStore()
    await store.refresh()

    const [a, b] = await Promise.all([store.getFreshJwt(), store.getFreshJwt()])

    expect(a).toBe(b)
    expect(deps.fetchToken).toHaveBeenCalledTimes(1)
  })

  it("returns null when the mint fails (fail-open, R11)", async () => {
    const { store } = buildStore({
      fetchToken: jest.fn(async () => {
        throw new Error("mint failed")
      }),
    })
    await store.refresh()

    await expect(store.getFreshJwt()).resolves.toBeNull()
  })
})

describe("JWT is bound to the subject that minted it (R10)", () => {
  it("re-mints after a refresh reveals a different account", async () => {
    // A shared device switching accounts. The old token is still unexpired,
    // so a freshness check alone happily reuses it — and admin would then
    // attribute the new account's positions to the old one.
    const fetchSession = jest
      .fn<Promise<{ id: string } | null>, []>()
      .mockResolvedValueOnce({ id: "user-1" })
      .mockResolvedValueOnce({ id: "user-2" })
    const fetchToken = jest
      .fn<Promise<string | null>, []>()
      .mockResolvedValueOnce(fakeJwt(2_000_000_000))
      .mockResolvedValueOnce(fakeJwt(2_000_000_001))
    const { store } = buildStore({ fetchSession, fetchToken })

    await store.refresh()
    const first = await store.getFreshJwt()
    await store.refresh()
    const second = await store.getFreshJwt()

    expect(first).not.toBeNull()
    expect(second).not.toBe(first)
    expect(fetchToken).toHaveBeenCalledTimes(2)
  })

  it("keeps the token when only the profile changed", async () => {
    const fetchSession = jest
      .fn<Promise<{ id: string; name?: string } | null>, []>()
      .mockResolvedValueOnce({ id: "user-1", name: "Old" })
      .mockResolvedValueOnce({ id: "user-1", name: "New" })
    const { store, deps } = buildStore({ fetchSession })

    await store.refresh()
    await store.getFreshJwt()
    await store.refresh()
    await store.getFreshJwt()

    expect(deps.fetchToken).toHaveBeenCalledTimes(1)
    expect(store.getSnapshot()).toMatchObject({ user: { name: "New" } })
  })

  it("discards a mint that lands after the account changed", async () => {
    // The window the epoch closes: the mint was issued for user-1 but
    // resolves after user-2 is current. Failing open beats a wrong subject.
    let release: (token: string) => void = () => {}
    const fetchToken = jest.fn(
      () =>
        new Promise<string | null>((resolve) => {
          release = resolve
        }),
    )
    const fetchSession = jest
      .fn<Promise<{ id: string } | null>, []>()
      .mockResolvedValueOnce({ id: "user-1" })
      .mockResolvedValueOnce({ id: "user-2" })
    const { store } = buildStore({ fetchSession, fetchToken })

    await store.refresh()
    const pending = store.getFreshJwt()
    await store.refresh()
    release(fakeJwt(2_000_000_000))

    await expect(pending).resolves.toBeNull()
  })

  it("discards a mint that lands after sign-out", async () => {
    let release: (token: string) => void = () => {}
    const fetchToken = jest.fn(
      () =>
        new Promise<string | null>((resolve) => {
          release = resolve
        }),
    )
    const { store } = buildStore({ fetchToken })

    await store.refresh()
    const pending = store.getFreshJwt()
    await store.signOut()
    release(fakeJwt(2_000_000_000))

    await expect(pending).resolves.toBeNull()
  })
})

describe("signOut (R4)", () => {
  it("revokes remotely then clears local state", async () => {
    const { store, deps } = buildStore()
    await store.refresh()

    await store.signOut()

    expect(deps.signOutRemote).toHaveBeenCalledTimes(1)
    expect(store.getSnapshot()).toEqual({ status: "signedOut", user: null })
    await expect(store.getFreshJwt()).resolves.toBeNull()
  })

  it("clears local state even when remote revocation fails", async () => {
    const { store } = buildStore({
      signOutRemote: jest.fn(async () => {
        throw new Error("network down")
      }),
    })
    await store.refresh()

    await store.signOut()

    expect(store.getSnapshot().status).toBe("signedOut")
  })
})

describe("jwt helpers", () => {
  it("decodes expiry from a base64url payload", () => {
    expect(decodeJwtExpiryMs(fakeJwt(1_700_000_000))).toBe(1_700_000_000_000)
  })

  it("degrades malformed tokens to null / stale", () => {
    expect(decodeJwtExpiryMs("not-a-jwt")).toBeNull()
    expect(decodeJwtExpiryMs("a.b.c")).toBeNull()
    expect(isJwtFresh("a.b.c", 0)).toBe(false)
  })

  it("treats tokens inside the skew window as stale", () => {
    const nowMs = 1_000_000_000_000
    expect(isJwtFresh(fakeJwt((nowMs + 30_000) / 1000), nowMs)).toBe(false)
    expect(isJwtFresh(fakeJwt((nowMs + 120_000) / 1000), nowMs)).toBe(true)
  })
})

describe("rumUserFromSession (no-PII contract)", () => {
  it("carries the opaque subject id and NOTHING else", () => {
    const payload = rumUserFromSession({
      status: "signedIn",
      user: { id: "user-1", email: "p@example.com", name: "Person" },
    })

    expect(payload).toEqual({ id: "user-1" })
    // Asserted on the attribute set so a later parity change cannot widen
    // it silently into exporting account PII.
    expect(Object.keys(payload ?? {})).toEqual(["id"])
  })

  it("clears the RUM user when signed out", () => {
    expect(rumUserFromSession({ status: "signedOut", user: null })).toBeNull()
  })
})

describe("secure storage adapter (R14)", () => {
  it("round-trips values with the this-device-only option", () => {
    const backing = new Map<string, string>()
    const options = { keychainAccessible: "this-device-only" }
    const getItem = jest.fn((key: string) => backing.get(key) ?? null)
    const setItem = jest.fn((key: string, value: string) => {
      backing.set(key, value)
    })

    const adapter = createSecureStorageAdapter({ getItem, setItem }, options)
    adapter.setItem("forge-watch_cookie", "session-blob")

    expect(adapter.getItem("forge-watch_cookie")).toBe("session-blob")
    expect(setItem).toHaveBeenCalledWith(
      "forge-watch_cookie",
      "session-blob",
      options,
    )
    expect(getItem).toHaveBeenCalledWith("forge-watch_cookie", options)
  })

  it("degrades storage failures to null instead of throwing", () => {
    const adapter = createSecureStorageAdapter(
      {
        getItem: () => {
          throw new Error("keychain unavailable")
        },
        setItem: () => {
          throw new Error("keychain unavailable")
        },
      },
      {},
    )

    expect(adapter.getItem("any")).toBeNull()
    expect(() => adapter.setItem("any", "value")).not.toThrow()
  })
})

describe("userFromSessionResult (outage is not a sign-out)", () => {
  it("returns the user on a normal response", () => {
    expect(userFromSessionResult({ data: { user: { id: "user-1" } } })).toEqual(
      { id: "user-1", email: undefined, name: undefined },
    )
  })

  it("returns null for a real signed-out response", () => {
    expect(userFromSessionResult({ data: null })).toBeNull()
  })

  it("THROWS on an error envelope rather than reporting signed out", () => {
    // better-fetch resolves {data:null,error} on a 5xx without throwing.
    // Reading that as a sign-out wipes the store, snapshot, and the unsent
    // offline queue on a transient auth outage.
    expect(() =>
      userFromSessionResult({ data: null, error: { status: 503 } }),
    ).toThrow(SessionFetchError)
    try {
      userFromSessionResult({ data: null, error: { status: 503 } })
    } catch (e) {
      // The status rides as a field — callers never parse a message.
      expect((e as SessionFetchError).status).toBe(503)
    }
  })

  it("throws even when an error arrives alongside data", () => {
    expect(() =>
      userFromSessionResult({
        data: { user: { id: "user-1" } },
        error: { status: 500 },
      }),
    ).toThrow(SessionFetchError)
  })
})

describe("refresh() keeps the session through an outage", () => {
  it("does not sign out when the session read throws", async () => {
    const fetchSession = jest
      .fn<Promise<{ id: string } | null>, []>()
      .mockResolvedValueOnce({ id: "user-1" })
      .mockRejectedValueOnce(new SessionFetchError(503))
    const { store } = buildStore({ fetchSession })

    await store.refresh()
    await store.refresh()

    expect(store.getSnapshot()).toMatchObject({
      status: "signedIn",
      user: { id: "user-1" },
    })
  })
})
