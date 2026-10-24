jest.mock("../../../env", () => ({ env: {} }))

import { buildMuxViewData, type MuxViewIdentity } from "../viewData"

const STREAM = "https://stream.mux.com/abc123.m3u8"
const OFFLINE_ROOT =
  "file:///var/mobile/Containers/Data/Application/0A1B2C3D-0000-4000-8000-1234567890AB/Documents/offline-downloads"
const DOWNLOAD = `${OFFLINE_ROOT}/jesus/video.mp4`
const VIEWER = "5f0b6c1e-8d2a-4c3b-9e4f-0a1b2c3d4e5f"

// Every key the data map allows (KTD6, KTD7). The builder may omit a key, but
// it may never add one.
const MAPPED_KEYS = [
  "video_id",
  "video_title",
  "player_name",
  "viewer_user_id",
  "custom_1",
  "custom_2",
  "video_source_url",
]

function identity(overrides: Partial<MuxViewIdentity> = {}): MuxViewIdentity {
  return { videoId: null, videoSlug: null, title: null, ...overrides }
}

function watchView(
  id: MuxViewIdentity,
  stream = { url: STREAM, downloaded: false },
) {
  return buildMuxViewData({
    surface: "watch",
    identity: id,
    streamUrl: stream.url,
    downloaded: stream.downloaded,
    viewerId: VIEWER,
    seesNativeControlSeeks: true,
  })
}

function experienceView(
  id: MuxViewIdentity,
  options: { seesNativeControlSeeks: boolean } = {
    seesNativeControlSeeks: true,
  },
) {
  return buildMuxViewData({
    surface: "experience",
    identity: id,
    streamUrl: STREAM,
    downloaded: false,
    viewerId: VIEWER,
    seesNativeControlSeeks: options.seesNativeControlSeeks,
  })
}

describe("buildMuxViewData: the watch page (root player)", () => {
  // AE3: the seed path plays before the record resolves.
  it("carries no title until the record resolves", () => {
    const view = watchView(identity({ videoSlug: "jesus" }))
    expect(view).not.toHaveProperty("video_title")
  })

  it("carries the held record title once it resolves", () => {
    const view = watchView(
      identity({ videoId: "doc-1", videoSlug: "jesus", title: "Jesus" }),
    )
    expect(view.video_title).toBe("Jesus")
    expect(view.video_id).toBe("doc-1")
  })

  it("carries the full streamed shape", () => {
    expect(
      watchView(
        identity({ videoId: "doc-1", videoSlug: "jesus", title: "Jesus" }),
      ),
    ).toEqual({
      video_id: "doc-1",
      video_title: "Jesus",
      player_name: "forge-mobile-watch",
      viewer_user_id: VIEWER,
      custom_1: "streamed",
      custom_2: "jesus",
      video_source_url: STREAM,
    })
  })

  // AE10, R17: the slug identifies a view whose documentId never arrives.
  it("names an offline download with no record by slug and marker only", () => {
    const view = watchView(identity({ videoSlug: "jesus" }), {
      url: DOWNLOAD,
      downloaded: true,
    })
    expect(view).not.toHaveProperty("video_id")
    expect(view.custom_2).toBe("jesus")
    expect(view.custom_1).toBe("downloaded")
  })

  it("marks a streamed view as streamed", () => {
    expect(watchView(identity({ videoSlug: "jesus" })).custom_1).toBe(
      "streamed",
    )
  })

  // R20: a download path includes the iOS container id.
  it("puts no local path in any field of a downloaded view", () => {
    const view = watchView(
      identity({ videoId: "doc-1", videoSlug: "jesus", title: "Jesus" }),
      { url: DOWNLOAD, downloaded: true },
    )
    const serialized = JSON.stringify(view)
    expect(serialized).not.toContain("file://")
    expect(serialized).not.toContain(OFFLINE_ROOT)
    expect(serialized).not.toContain("0A1B2C3D-0000-4000-8000-1234567890AB")
    expect(view).not.toHaveProperty("video_source_url")
  })

  // A file URL that misses the offline root is still a local path.
  it("never sends a file URL as the source, even when not marked downloaded", () => {
    const view = watchView(identity({ videoSlug: "jesus" }), {
      url: "file:///private/var/tmp/clip.mp4",
      downloaded: false,
    })
    expect(view).not.toHaveProperty("video_source_url")
  })

  it("leaves out an empty id or title rather than sending a placeholder", () => {
    const view = watchView(
      identity({ videoId: "", videoSlug: "jesus", title: "" }),
    )
    expect(view).not.toHaveProperty("video_id")
    expect(view).not.toHaveProperty("video_title")
  })
})

describe("buildMuxViewData: the Experience routes", () => {
  it("has no title before the record title loads", () => {
    expect(experienceView(identity({ videoId: "doc-2" }))).not.toHaveProperty(
      "video_title",
    )
  })

  it("carries the record title once it loads", () => {
    expect(
      experienceView(identity({ videoId: "doc-2", title: "The Story" }))
        .video_title,
    ).toBe("The Story")
  })

  // KTD7: a route's player never carries a slug, also one from another surface.
  it("never sets the slug field, even when the identity holds one", () => {
    const view = experienceView(
      identity({ videoId: "doc-2", videoSlug: "jesus", title: "The Story" }),
    )
    expect(view).not.toHaveProperty("custom_2")
    expect(view.video_id).toBe("doc-2")
  })

  // R13: the route's own name only when the backend cannot see native seeks.
  it("uses the watch player name when the backend sees native-control seeks", () => {
    expect(experienceView(identity({ videoId: "doc-2" })).player_name).toBe(
      "forge-mobile-watch",
    )
  })

  it("uses its own player name when the backend cannot see native-control seeks", () => {
    expect(
      experienceView(identity({ videoId: "doc-2" }), {
        seesNativeControlSeeks: false,
      }).player_name,
    ).toBe("forge-mobile-experience")
  })

  it("never changes the watch page's name for that backend", () => {
    const view = buildMuxViewData({
      surface: "watch",
      identity: identity({ videoSlug: "jesus" }),
      streamUrl: STREAM,
      downloaded: false,
      viewerId: VIEWER,
      seesNativeControlSeeks: false,
    })
    expect(view.player_name).toBe("forge-mobile-watch")
  })
})

describe("buildMuxViewData: the field set (R21)", () => {
  it("returns only mapped keys, for every surface and container", () => {
    const full = identity({
      videoId: "doc-1",
      videoSlug: "jesus",
      title: "Jesus",
    })
    const views = [
      watchView(full),
      watchView(full, { url: DOWNLOAD, downloaded: true }),
      experienceView(full),
      experienceView(full, { seesNativeControlSeeks: false }),
    ]
    for (const view of views) {
      for (const key of Object.keys(view)) expect(MAPPED_KEYS).toContain(key)
    }
  })

  it("passes no extra identity field through to Mux", () => {
    const view = watchView({
      videoId: "doc-1",
      videoSlug: "jesus",
      title: "Jesus",
      ...({
        languageSlug: "spanish",
        playbackMode: "offline",
        discoverySource: "search",
      } as object),
    } as MuxViewIdentity)
    const serialized = JSON.stringify(view)
    expect(serialized).not.toContain("spanish")
    expect(serialized).not.toContain("offline")
    expect(serialized).not.toContain("search")
  })
})
