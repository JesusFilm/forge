import {
  createMiniPlayerStore,
  type MiniPlayerSession,
  type SessionEndReason,
} from "../store"

const VIDEO_ONE = {
  videoId: "video-1",
  videoSlug: "birth-of-jesus",
  streamingUrl: "https://stream.test/one.m3u8",
}
const VIDEO_TWO = {
  videoId: "video-2",
  videoSlug: "the-last-supper",
  streamingUrl: "https://stream.test/two.m3u8",
}

/** A controllable stand-in for the auth session, which is readable without React. */
function fakeAuth(initial: string | null = "subject-a") {
  let subjectId = initial
  const listeners = new Set<(next: string | null) => void>()
  return {
    getSubjectId: () => subjectId,
    subscribeToSubject: (listener: (next: string | null) => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    signInAs(next: string | null) {
      subjectId = next
      for (const listener of [...listeners]) listener(next)
    },
  }
}

function build(initialSubject: string | null = "subject-a") {
  const auth = fakeAuth(initialSubject)
  const ends: { session: MiniPlayerSession; reason: SessionEndReason }[] = []
  const store = createMiniPlayerStore({
    getSubjectId: auth.getSubjectId,
    subscribeToSubject: auth.subscribeToSubject,
    onEnd: (session, reason) => ends.push({ session, reason }),
  })
  return { auth, store, ends }
}

describe("createMiniPlayerStore", () => {
  it("publishes a started session stamped with the current subject", () => {
    const { store } = build()
    store.start(VIDEO_ONE)
    expect(store.getSnapshot()).toMatchObject({
      videoId: "video-1",
      positionSeconds: 0,
      subjectId: "subject-a",
    })
  })

  it("returns a referentially stable snapshot while nothing changes", () => {
    // Not a performance note: useSyncExternalStore compares by identity, so a
    // fresh object per call is an infinite render loop.
    const { store } = build()
    store.start(VIDEO_ONE)
    expect(store.getSnapshot()).toBe(store.getSnapshot())
  })

  it("notifies subscribers on start, progress and end", () => {
    const { store } = build()
    const listener = jest.fn()
    store.subscribe(listener)

    store.start(VIDEO_ONE)
    store.updateProgress(12, 100)
    store.end("dismissed")

    expect(listener).toHaveBeenCalledTimes(3)
    expect(store.getSnapshot()).toBeNull()
  })

  it("stops notifying after unsubscribe", () => {
    const { store } = build()
    const listener = jest.fn()
    store.subscribe(listener)()
    store.start(VIDEO_ONE)
    expect(listener).not.toHaveBeenCalled()
  })

  it("replaces the playing video and reports the old one as replaced (R12)", () => {
    const { store, ends } = build()
    store.start(VIDEO_ONE)

    store.start(VIDEO_TWO)

    expect(store.getSnapshot()).toMatchObject({ videoId: "video-2" })
    expect(ends).toHaveLength(1)
    expect(ends[0].reason).toBe("replaced")
    expect(ends[0].session.videoId).toBe("video-1")
  })

  it("publishes exactly one change for a replace", () => {
    // A replace that ended and then started would publish a null frame in
    // between, which the window renders for one tick as a dismissal.
    const { store } = build()
    store.start(VIDEO_ONE)
    const seen: (string | undefined)[] = []
    store.subscribe(() => seen.push(store.getSnapshot()?.videoId))

    store.start(VIDEO_TWO)

    expect(seen).toEqual(["video-2"])
  })

  it("carries the end reason to the host", () => {
    for (const reason of ["dismissed", "ended", "failed"] as const) {
      const { store, ends } = build()
      store.start(VIDEO_ONE)
      store.end(reason)
      expect(ends.map((e) => e.reason)).toEqual([reason])
    }
  })

  it("ends the session and clears the store on a subject change (R25)", () => {
    const { auth, store, ends } = build("subject-a")
    store.start(VIDEO_ONE)

    auth.signInAs("subject-b")

    expect(store.getSnapshot()).toBeNull()
    expect(ends).toEqual([expect.objectContaining({ reason: "signout" })])
  })

  it("ends the session on sign-out to no subject", () => {
    const { auth, store, ends } = build("subject-a")
    store.start(VIDEO_ONE)

    auth.signInAs(null)

    expect(store.getSnapshot()).toBeNull()
    expect(ends[0].reason).toBe("signout")
  })

  it("adopts a signed-out session when the viewer signs IN", () => {
    // Two reachable paths end here: the app's own "sign in to save your place"
    // prompt, and cold launch, where auth starts signed out and only commits a
    // user after an async refresh. Ending is the opposite of what both mean.
    const { auth, store, ends } = build(null)
    store.start(VIDEO_ONE)

    auth.signInAs("subject-a")

    expect(store.getSnapshot()).toMatchObject({
      videoId: "video-1",
      subjectId: "subject-a",
    })
    expect(ends).toEqual([])
  })

  it("publishes the adoption so a subscriber sees the new owner", () => {
    const { auth, store } = build(null)
    store.start(VIDEO_ONE)
    const seen: (string | null | undefined)[] = []
    store.subscribe(() => seen.push(store.getSnapshot()?.subjectId))

    auth.signInAs("subject-a")

    expect(seen).toEqual(["subject-a"])
  })

  it("still ends when an ADOPTED session's account then switches", () => {
    // The adoption must not make the session permanently immune: once it has
    // an owner, the R25 rule applies to it like any other.
    const { auth, store, ends } = build(null)
    store.start(VIDEO_ONE)
    auth.signInAs("subject-a")

    auth.signInAs("subject-b")

    expect(store.getSnapshot()).toBeNull()
    expect(ends).toHaveLength(1)
    expect(ends[0].reason).toBe("signout")
    // The owner it ends UNDER proves the adoption happened first — without it
    // this case passes on a store that ended the session back at sign-in.
    expect(ends[0].session.subjectId).toBe("subject-a")
  })

  it("accepts no write for the previous subject after the change (R25)", () => {
    const { auth, store } = build("subject-a")
    store.start(VIDEO_ONE)
    auth.signInAs("subject-b")

    // An in-flight 1s poll from the previous session lands here.
    store.updateProgress(90, 100)

    expect(store.getSnapshot()).toBeNull()
  })

  it("stamps the new subject on a session started after the change", () => {
    const { auth, store } = build("subject-a")
    auth.signInAs("subject-b")

    store.start(VIDEO_ONE)

    expect(store.getSnapshot()?.subjectId).toBe("subject-b")
  })

  it("does not end a session when the subject notification repeats the same id", () => {
    // Auth clients re-emit on refresh. Ending there would kill playback on a
    // token renewal.
    const { auth, store, ends } = build("subject-a")
    store.start(VIDEO_ONE)

    auth.signInAs("subject-a")

    expect(store.getSnapshot()).toMatchObject({ videoId: "video-1" })
    expect(ends).toEqual([])
  })

  it("updates position without losing a known duration", () => {
    const { store } = build()
    store.start({ ...VIDEO_ONE, durationSeconds: 100 })
    store.updateProgress(42)
    expect(store.getSnapshot()).toMatchObject({
      positionSeconds: 42,
      durationSeconds: 100,
    })
  })

  it("ignores end and progress when there is no session", () => {
    const { store, ends } = build()
    const listener = jest.fn()
    store.subscribe(listener)

    store.end("dismissed")
    store.updateProgress(10, 100)

    expect(ends).toEqual([])
    expect(listener).not.toHaveBeenCalled()
  })
})
