import { RecommendationClientError } from "../errors"
import {
  BOOTSTRAP_COOLDOWN_MS,
  FRESH_HANDLE_WINDOW_MS,
  LAST_ACTIVE_PERSIST_INTERVAL_MS,
  RECOMMENDATION_VIEWER_STORAGE_KEY,
  SESSION_INACTIVITY_ROTATION_MS,
  VERIFY_RETRY_BACKOFF_MS,
  createViewerIdentityStore,
  parseViewerRecord,
  type RecommendationViewerRecord,
  type ViewerIdentityDeps,
} from "../viewerIdentity"

const T0 = Date.parse("2026-09-16T00:00:00.000Z")
const DAY = 24 * 60 * 60 * 1_000
const VIEWER = "v".repeat(43)
const SESSION = "s".repeat(43)
const ROTATED = "r".repeat(43)

function fakeStorage(initial?: string) {
  const items = new Map<string, string>()
  if (initial) items.set(RECOMMENDATION_VIEWER_STORAGE_KEY, initial)
  return {
    items,
    getItemAsync: jest.fn(async (key: string) => items.get(key) ?? null),
    setItemAsync: jest.fn(async (key: string, value: string) => {
      items.set(key, value)
    }),
    deleteItemAsync: jest.fn(async (key: string) => {
      items.delete(key)
    }),
  }
}

function record(
  overrides: Partial<RecommendationViewerRecord> = {},
): RecommendationViewerRecord {
  return {
    version: 1,
    viewerToken: VIEWER,
    viewerExpiresAt: new Date(T0 + 180 * DAY).toISOString(),
    sessionToken: SESSION,
    bootstrappedAt: new Date(T0 - DAY).toISOString(),
    lastActiveAt: new Date(T0 - 1_000).toISOString(),
    personalization: true,
    ...overrides,
  }
}

function makeStore(overrides: Partial<ViewerIdentityDeps> = {}) {
  let now = T0
  const storage = fakeStorage()
  const bootstrap = jest.fn(async () => ({
    viewerToken: VIEWER,
    sessionToken: SESSION,
    expiresAt: new Date(now + 180 * DAY).toISOString(),
    personalization: true,
  }))
  const updateViewer = jest.fn(async () => ({
    state: "active",
    personalization: true,
  }))
  const report = jest.fn()
  const deps: ViewerIdentityDeps = {
    isEnabled: () => true,
    hasBearer: () => true,
    storage,
    bootstrap,
    updateViewer,
    randomToken: () => ROTATED,
    now: () => now,
    report,
    ...overrides,
  }
  const store = createViewerIdentityStore(deps)
  return {
    store,
    storage,
    bootstrap: deps.bootstrap as jest.Mock,
    updateViewer: deps.updateViewer as jest.Mock,
    report,
    advance: (ms: number) => {
      now += ms
    },
  }
}

describe("parseViewerRecord", () => {
  it("accepts a well-formed record and rejects every malformed field", () => {
    const good = record()
    expect(parseViewerRecord(JSON.stringify(good))).toEqual(good)
    expect(parseViewerRecord(null)).toBeNull()
    expect(parseViewerRecord("not json")).toBeNull()
    for (const bad of [
      { version: 2 },
      { viewerToken: "short" },
      { sessionToken: "x".repeat(44) },
      { viewerExpiresAt: "yesterday" },
      { bootstrappedAt: "" },
      { lastActiveAt: 123 as unknown as string },
      { personalization: "yes" as unknown as boolean },
    ]) {
      expect(parseViewerRecord(JSON.stringify({ ...good, ...bad }))).toBeNull()
    }
  })
})

describe("createViewerIdentityStore — gates", () => {
  it("reports disabled without touching storage or the network", async () => {
    const { store, storage, bootstrap } = makeStore({ isEnabled: () => false })
    expect(await store.get()).toEqual({ kind: "disabled" })
    expect(storage.getItemAsync).not.toHaveBeenCalled()
    expect(bootstrap).not.toHaveBeenCalled()
  })

  it("reports unprovisioned without a fleet bearer, sending nothing", async () => {
    const { store, storage, bootstrap } = makeStore({ hasBearer: () => false })
    expect(await store.get()).toEqual({ kind: "unprovisioned" })
    expect(storage.getItemAsync).not.toHaveBeenCalled()
    expect(bootstrap).not.toHaveBeenCalled()
  })
})

