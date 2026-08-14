/**
 * The production wiring of the mini player singletons.
 *
 * Every other module under `src/lib/miniPlayer/` is a factory somebody else
 * injects, so `index.ts` is where the app's real deps are chosen — and it had
 * no coverage at all: a reviewer deleted the `onEnd` line and the whole suite
 * stayed green. This suite exercises the REAL `index.ts`; only the auth
 * transport is faked, so `currentSubjectId`, the `subscribeToSubject` adapter,
 * the `onEnd` wire and both lazy getters all run for real.
 */

/* eslint-disable @typescript-eslint/no-require-imports */

// A REAL auth store (the actual factory) over a fake transport: the subscribe
// and snapshot semantics under test are the production ones, and a test can
// still drive who is signed in.
jest.mock("../../authSession", () => {
  const actual =
    jest.requireActual<typeof import("../../authSession")>("../../authSession")
  let user: { id: string; name?: string } | null = null
  const store = actual.createAuthSessionStore({
    fetchSession: async () => user,
    fetchToken: async () => null,
    signOutRemote: async () => {},
  })
  return {
    ...actual,
    getAuthSession: jest.fn(() => store),
    __setUser: (next: { id: string; name?: string } | null) => {
      user = next
    },
  }
})

import type { SessionEndReason } from "../types"

type FakeAuth = typeof import("../../authSession") & {
  getAuthSession: jest.Mock
  __setUser: (next: { id: string; name?: string } | null) => void
}

const STREAM = "https://stream.test/one.m3u8"

/** Fresh module registry per test: index.ts memoizes its singletons. */
function loadModules() {
  jest.resetModules()
  const auth = require("../../authSession") as FakeAuth
  const miniPlayer = require("../index") as typeof import("../index")
  return { auth, miniPlayer }
}

/** Register a listener and collect the reasons it is called with. */
function collectEnds(miniPlayer: typeof import("../index")) {
  const reasons: SessionEndReason[] = []
  const release = miniPlayer.registerSessionEnd((reason) =>
    reasons.push(reason),
  )
  return { reasons, release }
}

describe("the onEnd wire", () => {
  it("routes a store-driven end to the registered listener", async () => {
    // The one line a reviewer deleted with the whole suite staying green.
    // Without it every store end skips the live player's endSession, and React
    // teardown files the session as "abandoned" under an "unmount" flush.
    const { miniPlayer } = loadModules()
    const { reasons } = collectEnds(miniPlayer)
    const store = miniPlayer.getMiniPlayerStore()

    store.start({ videoId: "video-1", streamingUrl: STREAM })
    store.end("dismissed")

    expect(reasons).toEqual(["dismissed"])
  })

  it("routes a replace, which never surfaces as a store `end` call", async () => {
    // start() ends the previous session silently. Only the onEnd wire can
    // carry "replaced" to the player, so a caller cannot compensate for it.
    const { miniPlayer } = loadModules()
    const { reasons } = collectEnds(miniPlayer)
    const store = miniPlayer.getMiniPlayerStore()

    store.start({ videoId: "video-1", streamingUrl: STREAM })
    store.start({ videoId: "video-2", streamingUrl: STREAM })

    expect(reasons).toEqual(["replaced"])
  })

  it("stops calling a released listener", async () => {
    const { miniPlayer } = loadModules()
    const { reasons, release } = collectEnds(miniPlayer)
    const store = miniPlayer.getMiniPlayerStore()
    store.start({ videoId: "video-1", streamingUrl: STREAM })

    release()
    store.end("dismissed")

    expect(reasons).toEqual([])
  })
})

describe("the auth subject wire", () => {
  async function signedInStore(auth: FakeAuth, id: string) {
    auth.__setUser({ id })
    await auth.getAuthSession().refresh()
  }

  it("keeps the session when auth notifies with the SAME subject", async () => {
    // A version of subscribeToSubject that forgot to read the CURRENT subject
    // — `listener(null)`, or a captured value — would end a live session on
    // every auth notification, including a plain profile edit.
    const { auth, miniPlayer } = loadModules()
    await signedInStore(auth, "user-1")
    const { reasons } = collectEnds(miniPlayer)
    const store = miniPlayer.getMiniPlayerStore()
    store.start({ videoId: "video-1", streamingUrl: STREAM })

    auth.__setUser({ id: "user-1", name: "Renamed" })
    await auth.getAuthSession().refresh()

    expect(store.getSnapshot()).not.toBeNull()
    expect(reasons).toEqual([])
  })

  it("ends the session when the subject actually changes", async () => {
    // The anti-vacuous companion: without it, a currentSubjectId hardwired to
    // null would satisfy the same-subject case above by never reporting a
    // change at all.
    const { auth, miniPlayer } = loadModules()
    await signedInStore(auth, "user-1")
    const { reasons } = collectEnds(miniPlayer)
    const store = miniPlayer.getMiniPlayerStore()
    store.start({ videoId: "video-1", streamingUrl: STREAM })

    auth.__setUser({ id: "user-2" })
    await auth.getAuthSession().refresh()

    expect(store.getSnapshot()).toBeNull()
    expect(reasons).toEqual(["signout"])
  })

  it("reads the signed-out subject as null and adopts the session on sign-in", async () => {
    // currentSubjectId's other branch. This case PINNED THE OPPOSITE until an
    // adversarial review: it asserted that signing in ends the session, which
    // stops playback exactly when the viewer acts to keep their place.
    const { auth, miniPlayer } = loadModules()
    const { reasons } = collectEnds(miniPlayer)
    const store = miniPlayer.getMiniPlayerStore()
    store.start({ videoId: "video-1", streamingUrl: STREAM })
    expect(store.getSnapshot()?.subjectId).toBeNull()

    await signedInStore(auth, "user-1")

    expect(store.getSnapshot()?.subjectId).toBe("user-1")
    expect(reasons).toEqual([])
  })

  it("stamps the signed-in subject on a session it starts", async () => {
    const { auth, miniPlayer } = loadModules()
    await signedInStore(auth, "user-1")
    const store = miniPlayer.getMiniPlayerStore()

    store.start({ videoId: "video-1", streamingUrl: STREAM })

    expect(store.getSnapshot()?.subjectId).toBe("user-1")
  })
})

describe("the lazy getters", () => {
  it("builds nothing until the store getter is called", () => {
    // The apolloClient convention: module-scope construction would subscribe
    // to auth before the app decided it needed a player at all.
    const { auth, miniPlayer } = loadModules()

    expect(auth.getAuthSession).not.toHaveBeenCalled()
    miniPlayer.getMiniPlayerStore()
    expect(auth.getAuthSession).toHaveBeenCalled()
  })

  it("returns the same store twice", () => {
    const { miniPlayer } = loadModules()

    expect(miniPlayer.getMiniPlayerStore()).toBe(
      miniPlayer.getMiniPlayerStore(),
    )
  })

  it("returns the same sheet counter twice", () => {
    // A second counter would have its own count, so the presentation selector
    // would read zero while a sheet the other counter knows about is open.
    const { miniPlayer } = loadModules()
    const sheets = miniPlayer.getMiniPlayerSheets()

    sheets.openSheet()

    expect(miniPlayer.getMiniPlayerSheets()).toBe(sheets)
    expect(miniPlayer.getMiniPlayerSheets().getCount()).toBe(1)
  })
})
