import {
  createIdentityStore,
  SESSION_IDLE_MS,
  type IdentityDependencies,
} from "./identity"

function fixture(overrides: Partial<IdentityDependencies> = {}) {
  let now = 1000
  const identity = {
    viewerToken: "viewer",
    sessionToken: "session",
    expiresAt: new Date(9999999999999).toISOString(),
    lastActivity: now,
  }
  const deps: IdentityDependencies = {
    read: jest.fn(async () => identity),
    write: jest.fn(async () => {}),
    readChoice: jest.fn(async () => null),
    bootstrap: jest.fn(async () => ({
      ...identity,
      viewerToken: "new-viewer",
    })),
    transition: jest.fn(async () => {}),
    randomToken: () => "rotated-session",
    now: () => now,
    ...overrides,
  }
  return {
    store: createIdentityStore(deps),
    deps,
    advance: (ms: number) => {
      now += ms
    },
  }
}

it("bootstraps once for concurrent callers and persists both tokens", async () => {
  const { store, deps } = fixture({ read: async () => null })
  const [a, b] = await Promise.all([store.get(), store.get()])
  expect(a).toBe(b)
  expect(deps.bootstrap).toHaveBeenCalledTimes(1)
  expect(deps.write).toHaveBeenCalledWith(
    expect.objectContaining({
      viewerToken: "new-viewer",
      sessionToken: "session",
    }),
  )
})
it("reuses an existing installation without account identity", async () => {
  const { store, deps } = fixture()
  expect((await store.get()).viewerToken).toBe("viewer")
  expect(deps.bootstrap).not.toHaveBeenCalled()
})
it("rotates only the session after 24 hours of inactivity and links it", async () => {
  const { store, deps, advance } = fixture()
  await store.get()
  advance(SESSION_IDLE_MS)
  const next = await store.get()
  expect(next).toMatchObject({
    viewerToken: "viewer",
    sessionToken: "rotated-session",
  })
  expect(deps.transition).toHaveBeenCalledWith(next, "status")
})
it("never rotates mid-playback, even after 24 hours", async () => {
  const { store, deps, advance } = fixture()
  await store.get()
  store.beginPlayback()
  advance(SESSION_IDLE_MS * 2)
  expect((await store.get()).sessionToken).toBe("session")
  expect(deps.transition).not.toHaveBeenCalled()
  await store.endPlayback()
  expect((await store.get()).sessionToken).toBe("session")
})
it("replaces expired handles while preserving an off choice before exposure", async () => {
  const expired = {
    viewerToken: "expired",
    sessionToken: "old",
    expiresAt: new Date(0).toISOString(),
    lastActivity: 0,
  }
  const { store, deps } = fixture({
    read: async () => expired,
    readChoice: async () => false,
  })
  const next = await store.get()
  expect(deps.bootstrap).toHaveBeenCalledTimes(1)
  expect(deps.transition).toHaveBeenCalledWith(next, "withdraw")
})
it("rebootstraps a server-rejected handle instead of rereading the lost token", async () => {
  const { store, deps } = fixture()
  await store.get()
  store.forget()
  expect((await store.get()).viewerToken).toBe("new-viewer")
  expect(deps.bootstrap).toHaveBeenCalledTimes(1)
})
it("releases a failed single flight so retry is possible", async () => {
  const { store, deps } = fixture({ read: async () => null })
  const bootstrap = deps.bootstrap as jest.Mock
  bootstrap.mockRejectedValueOnce(new Error("offline"))
  await expect(store.get()).rejects.toThrow("offline")
  await expect(store.get()).resolves.toMatchObject({
    viewerToken: "new-viewer",
  })
})