describe("createViewerIdentityStore — bootstrap", () => {
  it("bootstraps once, persists the record, and reuses it", async () => {
    const { store, storage, bootstrap } = makeStore()
    const first = await store.get()
    expect(first).toEqual({
      kind: "ready",
      identity: { viewerToken: VIEWER, sessionToken: SESSION },
      personalization: true,
    })
    expect(bootstrap).toHaveBeenCalledTimes(1)
    const stored = parseViewerRecord(
      storage.items.get(RECOMMENDATION_VIEWER_STORAGE_KEY) ?? null,
    )
    expect(stored?.viewerToken).toBe(VIEWER)
    expect(stored?.bootstrappedAt).toBe(new Date(T0).toISOString())
    expect(await store.get()).toEqual(first)
    expect(bootstrap).toHaveBeenCalledTimes(1)
  })

  it("shares one bootstrap between concurrent callers", async () => {
    const { store, bootstrap } = makeStore()
    const [a, b, c] = await Promise.all([store.get(), store.get(), store.get()])
    expect(bootstrap).toHaveBeenCalledTimes(1)
    expect(a).toEqual(b)
    expect(b).toEqual(c)
  })

  it("loads a stored record instead of bootstrapping", async () => {
    const storage = fakeStorage(JSON.stringify(record()))
    const { store, bootstrap } = makeStore({ storage })
    const result = await store.get()
    expect(result.kind).toBe("ready")
    expect(bootstrap).not.toHaveBeenCalled()
  })

  it("re-bootstraps when the stored handle has expired", async () => {
    const storage = fakeStorage(
      JSON.stringify(
        record({ viewerExpiresAt: new Date(T0 - 1).toISOString() }),
      ),
    )
    const { store, bootstrap, report } = makeStore({ storage })
    expect((await store.get()).kind).toBe("ready")
    expect(bootstrap).toHaveBeenCalledTimes(1)
    expect(report).toHaveBeenCalledWith("handle_expired")
  })

  it("reports unavailable on a failed bootstrap and holds a cooldown", async () => {
    const { store, bootstrap, advance } = makeStore({
      bootstrap: jest.fn(async () => {
        throw new RecommendationClientError("SERVICE_UNAVAILABLE")
      }),
    })
    expect(await store.get()).toEqual({
      kind: "unavailable",
      reason: "bootstrap_failed",
    })
    expect(await store.get()).toEqual({
      kind: "unavailable",
      reason: "bootstrap_cooldown",
    })
    advance(BOOTSTRAP_COOLDOWN_MS)
    expect(await store.get()).toEqual({
      kind: "unavailable",
      reason: "bootstrap_failed",
    })
    expect(bootstrap).toHaveBeenCalledTimes(2)
  })

  it("treats a rate-limited bootstrap as a cooldown, not a failed bearer", async () => {
    const { store, bootstrap, report, advance } = makeStore({
      bootstrap: jest.fn(async () => {
        throw new RecommendationClientError("RATE_LIMITED")
      }),
    })
    expect(await store.get()).toEqual({
      kind: "unavailable",
      reason: "rate_limited",
    })
    expect(report).toHaveBeenCalledWith("bootstrap_rate_limited")
    expect(report).not.toHaveBeenCalledWith(
      "bootstrap_failed",
      expect.anything(),
    )
    expect(await store.get()).toEqual({
      kind: "unavailable",
      reason: "bootstrap_cooldown",
    })
    advance(BOOTSTRAP_COOLDOWN_MS)
    await store.get()
    expect(bootstrap).toHaveBeenCalledTimes(2)
  })

  it("refuses a bootstrap answer whose tokens are not Admin's shape", async () => {
    const { store } = makeStore({
      bootstrap: jest.fn(async () => ({
        viewerToken: "short",
        sessionToken: SESSION,
        expiresAt: new Date(T0 + DAY).toISOString(),
        personalization: true,
      })),
    })
    expect((await store.get()).kind).toBe("unavailable")
  })

  it("keeps serving from memory when storage writes fail", async () => {
    const storage = fakeStorage()
    storage.setItemAsync.mockRejectedValue(new Error("keychain busy"))
    const { store, bootstrap, report } = makeStore({ storage })
    expect((await store.get()).kind).toBe("ready")
    expect((await store.get()).kind).toBe("ready")
    expect(bootstrap).toHaveBeenCalledTimes(1)
    expect(report).toHaveBeenCalledWith("storage_write_failed")
  })

  it("treats an unreadable store as empty", async () => {
    const storage = fakeStorage()
    storage.getItemAsync.mockRejectedValue(new Error("keychain locked"))
    const { store, bootstrap } = makeStore({ storage })
    expect((await store.get()).kind).toBe("ready")
    expect(bootstrap).toHaveBeenCalledTimes(1)
  })
})

