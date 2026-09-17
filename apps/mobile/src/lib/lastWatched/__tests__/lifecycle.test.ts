/**
 * The playback → record writer (KTD5). Every case drives a REAL playback
 * request store, so the "watch screen only" rule is proved against the same
 * admission the app runs, not against a hand-shaped snapshot.
 */

import {
  createPlaybackRequestStore,
  type PlaybackRequest,
  type PlaybackSessionDescriptor,
} from "../../miniPlayer/playbackRequest"
import { createMiniPlayerStore } from "../../miniPlayer/store"
import { attachLastWatchedWriter } from "../lifecycle"

const SESSION_STREAMING: PlaybackSessionDescriptor = {
  videoId: "video-a",
  videoSlug: "the-birth-of-jesus",
  title: "The Birth of Jesus",
  posterUrl: null,
  languageSlug: "english",
  originPattern: "watch/[slug]",
}

// Downloaded playback has no admin id on device — the slug is its only key
// (AE5, KTD8).
const SESSION_DOWNLOADED: PlaybackSessionDescriptor = {
  ...SESSION_STREAMING,
  videoId: null,
  videoSlug: "washi-gospel-episode-2",
  title: "Washi Gospel, Episode 2",
  languageSlug: null,
}

function makeRequest(
  overrides: Partial<PlaybackRequest> = {},
): PlaybackRequest {
  return {
    streamingUrl: "https://stream.mux.com/assetAAA111.m3u8",
    posterUrl: null,
    subtitleVttSrc: null,
    fullscreen: false,
    autostart: true,
    resumeAtSeconds: null,
    progressVideoId: null,
    progressVideoSlug: null,
    progressLanguageSlug: null,
    onToggleFullscreen: null,
    castActive: false,
    cast: null,
    progressFeedRef: null,
    session: SESSION_STREAMING,
    ...overrides,
  }
}

function attachTo(store: ReturnType<typeof createPlaybackRequestStore>) {
  const write = jest.fn()
  const detach = attachLastWatchedWriter({
    subscribe: store.subscribe,
    getSnapshot: store.getSnapshot,
    write,
  })
  return { write, detach }
}

function makeStore() {
  return createPlaybackRequestStore({ sessionStore: createMiniPlayerStore() })
}

describe("attachLastWatchedWriter", () => {
  it("writes the slug of a downloaded episode once it plays (AE5)", () => {
    const store = makeStore()
    const { write } = attachTo(store)

    store.attachSlot(makeRequest({ session: SESSION_DOWNLOADED }))
    store.setPlaying(true)

    expect(write).toHaveBeenCalledTimes(1)
    expect(write).toHaveBeenCalledWith(
      "washi-gospel-episode-2",
      "Washi Gospel, Episode 2",
    )
  })

  it("writes nothing while playback has not started", () => {
    const store = makeStore()
    const { write } = attachTo(store)

    store.attachSlot(makeRequest())

    expect(write).not.toHaveBeenCalled()
  })

  it("writes nothing for a surface with no session (the series trailer)", () => {
    const store = makeStore()
    const { write } = attachTo(store)

    store.attachSlot(makeRequest({ session: null }))
    store.setPlaying(true)

    expect(write).not.toHaveBeenCalled()
  })

  it("does NOT re-record the same video after a sign-out clears the record", () => {
    // AE9, and a deliberate consequence of the writer keeping its own latch.
    // A sign-out does not stop playback, so the signed-out person can keep
    // watching. Re-recording here would put the previous account's video back
    // into the reminders the clear just pointed at Home, which is the shared-
    // device case the Key Decision exists for. Do NOT "fix" this by giving the
    // writer a clear seam, or by deduping against the store's own record.
    const store = makeStore()
    const { write } = attachTo(store)

    store.attachSlot(makeRequest({ session: SESSION_STREAMING }))
    store.setPlaying(true)
    expect(write).toHaveBeenCalledTimes(1)
    write.mockClear()

    // The record store is cleared; the writer is not told, by design.
    store.setPlaying(false)
    store.setPlaying(true)

    expect(write).not.toHaveBeenCalled()
  })

  it("still records a DIFFERENT video after a clear", () => {
    // The latch bounds only the video that was already recorded. A new title
    // the signed-out person starts is theirs, and the record follows it.
    const store = makeStore()
    const { write } = attachTo(store)

    store.attachSlot(makeRequest({ session: SESSION_STREAMING }))
    store.setPlaying(true)
    write.mockClear()

    store.attachSlot(makeRequest({ session: SESSION_DOWNLOADED }))

    expect(write).toHaveBeenCalledWith(
      "washi-gospel-episode-2",
      "Washi Gospel, Episode 2",
    )
  })

  it("writes once while the playing slug does not change", () => {
    const store = makeStore()
    const { write } = attachTo(store)
    const slotId = store.attachSlot(makeRequest())

    store.setPlaying(true)
    store.setSlotRect(slotId, { x: 0, y: 0, width: 390, height: 219 })
    store.updateSlot(slotId, makeRequest({ fullscreen: true }))

    expect(write).toHaveBeenCalledTimes(1)
    expect(write).toHaveBeenCalledWith(
      "the-birth-of-jesus",
      "The Birth of Jesus",
    )
  })

  it("writes the new slug on an Up Next swap that keeps playing", () => {
    const store = makeStore()
    const { write } = attachTo(store)
    const slotId = store.attachSlot(makeRequest())
    store.setPlaying(true)

    store.updateSlot(slotId, makeRequest({ session: SESSION_DOWNLOADED }))

    expect(write.mock.calls).toEqual([
      ["the-birth-of-jesus", "The Birth of Jesus"],
      ["washi-gospel-episode-2", "Washi Gospel, Episode 2"],
    ])
  })

  it("does not re-write the same video after a pause and a resume", () => {
    const store = makeStore()
    const { write } = attachTo(store)
    store.attachSlot(makeRequest())

    store.setPlaying(true)
    store.setPlaying(false)
    store.setPlaying(true)

    expect(write).toHaveBeenCalledTimes(1)
  })

  it("writes again when the viewer returns to an earlier video", () => {
    const store = makeStore()
    const { write } = attachTo(store)
    const slotId = store.attachSlot(makeRequest())
    store.setPlaying(true)

    store.updateSlot(slotId, makeRequest({ session: SESSION_DOWNLOADED }))
    store.updateSlot(slotId, makeRequest({ session: SESSION_STREAMING }))

    expect(write.mock.calls).toEqual([
      ["the-birth-of-jesus", "The Birth of Jesus"],
      ["washi-gospel-episode-2", "Washi Gospel, Episode 2"],
      ["the-birth-of-jesus", "The Birth of Jesus"],
    ])
  })

  it("writes at attach time when a video is already playing", () => {
    const store = makeStore()
    store.attachSlot(makeRequest())
    store.setPlaying(true)

    const { write } = attachTo(store)

    expect(write).toHaveBeenCalledWith(
      "the-birth-of-jesus",
      "The Birth of Jesus",
    )
  })

  it("writes nothing once detached", () => {
    const store = makeStore()
    const { write, detach } = attachTo(store)

    detach()
    store.attachSlot(makeRequest())
    store.setPlaying(true)

    expect(write).not.toHaveBeenCalled()
  })

  it("writes nothing when the playing request has gone (a popped screen)", () => {
    const write = jest.fn()
    attachLastWatchedWriter({
      subscribe: () => () => {},
      getSnapshot: () => ({
        request: null,
        rect: null,
        slotId: null,
        loadFailed: false,
        playing: true,
      }),
      write,
    })

    expect(write).not.toHaveBeenCalled()
  })
})
