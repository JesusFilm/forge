jest.mock("../../../env", () => ({ env: {} }))

import {
  planStreamTransition,
  settleAction,
  type LoadedStream,
  type NextStream,
  type StreamTransition,
} from "../streamTransition"
import type { MuxViewIdentity } from "../viewData"

const OFFLINE_ROOT = "file:///data/Documents/offline-downloads"
const isLocal = (url: string) => url.startsWith(`${OFFLINE_ROOT}/`)

const ENGLISH = "https://stream.mux.com/englishAsset.m3u8"
// A resolved variant names the same asset behind another string.
const ENGLISH_VARIANT =
  "https://stream.mux.com/englishAsset.m3u8?redundant_streams=true"
const ENGLISH_LOW =
  "https://stream.mux.com/englishAsset.m3u8?max_resolution=480p"
const SPANISH = "https://stream.mux.com/spanishAsset.m3u8"
const OTHER_VIDEO = "https://stream.mux.com/otherAsset.m3u8"
const TRAILER = "https://stream.mux.com/trailerAsset.m3u8"
const DOWNLOAD = `${OFFLINE_ROOT}/jesus/video.mp4`

function id(overrides: Partial<MuxViewIdentity> = {}): MuxViewIdentity {
  return { videoId: null, videoSlug: "jesus", title: null, ...overrides }
}

function plan(
  current: LoadedStream | null,
  next: NextStream,
  downloadedPlaysMonitored = true,
): StreamTransition {
  return planStreamTransition({
    current,
    next,
    downloadedPlaysMonitored,
    isLocal,
  })
}

describe("planStreamTransition: first stream", () => {
  it("attaches the first monitored URL in an empty player, with no new view", () => {
    const result = plan(null, { url: ENGLISH, identity: id() })
    expect(result.beforeLoad).toBe("attach")
    expect(result.newViewAtSettle).toBe(false)
    expect(result.loaded).toEqual({ url: ENGLISH, identity: id() })
  })

  it("does nothing for an unmonitored first URL, though it loads", () => {
    const result = plan(null, { url: TRAILER, identity: null })
    expect(result.beforeLoad).toBe("none")
    expect(result.newViewAtSettle).toBe(false)
    expect(result.loads).toBe(true)
  })

  it("does nothing when no URL arrives", () => {
    const result = plan(null, { url: null, identity: id() })
    expect(result.beforeLoad).toBe("none")
    expect(result.newViewAtSettle).toBe(false)
    expect(result.loaded).toBeNull()
  })
})

describe("planStreamTransition: the same stream", () => {
  it("does nothing for a seed URL and a resolved URL with one playback id", () => {
    const current = { url: ENGLISH, identity: id() }
    const result = plan(current, { url: ENGLISH_VARIANT, identity: id() })
    expect(result).toEqual({
      openViewUpdate: null,
      beforeLoad: "none",
      loads: false,
      newViewAtSettle: false,
      loaded: { url: ENGLISH_VARIANT, identity: id() },
    })
  })

  // AE3: the record lands after the seed stream started.
  it("updates the open view with a late documentId for the same slug", () => {
    const current = { url: ENGLISH, identity: id() }
    const late = id({ videoId: "doc-1", title: "Jesus" })
    const result = plan(current, { url: ENGLISH_VARIANT, identity: late })
    expect(result.openViewUpdate).toEqual(late)
    expect(result.beforeLoad).toBe("none")
    expect(result.newViewAtSettle).toBe(false)
    expect(result.loaded?.identity).toEqual(late)
  })

  it("updates the open view when only the data changes", () => {
    const current = { url: ENGLISH, identity: id({ videoId: "doc-1" }) }
    const result = plan(current, {
      url: null,
      identity: id({ videoId: "doc-1", title: "Jesus" }),
    })
    expect(result.openViewUpdate).toEqual(
      id({ videoId: "doc-1", title: "Jesus" }),
    )
    expect(result.newViewAtSettle).toBe(false)
  })

  // KTD6: a remount's first render must not downgrade what the view knows.
  it("never clears a known id or title from the open view", () => {
    const known = id({ videoId: "doc-1", title: "Jesus" })
    const result = plan(
      { url: ENGLISH, identity: known },
      { url: null, identity: id() },
    )
    expect(result.openViewUpdate).toBeNull()
    expect(result.loaded?.identity).toEqual(known)
  })

  it("updates nothing for unchanged data", () => {
    const known = id({ videoId: "doc-1", title: "Jesus" })
    expect(
      plan({ url: ENGLISH, identity: known }, { url: ENGLISH, identity: known })
        .openViewUpdate,
    ).toBeNull()
  })

  it("does nothing when the request loses its option but brings no URL", () => {
    const current = { url: ENGLISH, identity: id({ videoId: "doc-1" }) }
    const result = plan(current, { url: null, identity: null })
    expect(result).toEqual({
      openViewUpdate: null,
      beforeLoad: "none",
      loads: false,
      newViewAtSettle: false,
      loaded: current,
    })
  })
})