describe("createViewerIdentityStore — session rotation", () => {
  it("rotates after 24h of inactivity, linking the new session with status first", async () => {
    const storage = fakeStorage(JSON.stringify(record()))
    const { store, updateViewer, advance, bootstrap } = makeStore({ storage })
    advance(SESSION_INACTIVITY_ROTATION_MS + 1_000)
    const result = await store.get()
    expect(updateViewer).toHaveBeenCalledWith(
      { viewerToken: VIEWER, sessionToken: ROTATED },
      "status",
    )
    expect(result).toMatchObject({
      identity: { viewerToken: VIEWER, sessionToken: ROTATED },
    })
    expect(bootstrap).not.toHaveBeenCalled()
    const stored = parseViewerRecord(
      storage.items.get(RECOMMENDATION_VIEWER_STORAGE_KEY) ?? null,
    )
    expect(stored?.sessionToken).toBe(ROTATED)
  })

  it("does not rotate inside the window", async () => {
    const storage = fakeStorage(JSON.stringify(record()))
    const { store, updateViewer, advance } = makeStore({ storage })
    advance(SESSION_INACTIVITY_ROTATION_MS - 60_000)
    const result = await store.get()
    expect(updateViewer).not.toHaveBeenCalled()
    expect(result).toMatchObject({ identity: { sessionToken: SESSION } })
  })

  it("does not rotate without a cryptographic source: the server-minted session persists", async () => {
    const storage = fakeStorage(JSON.stringify(record()))
    const { store, updateViewer, advance, report } = makeStore({
      storage,
      randomToken: () => null,
    })
    advance(SESSION_INACTIVITY_ROTATION_MS + 1_000)
    const result = await store.get()
    expect(updateViewer).not.toHaveBeenCalled()
    expect(result).toMatchObject({ identity: { sessionToken: SESSION } })
    // Reported once per store, so an operator can see the missing source.
    await store.get()
    expect(
      report.mock.calls.filter(
        ([event]) => event === "session_rotation_unavailable",
      ),
    ).toHaveLength(1)
  })

  it("does not rotate while a playback holds the session", async () => {
    const storage = fakeStorage(JSON.stringify(record()))
    const { store, updateViewer, advance } = makeStore({ storage })
    const release = store.holdPlayback()
    advance(SESSION_INACTIVITY_ROTATION_MS + 1_000)
    expect(await store.get()).toMatchObject({
      identity: { sessionToken: SESSION },
    })
    expect(updateViewer).not.toHaveBeenCalled()
    release()
    release()
    expect(await store.get()).toMatchObject({
      identity: { sessionToken: ROTATED },
    })
  })

  it("keeps the old session when the status link fails transiently", async () => {
    const storage = fakeStorage(JSON.stringify(record()))
    const { store, advance, report } = makeStore({
      storage,
      updateViewer: jest.fn(async () => {
        throw new RecommendationClientError("SERVICE_UNAVAILABLE")
      }),
    })
    advance(SESSION_INACTIVITY_ROTATION_MS + 1_000)
    expect(await store.get()).toMatchObject({
      identity: { sessionToken: SESSION },
    })
    expect(report).toHaveBeenCalledWith("session_rotate_failed", {
      rec_code: "SERVICE_UNAVAILABLE",
    })
  })

  it("re-bootstraps once when the status link says the handle is unknown", async () => {
    const storage = fakeStorage(JSON.stringify(record()))
    const { store, bootstrap, advance } = makeStore({
      storage,
      updateViewer: jest.fn(async () => {
        throw new RecommendationClientError("UNAUTHENTICATED")
      }),
    })
    advance(SESSION_INACTIVITY_ROTATION_MS + 1_000)
    expect((await store.get()).kind).toBe("ready")
    expect(bootstrap).toHaveBeenCalledTimes(1)
  })

  it("touch() keeps an active install inside the window and persists sparingly", async () => {
    const storage = fakeStorage(JSON.stringify(record()))
    const { store, updateViewer, advance } = makeStore({ storage })
    await store.get()
    const writesBefore = storage.setItemAsync.mock.calls.length
    advance(SESSION_INACTIVITY_ROTATION_MS - 1_000)
    store.touch()
    store.touch()
    expect(storage.setItemAsync.mock.calls.length).toBe(writesBefore + 1)
    advance(LAST_ACTIVE_PERSIST_INTERVAL_MS)
    store.touch()
    expect(storage.setItemAsync.mock.calls.length).toBe(writesBefore + 2)
    advance(SESSION_INACTIVITY_ROTATION_MS - 1_000)
    await store.get()
    expect(updateViewer).not.toHaveBeenCalled()
  })
})

