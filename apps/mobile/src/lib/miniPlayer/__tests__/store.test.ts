import type { AuthSessionSnapshot } from "../../authSession"
import {
  createMiniPlayerStore,
  getMiniPlayerStore,
  sessionIdentityKey,
  type MiniPlayerEndEvent,
  type MiniPlayerAuthSource,
} from "../store"

function buildAuthSource(initialUserId: string | null = null) {
  let snapshot: AuthSessionSnapshot =
    initialUserId == null
      ? { status: "signedOut", user: null }
      : { status: "signedIn", user: { id: initialUserId } }
  const listeners = new Set<() => void>()
  const source: MiniPlayerAuthSource = {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
  return {
    source,
    setUser(userId: string | null) {
      snapshot =
        userId == null
          ? { status: "signedOut", user: null }
          : { status: "signedIn", user: { id: userId } }
      for (const listener of listeners) listener()
    },
  }
}

function startedStore() {
  const store = createMiniPlayerStore()
  const ends: MiniPlayerEndEvent[] = []
  store.onEnd((event) => ends.push(event))
  store.start({
    videoId: "video-1",
    videoSlug: "birth-of-jesus",
    title: "Birth of Jesus",
    posterUrl: "https://example.test/poster.jpg",
    languageSlug: "english",
    originPattern: "watch/[slug]",
  })
  return { store, ends }
}

describe("start", () => {
  it("publishes a playing session with the identity the window needs", () => {
    const { store } = startedStore()
    const session = store.getSnapshot().session
    expect(session).toMatchObject({
      videoId: "video-1",
      videoSlug: "birth-of-jesus",
      title: "Birth of Jesus",
      languageSlug: "english",
      originPattern: "watch/[slug]",
      phase: "playing",
      endedCause: null,
      positionSeconds: 0,
    })
    expect(store.getSnapshot().dismissal).toBe("none")
  })

  it("ends the previous session as replaced when different content starts", () => {
    const { store, ends } = startedStore()
    store.publishPosition({ positionSeconds: 42, durationSeconds: 600 })
    store.start({
      videoId: "video-2",
      videoSlug: "magdalena",
      title: "Magdalena",
    })

    expect(ends).toHaveLength(1)
    expect(ends[0].reason).toBe("replaced")
    expect(ends[0].session.videoId).toBe("video-1")
    expect(ends[0].session.positionSeconds).toBe(42)
    expect(store.getSnapshot().session).toMatchObject({
      videoId: "video-2",
      positionSeconds: 0,
    })
  })

  it("merges a re-start of the SAME content and keeps the position", () => {
    const { store, ends } = startedStore()
    store.publishPosition({ positionSeconds: 90, durationSeconds: 600 })
    store.start({
      videoId: "video-1",
      videoSlug: "birth-of-jesus",
      title: "Birth of Jesus",
      languageSlug: "spanish",
    })

    expect(ends).toHaveLength(0)
    expect(store.getSnapshot().session).toMatchObject({
      positionSeconds: 90,
      durationSeconds: 600,
      languageSlug: "spanish",
    })
  })

  it("keys identity on the video id, and on the slug for a local file", () => {
    expect(sessionIdentityKey({ videoId: "video-1", videoSlug: "a" })).toBe(
      "id:video-1",
    )
    expect(sessionIdentityKey({ videoId: null, videoSlug: "a" })).toBe("slug:a")
  })

  it("notifies subscribers with a fresh snapshot identity", () => {
    const store = createMiniPlayerStore()
    const listener = jest.fn()
    store.subscribe(listener)
    const before = store.getSnapshot()

    store.start({ videoId: "video-1", videoSlug: "a", title: "A" })

    expect(listener).toHaveBeenCalledTimes(1)
    expect(store.getSnapshot()).not.toBe(before)
  })
})

describe("publishPosition", () => {
  it("carries the poll's position and duration", () => {
    const { store } = startedStore()
    store.publishPosition({ positionSeconds: 12.5, durationSeconds: 300 })
    expect(store.getSnapshot().session).toMatchObject({
      positionSeconds: 12.5,
      durationSeconds: 300,
    })
  })

  it("is inert with no session", () => {
    const store = createMiniPlayerStore()
    const listener = jest.fn()
    store.subscribe(listener)
    store.publishPosition({ positionSeconds: 5 })
    expect(store.getSnapshot().session).toBeNull()
    expect(listener).not.toHaveBeenCalled()
  })
})

describe("ended phase", () => {
  it("closes the quality session as ended and keeps the window mounted", () => {
    const { store, ends } = startedStore()
    store.markEnded("playToEnd")

    expect(store.getSnapshot().session).toMatchObject({
      phase: "ended",
      endedCause: "playToEnd",
    })
    expect(ends).toHaveLength(1)
    expect(ends[0].reason).toBe("ended")
    expect(ends[0].endedCause).toBe("playToEnd")
  })

  it("reports a failure as its own quality reason (R22)", () => {
    const { store, ends } = startedStore()
    store.markEnded("failure")
    expect(ends[0].reason).toBe("failed")
    expect(ends[0].endedCause).toBe("failure")
  })

  it("closes once, however many end signals arrive", () => {
    const { store, ends } = startedStore()
    store.markEnded("playToEnd")
    store.markEnded("failure")
    expect(ends).toHaveLength(1)
    expect(store.getSnapshot().session?.endedCause).toBe("playToEnd")
  })

  it("restarts inside the window on replay (R27)", () => {
    const { store } = startedStore()
    store.publishPosition({ positionSeconds: 300, durationSeconds: 300 })
    store.markEnded("playToEnd")
    store.markPlaying()

    expect(store.getSnapshot().session).toMatchObject({
      phase: "playing",
      endedCause: null,
      positionSeconds: 0,
    })
  })
})

describe("dismissal", () => {
  it("enters exiting, stops the session, and clears only on completion", () => {
    const { store, ends } = startedStore()
    store.requestDismiss()

    expect(store.getSnapshot().dismissal).toBe("exiting")
    expect(store.getSnapshot().session).not.toBeNull()
    expect(ends).toEqual([expect.objectContaining({ reason: "dismissed" })])

    store.reportExitComplete()
    expect(store.getSnapshot().session).toBeNull()
    expect(store.getSnapshot().dismissal).toBe("none")
  })

  it("ignores an exit-completion report that no dismissal armed", () => {
    const { store } = startedStore()
    store.reportExitComplete()
    expect(store.getSnapshot().session).not.toBeNull()
  })

  it("does not close the quality session twice for an ended window (R27)", () => {
    const { store, ends } = startedStore()
    store.markEnded("playToEnd")
    store.requestDismiss()

    expect(store.getSnapshot().dismissal).toBe("exiting")
    expect(ends.map((event) => event.reason)).toEqual(["ended"])
  })

  it("is idempotent", () => {
    const { store, ends } = startedStore()
    store.requestDismiss()
    store.requestDismiss()
    expect(ends).toHaveLength(1)
  })

  it("is inert with no session", () => {
    const store = createMiniPlayerStore()
    store.requestDismiss()
    expect(store.getSnapshot().dismissal).toBe("none")
  })
})

describe("picture-in-picture hold", () => {
  it("defers a dismiss until the hold clears (R24, AE12)", () => {
    const { store, ends } = startedStore()
    store.setPipHold(true)
    store.requestDismiss()

    expect(store.getSnapshot().dismissal).toBe("deferred")
    expect(store.getSnapshot().session).not.toBeNull()
    expect(ends).toHaveLength(0)

    store.setPipHold(false)
    expect(store.getSnapshot().dismissal).toBe("exiting")
    expect(ends).toEqual([expect.objectContaining({ reason: "dismissed" })])
  })

  it("notifies only on a real latch change", () => {
    const { store } = startedStore()
    const listener = jest.fn()
    store.subscribe(listener)
    store.setPipHold(true)
    store.setPipHold(true)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it("survives the session being cleared", () => {
    const { store } = startedStore()
    store.setPipHold(true)
    store.end("abandoned")
    expect(store.getSnapshot().pipHold).toBe(true)
  })
})

describe("explicit end", () => {
  it("clears immediately and reports the reason", () => {
    const { store, ends } = startedStore()
    store.end("abandoned")
    expect(store.getSnapshot().session).toBeNull()
    expect(ends).toEqual([expect.objectContaining({ reason: "abandoned" })])
  })

  it("is inert with no session", () => {
    const store = createMiniPlayerStore()
    const ends: MiniPlayerEndEvent[] = []
    store.onEnd((event) => ends.push(event))
    store.end("abandoned")
    expect(ends).toHaveLength(0)
  })

  it("releases an end listener on unsubscribe", () => {
    const { store } = startedStore()
    const listener = jest.fn()
    const unsubscribe = store.onEnd(listener)
    unsubscribe()
    store.end("abandoned")
    expect(listener).not.toHaveBeenCalled()
  })
})

describe("auth attach (KTD15, R25)", () => {
  it("tags a session with the signed-in subject", () => {
    const auth = buildAuthSource("account-a")
    const store = createMiniPlayerStore()
    store.attachAuthSession(auth.source)
    store.start({ videoId: "video-1", videoSlug: "a", title: "A" })
    expect(store.getSnapshot().session?.accountId).toBe("account-a")
  })

  it("ends the session and clears on sign-out, accepting no later write", () => {
    const auth = buildAuthSource("account-a")
    const store = createMiniPlayerStore()
    const ends: MiniPlayerEndEvent[] = []
    store.onEnd((event) => ends.push(event))
    store.attachAuthSession(auth.source)
    store.start({ videoId: "video-1", videoSlug: "a", title: "A" })
    store.publishPosition({ positionSeconds: 30, durationSeconds: 600 })

    auth.setUser(null)

    expect(store.getSnapshot().session).toBeNull()
    expect(ends).toEqual([
      expect.objectContaining({
        reason: "abandoned",
        session: expect.objectContaining({
          accountId: "account-a",
          positionSeconds: 30,
        }),
      }),
    ])

    // A poll tick still in flight for the signed-out account writes nothing.
    store.publishPosition({ positionSeconds: 45, durationSeconds: 600 })
    expect(store.getSnapshot().session).toBeNull()
    expect(ends).toHaveLength(1)
  })

  it("ends the session on an account switch", () => {
    const auth = buildAuthSource("account-a")
    const store = createMiniPlayerStore()
    const ends: MiniPlayerEndEvent[] = []
    store.onEnd((event) => ends.push(event))
    store.attachAuthSession(auth.source)
    store.start({ videoId: "video-1", videoSlug: "a", title: "A" })

    auth.setUser("account-b")

    expect(store.getSnapshot().session).toBeNull()
    expect(ends).toHaveLength(1)
  })

  it("rejects a write whose session belongs to a previous subject", () => {
    const auth = buildAuthSource("account-a")
    const store = createMiniPlayerStore()
    const detach = store.attachAuthSession(auth.source)
    store.start({ videoId: "video-1", videoSlug: "a", title: "A" })
    // Detached first, so nothing clears the stale session: the write guard is
    // the only thing left standing between account-a's session and account-b.
    detach()
    store.attachAuthSession(buildAuthSource("account-b").source)

    store.publishPosition({ positionSeconds: 30, durationSeconds: 600 })
    expect(store.getSnapshot().session?.positionSeconds).toBe(0)
  })

  it("keeps playing when the same subject's profile changes", () => {
    const auth = buildAuthSource("account-a")
    const store = createMiniPlayerStore()
    const ends: MiniPlayerEndEvent[] = []
    store.onEnd((event) => ends.push(event))
    store.attachAuthSession(auth.source)
    store.start({ videoId: "video-1", videoSlug: "a", title: "A" })

    auth.setUser("account-a")

    expect(store.getSnapshot().session).not.toBeNull()
    expect(ends).toHaveLength(0)
  })

  it("adopts a session started signed-out when the viewer signs in", () => {
    const auth = buildAuthSource(null)
    const store = createMiniPlayerStore()
    const ends: MiniPlayerEndEvent[] = []
    store.onEnd((event) => ends.push(event))
    store.attachAuthSession(auth.source)
    store.start({ videoId: "video-1", videoSlug: "a", title: "A" })
    expect(store.getSnapshot().session?.accountId).toBeNull()

    auth.setUser("account-a")

    expect(ends).toHaveLength(0)
    expect(store.getSnapshot().session?.accountId).toBe("account-a")
    store.publishPosition({ positionSeconds: 10 })
    expect(store.getSnapshot().session?.positionSeconds).toBe(10)
  })

  it("stops listening after detach", () => {
    const auth = buildAuthSource("account-a")
    const store = createMiniPlayerStore()
    const detach = store.attachAuthSession(auth.source)
    store.start({ videoId: "video-1", videoSlug: "a", title: "A" })
    detach()

    auth.setUser(null)
    expect(store.getSnapshot().session).not.toBeNull()
  })
})

describe("module singleton", () => {
  it("returns one store", () => {
    expect(getMiniPlayerStore()).toBe(getMiniPlayerStore())
  })
})