describe("planStreamTransition: a new stream", () => {
  // AE2
  it("starts a new view for a dub swap to another asset", () => {
    const current = { url: ENGLISH, identity: id({ videoId: "doc-1" }) }
    const result = plan(current, {
      url: SPANISH,
      identity: id({ videoId: "doc-1" }),
    })
    expect(result.beforeLoad).toBe("stage")
    expect(result.newViewAtSettle).toBe(true)
    expect(result.openViewUpdate).toBeNull()
  })

  it("starts a new view for a quality change on the same asset", () => {
    const current = { url: ENGLISH, identity: id({ videoId: "doc-1" }) }
    const result = plan(current, {
      url: ENGLISH_LOW,
      identity: id({ videoId: "doc-1" }),
    })
    expect(result.beforeLoad).toBe("stage")
    expect(result.newViewAtSettle).toBe(true)
  })

  it("sends a late id to the open view first, then stages it for a dub swap", () => {
    const current = { url: ENGLISH, identity: id() }
    const late = id({ videoId: "doc-1", title: "Jesus" })
    const result = plan(current, { url: SPANISH, identity: late })
    expect(result.openViewUpdate).toEqual(late)
    expect(result.beforeLoad).toBe("stage")
    expect(result.newViewAtSettle).toBe(true)
    expect(result.loaded).toEqual({ url: SPANISH, identity: late })
  })

  it("gives a new video's id to the new view and leaves the open view alone", () => {
    const current = { url: ENGLISH, identity: id({ videoId: "doc-1" }) }
    const next = id({ videoId: "doc-9", videoSlug: "other", title: "Other" })
    const result = plan(current, { url: OTHER_VIDEO, identity: next })
    expect(result.openViewUpdate).toBeNull()
    expect(result.beforeLoad).toBe("stage")
    expect(result.newViewAtSettle).toBe(true)
    expect(result.loaded).toEqual({ url: OTHER_VIDEO, identity: next })
  })

  // A new video's view never inherits the old video's id (R17).
  it("does not merge an old id into a new video that has none yet", () => {
    const current = { url: ENGLISH, identity: id({ videoId: "doc-1" }) }
    const next = id({ videoSlug: "other" })
    expect(
      plan(current, { url: OTHER_VIDEO, identity: next }).loaded?.identity,
    ).toEqual(next)
  })

  it("plans the same staging for every swap, also one that later loses", () => {
    const current = { url: ENGLISH, identity: id({ videoId: "doc-1" }) }
    const first = plan(current, {
      url: SPANISH,
      identity: id({ videoId: "doc-1" }),
    })
    const second = plan(first.loaded, {
      url: ENGLISH_LOW,
      identity: id({ videoId: "doc-1" }),
    })
    expect([first.beforeLoad, second.beforeLoad]).toEqual(["stage", "stage"])
  })

  it("starts a new view for an error reload of the URL without the quality constraint", () => {
    const current = { url: ENGLISH_LOW, identity: id({ videoId: "doc-1" }) }
    const result = plan(current, {
      url: ENGLISH,
      identity: current.identity,
      errorReload: true,
    })
    expect(result.beforeLoad).toBe("stage")
    expect(result.newViewAtSettle).toBe(true)
    expect(result.loaded?.url).toBe(ENGLISH)
  })

  // Same asset and constraint would read as no load without the reload flag.
  it("starts a new view for an error reload of the unchanged URL", () => {
    const current = { url: ENGLISH, identity: id({ videoId: "doc-1" }) }
    const result = plan(current, {
      url: ENGLISH,
      identity: current.identity,
      errorReload: true,
    })
    expect(result.newViewAtSettle).toBe(true)
  })
})