describe("createViewerIdentityStore — invalidate and update", () => {
  const VIEWER2 = "w".repeat(43)
  const SESSION2 = "t".repeat(43)
  // One mock per dep: a shared instance would count the status probe and the
  // bootstrap attempt together.
  const rejecting = () =>
    jest.fn(async () => {
      throw new RecommendationClientError("UNAUTHENTICATED")
    })

  // The guide: "validate configuration before discarding a stored viewer".
  it("invalidate() keeps the stored viewer and re-verifies it with status first", async () => {
    const storage = fakeStorage(JSON.stringify(record()))
    const { store, bootstrap, updateViewer, report } = makeStore({ storage })
    await store.get()
    await store.invalidate()
    expect(storage.items.has(RECOMMENDATION_VIEWER_STORAGE_KEY)).toBe(true)
    const verified = await store.get()
    expect(updateViewer).toHaveBeenCalledWith(
      { viewerToken: VIEWER, sessionToken: SESSION },
      "status",
    )
    expect(verified).toMatchObject({
      kind: "ready",
      identity: { viewerToken: VIEWER },
    })
    expect(bootstrap).not.toHaveBeenCalled()
    expect(report).toHaveBeenCalledWith("handle_verified")
    // Verified once: the next read does not ask again.
    await store.get()
    expect(updateViewer).toHaveBeenCalledTimes(1)
  })

  it("replaces the viewer only when status rejects it AND a bootstrap under the same bearer succeeds", async () => {
    const storage = fakeStorage(JSON.stringify(record()))
    const listener = jest.fn()
    const { store, bootstrap } = makeStore({
      storage,
      updateViewer: rejecting(),
      bootstrap: jest.fn(async () => ({
        viewerToken: VIEWER2,
        sessionToken: SESSION2,
        expiresAt: new Date(T0 + 180 * DAY).toISOString(),
        personalization: true,
      })),
    })
    store.subscribe(listener)
    await store.get()
    await store.invalidate()
    expect(await store.get()).toMatchObject({
      kind: "ready",
      identity: { viewerToken: VIEWER2, sessionToken: SESSION2 },
    })
    expect(bootstrap).toHaveBeenCalledTimes(1)
    expect(
      parseViewerRecord(
        storage.items.get(RECOMMENDATION_VIEWER_STORAGE_KEY) ?? null,
      )?.viewerToken,
    ).toBe(VIEWER2)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it("keeps the stored viewer when the bearer itself is rejected", async () => {
    const storage = fakeStorage(JSON.stringify(record()))
    const { store, advance, bootstrap } = makeStore({
      storage,
      updateViewer: rejecting(),
      bootstrap: rejecting(),
    })
    await store.get()
    await store.invalidate()
    expect(await store.get()).toEqual({
      kind: "unavailable",
      reason: "bootstrap_failed",
    })
    expect(
      parseViewerRecord(
        storage.items.get(RECOMMENDATION_VIEWER_STORAGE_KEY) ?? null,
      )?.viewerToken,
    ).toBe(VIEWER)
    expect(await store.get()).toEqual({
      kind: "unavailable",
      reason: "bootstrap_cooldown",
    })
    advance(BOOTSTRAP_COOLDOWN_MS)
    await store.get()
    expect(bootstrap).toHaveBeenCalledTimes(2)
  })

  it("keeps using a suspect handle when the verification fails transiently", async () => {
    const storage = fakeStorage(JSON.stringify(record()))
    const { store, bootstrap } = makeStore({
      storage,
      updateViewer: jest.fn(async () => {
        throw new RecommendationClientError("SERVICE_UNAVAILABLE")
      }),
    })
    await store.get()
    await store.invalidate()
    expect(await store.get()).toMatchObject({
      kind: "ready",
      identity: { viewerToken: VIEWER },
    })
    expect(bootstrap).not.toHaveBeenCalled()
  })

  it("defers the next verification after a transient failure instead of asking on every read", async () => {
    const storage = fakeStorage(JSON.stringify(record()))
    const { store, updateViewer, report, advance } = makeStore({
      storage,
      updateViewer: jest.fn(async () => {
        throw new RecommendationClientError("SERVICE_UNAVAILABLE")
      }),
    })
    await store.get()
    await store.invalidate()
    expect((await store.get()).kind).toBe("ready")
    expect(updateViewer).toHaveBeenCalledTimes(1)
    expect(report).toHaveBeenCalledWith("verify_deferred", {
      rec_code: "SERVICE_UNAVAILABLE",
    })
    // Still suspect, still serving, no further status probe inside the window.
    expect((await store.get()).kind).toBe("ready")
    expect((await store.get()).kind).toBe("ready")
    expect(updateViewer).toHaveBeenCalledTimes(1)
    advance(VERIFY_RETRY_BACKOFF_MS)
    expect((await store.get()).kind).toBe("ready")
    expect(updateViewer).toHaveBeenCalledTimes(2)
  })

  it("a rejected FRESH handle enters the cooldown before any verification", async () => {
    const { store, bootstrap, updateViewer, advance } = makeStore()
    await store.get()
    advance(FRESH_HANDLE_WINDOW_MS - 1_000)
    await store.invalidate()
    expect(await store.get()).toEqual({
      kind: "unavailable",
      reason: "bootstrap_cooldown",
    })
    expect(updateViewer).not.toHaveBeenCalled()
    advance(BOOTSTRAP_COOLDOWN_MS)
    expect((await store.get()).kind).toBe("ready")
    expect(updateViewer).toHaveBeenCalledTimes(1)
    expect(bootstrap).toHaveBeenCalledTimes(1)
  })

  it("notifies subscribers after a profile transition, not after a status read", async () => {
    const storage = fakeStorage(JSON.stringify(record()))
    const { store } = makeStore({ storage })
    const listener = jest.fn()
    const unsubscribe = store.subscribe(listener)
    await store.update("status")
    expect(listener).not.toHaveBeenCalled()
    await store.update("reset")
    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
    await store.update("withdraw")
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it("update() forwards the action and persists the answered personalization", async () => {
    const storage = fakeStorage(JSON.stringify(record()))
    const { store, updateViewer } = makeStore({
      storage,
      updateViewer: jest.fn(async () => ({
        state: "essential",
        personalization: false,
      })),
    })
    expect(await store.update("withdraw")).toEqual({
      state: "essential",
      personalization: false,
    })
    expect(updateViewer).toHaveBeenCalledWith(
      { viewerToken: VIEWER, sessionToken: SESSION },
      "withdraw",
    )
    expect(store.getSnapshot()).toEqual({ personalization: false })
    expect(await store.get()).toMatchObject({
      kind: "ready",
      personalization: false,
    })
  })

  it("update() returns null when no identity is available", async () => {
    const { store, updateViewer } = makeStore({ hasBearer: () => false })
    expect(await store.update("status")).toBeNull()
    expect(updateViewer).not.toHaveBeenCalled()
  })

  it("update() marks the handle suspect on UNAUTHENTICATED and rethrows", async () => {
    const storage = fakeStorage(JSON.stringify(record()))
    const { store, updateViewer, report } = makeStore({
      storage,
      updateViewer: jest.fn(async () => {
        throw new RecommendationClientError("UNAUTHENTICATED")
      }),
    })
    await expect(store.update("reset")).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    })
    expect(storage.items.has(RECOMMENDATION_VIEWER_STORAGE_KEY)).toBe(true)
    expect(report).toHaveBeenCalledWith("handle_rejected", { rec_fresh: false })
    // The next read verifies before it trusts the handle again.
    await store.get()
    expect(updateViewer).toHaveBeenLastCalledWith(
      { viewerToken: VIEWER, sessionToken: SESSION },
      "status",
    )
  })

  it("update() rethrows a transient failure without marking the handle suspect", async () => {
    const storage = fakeStorage(JSON.stringify(record()))
    const { store, updateViewer, report } = makeStore({
      storage,
      updateViewer: jest.fn(async () => {
        throw new RecommendationClientError("SERVICE_UNAVAILABLE")
      }),
    })
    await expect(store.update("reset")).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
    })
    expect(report).not.toHaveBeenCalledWith(
      "handle_rejected",
      expect.anything(),
    )
    // Not suspect: the next read trusts the handle and sends no status probe.
    expect((await store.get()).kind).toBe("ready")
    expect(updateViewer).toHaveBeenCalledTimes(1)
    expect(updateViewer).toHaveBeenCalledWith(
      { viewerToken: VIEWER, sessionToken: SESSION },
      "reset",
    )
  })
})
