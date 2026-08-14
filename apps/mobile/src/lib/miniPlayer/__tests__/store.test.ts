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

  it("ignores a republish of the same video from the same source", () => {
    // The host keys its player on the identity alone, so this republish
    // re-renders nothing. Replacing would end the LIVE player's session and
    // leave it running with no quality record and no forced progress write.
    const { store, ends } = build()
    store.start(VIDEO_ONE)
    store.updateProgress(120, 600)
    const listener = jest.fn()
    store.subscribe(listener)

    store.start(VIDEO_ONE)

    expect(ends).toEqual([])
    expect(listener).not.toHaveBeenCalled()
    expect(store.getSnapshot()).toMatchObject({ positionSeconds: 120 })
  })

  it("still replaces when the same identity arrives with a new source", () => {
    // The anti-vacuous companion for the URL half of the no-op guard: a bare
    // identity compare would swallow this too.
    const { store, ends } = build()
    store.start(VIDEO_ONE)

    store.start({ ...VIDEO_ONE, streamingUrl: "https://stream.test/hd.m3u8" })

    expect(ends.map((e) => e.reason)).toEqual(["replaced"])
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

  it("re-points the source in place without ending the session", () => {
    // The downloads manifest hydrates a file:// copy mid-session. A start()
    // here would file a bogus `replaced` and send the position back to zero.
    const { store, ends } = build()
    store.start({ ...VIDEO_ONE, durationSeconds: 600 })
    store.updateProgress(120)

    store.update({ ...VIDEO_ONE, streamingUrl: "file:///offline/one.m3u8" })

    expect(ends).toEqual([])
    expect(store.getSnapshot()).toMatchObject({
      streamingUrl: "file:///offline/one.m3u8",
      positionSeconds: 120,
      durationSeconds: 600,
      subjectId: "subject-a",
    })
  })

  it("publishes an update so the window redraws", () => {
    const { store } = build()
    store.start(VIDEO_ONE)
    const listener = jest.fn()
    store.subscribe(listener)

    store.update({ ...VIDEO_ONE, languageSlug: "spanish" })

    expect(listener).toHaveBeenCalledTimes(1)
    expect(store.getSnapshot()).toMatchObject({ languageSlug: "spanish" })
  })

  it("does not publish an update that changes nothing", () => {
    // A publisher that reads the snapshot and calls update() from the same
    // effect would loop if every call produced a fresh snapshot object.
    const { store } = build()
    store.start(VIDEO_ONE)
    const listener = jest.fn()
    store.subscribe(listener)

    store.update(VIDEO_ONE)

    expect(listener).not.toHaveBeenCalled()
  })

  it("keeps a known duration when the update omits one", () => {
    const { store } = build()
    store.start({ ...VIDEO_ONE, durationSeconds: 600 })

    store.update({ ...VIDEO_ONE, streamingUrl: "file:///offline/one.m3u8" })

    expect(store.getSnapshot()).toMatchObject({ durationSeconds: 600 })
  })

  it("keeps known fields when the update names them as undefined", () => {
    // The whole point, and the reason this looks like the case above: the
    // publisher builds ONE input object per render, so an unresolved poster
    // arrives as an EXPLICIT undefined, which a plain spread copies over.
    const { store } = build()
    store.start({
      ...VIDEO_ONE,
      posterUrl: "https://images.test/one.jpg",
      title: "Birth of Jesus",
      languageSlug: "english",
    })

    store.update({
      ...VIDEO_ONE,
      streamingUrl: "file:///offline/one.m3u8",
      posterUrl: undefined,
      title: undefined,
      languageSlug: undefined,
    })

    expect(store.getSnapshot()).toMatchObject({
      streamingUrl: "file:///offline/one.m3u8",
      posterUrl: "https://images.test/one.jpg",
      title: "Birth of Jesus",
      languageSlug: "english",
    })
  })

  it("still replaces a field the update names with a NEW value", () => {
    // The anti-vacuous companion: an update that merged nothing at all would
    // satisfy the case above by never writing a field.
    const { store } = build()
    store.start({ ...VIDEO_ONE, posterUrl: "https://images.test/one.jpg" })

    store.update({ ...VIDEO_ONE, posterUrl: "https://images.test/two.jpg" })

    expect(store.getSnapshot()).toMatchObject({
      posterUrl: "https://images.test/two.jpg",
    })
  })

  it("clears a field the update names as null", () => {
    // null is a VALUE, not an omission — "this video has no poster" must land.
    const { store } = build()
    store.start({ ...VIDEO_ONE, posterUrl: "https://images.test/one.jpg" })

    store.update({ ...VIDEO_ONE, posterUrl: null })

    expect(store.getSnapshot()).toMatchObject({ posterUrl: null })
  })

  it("ignores an update naming a different video", () => {
    // Merging it would hand video-2 video-1's position and owner under a verb
    // that promises to touch neither.
    const { store } = build()
    store.start(VIDEO_ONE)

    store.update(VIDEO_TWO)

    expect(store.getSnapshot()).toMatchObject({ videoId: "video-1" })
  })

  it("ignores an update when no session is live", () => {
    const { store } = build()
    const listener = jest.fn()
    store.subscribe(listener)

    store.update(VIDEO_ONE)

    expect(store.getSnapshot()).toBeNull()
    expect(listener).not.toHaveBeenCalled()
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