describe("planStreamTransition: downloads", () => {
  const streamed = { url: ENGLISH, identity: id({ videoId: "doc-1" }) }
  const downloaded = { url: DOWNLOAD, identity: id({ videoId: "doc-1" }) }

  it("starts a new view for a stream-to-download swap when downloads are monitored", () => {
    const result = plan(streamed, downloaded, true)
    expect(result.beforeLoad).toBe("stage")
    expect(result.newViewAtSettle).toBe(true)
  })

  it("detaches for a stream-to-download swap when downloads are not monitored", () => {
    const result = plan(streamed, downloaded, false)
    expect(result.beforeLoad).toBe("detach")
    expect(result.newViewAtSettle).toBe(false)
  })

  it("starts a new view for a download-to-stream swap when downloads are monitored", () => {
    const result = plan(downloaded, streamed, true)
    expect(result.beforeLoad).toBe("stage")
    expect(result.newViewAtSettle).toBe(true)
  })

  it("attaches for a download-to-stream swap when downloads are not monitored", () => {
    const result = plan(downloaded, streamed, false)
    expect(result.beforeLoad).toBe("attach")
    expect(result.newViewAtSettle).toBe(false)
  })

  it("does not attach to a first download when downloads are not monitored", () => {
    expect(plan(null, downloaded, false).beforeLoad).toBe("none")
  })
})

describe("planStreamTransition: unmonitored streams", () => {
  it("detaches before an unmonitored URL loads (the series trailer)", () => {
    const current = { url: ENGLISH, identity: id({ videoId: "doc-1" }) }
    const result = plan(current, { url: TRAILER, identity: null })
    expect(result.beforeLoad).toBe("detach")
    expect(result.newViewAtSettle).toBe(false)
    expect(result.loaded).toEqual({ url: TRAILER, identity: null })
  })

  it("attaches before a monitored URL that follows the trailer loads", () => {
    const current = { url: TRAILER, identity: null }
    const episode = id({ videoId: "doc-3", videoSlug: "episode-1" })
    const result = plan(current, { url: OTHER_VIDEO, identity: episode })
    expect(result.beforeLoad).toBe("attach")
    expect(result.newViewAtSettle).toBe(false)
    expect(result.loaded).toEqual({ url: OTHER_VIDEO, identity: episode })
  })
})

describe("planStreamTransition: the Experience routes", () => {
  // The routes have no slug, so the id names the video.
  const block = (videoId: string, title: string | null = null) =>
    ({ videoId, videoSlug: null, title }) satisfies MuxViewIdentity

  it("updates the open view with a record title that loads late", () => {
    const result = plan(
      { url: ENGLISH, identity: block("doc-1") },
      { url: null, identity: block("doc-1", "Jesus") },
    )
    expect(result.openViewUpdate).toEqual(block("doc-1", "Jesus"))
  })

  it("starts a new view with the next item's data for a pager move", () => {
    const result = plan(
      { url: ENGLISH, identity: block("doc-1", "Jesus") },
      { url: OTHER_VIDEO, identity: block("doc-2", "Other") },
    )
    expect(result.openViewUpdate).toBeNull()
    expect(result.newViewAtSettle).toBe(true)
    expect(result.loaded?.identity).toEqual(block("doc-2", "Other"))
  })
})

describe("settleAction", () => {
  const swap = plan(
    { url: ENGLISH, identity: id({ videoId: "doc-1" }) },
    { url: SPANISH, identity: id({ videoId: "doc-1" }) },
  )

  it("starts the new view when the swap is still the latest", () => {
    expect(settleAction(swap, { token: 3, latestToken: 3 })).toBe("newView")
  })

  it("starts no new view when a newer swap superseded this one", () => {
    expect(settleAction(swap, { token: 2, latestToken: 3 })).toBe("none")
  })

  it("starts no new view for a transition that plans none", () => {
    const attach = plan(null, { url: ENGLISH, identity: id() })
    expect(settleAction(attach, { token: 1, latestToken: 1 })).toBe("none")
  })
})
