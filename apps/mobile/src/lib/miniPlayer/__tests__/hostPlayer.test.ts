import {
  borrowedPlayer,
  getHostPlayer,
  getPlaybackClaim,
  resetHostPlayerBridge,
  resolveActivePlayback,
  setHostPlayer,
  setPlaybackClaim,
  subscribeToHostPlayer,
  subscribeToPlaybackClaim,
  type HostPlayerEntry,
  type PlaybackClaim,
} from "../hostPlayer"
import type { VideoPlayer } from "expo-video"

const PLAYER = {} as VideoPlayer

const CLAIM: PlaybackClaim = {
  videoId: "video-1",
  videoSlug: "birth-of-jesus",
  languageSlug: "english",
  streamingUrl: "https://stream.test/one.m3u8",
}

function entry(overrides: Partial<HostPlayerEntry> = {}): HostPlayerEntry {
  return {
    player: PLAYER,
    identityKey: "slug:birth-of-jesus",
    isPlaying: true,
    surfaceFree: true,
    ...overrides,
  }
}

beforeEach(() => {
  resetHostPlayerBridge()
})

describe("the claim channel", () => {
  it("publishes a claim and reads it back", () => {
    setPlaybackClaim(CLAIM)

    expect(getPlaybackClaim()).toEqual(CLAIM)
  })

  it("notifies subscribers on a real change", () => {
    const listener = jest.fn()
    subscribeToPlaybackClaim(listener)

    setPlaybackClaim(CLAIM)

    expect(listener).toHaveBeenCalledTimes(1)
  })

  it("does NOT notify when nothing changed", () => {
    // useSyncExternalStore compares by identity, so a fresh object per write is
    // a render loop rather than a performance note.
    setPlaybackClaim(CLAIM)
    const listener = jest.fn()
    subscribeToPlaybackClaim(listener)

    setPlaybackClaim({ ...CLAIM })

    expect(listener).not.toHaveBeenCalled()
  })

  it("notifies when only the source re-points", () => {
    setPlaybackClaim(CLAIM)
    const listener = jest.fn()
    subscribeToPlaybackClaim(listener)

    setPlaybackClaim({ ...CLAIM, streamingUrl: "file:///offline/one.m3u8" })

    expect(listener).toHaveBeenCalledTimes(1)
  })

  it("stops notifying an unsubscribed listener", () => {
    const listener = jest.fn()
    subscribeToPlaybackClaim(listener)()

    setPlaybackClaim(CLAIM)

    expect(listener).not.toHaveBeenCalled()
  })
})

describe("the player channel", () => {
  it("publishes an entry and reads it back", () => {
    setHostPlayer(entry())

    expect(getHostPlayer()?.player).toBe(PLAYER)
  })

  it("does NOT notify when every field matches", () => {
    setHostPlayer(entry())
    const listener = jest.fn()
    subscribeToHostPlayer(listener)

    setHostPlayer(entry())

    expect(listener).not.toHaveBeenCalled()
  })

  it("notifies when the surface is released", () => {
    setHostPlayer(entry({ surfaceFree: false }))
    const listener = jest.fn()
    subscribeToHostPlayer(listener)

    setHostPlayer(entry({ surfaceFree: true }))

    expect(listener).toHaveBeenCalledTimes(1)
  })
})

describe("borrowedPlayer", () => {
  it("hands over a free surface for the claimed video", () => {
    expect(borrowedPlayer(entry(), CLAIM)).not.toBeNull()
  })

  it("withholds a player whose surface the host's window still holds", () => {
    // Android asserts on two views owning one player, so the claimant waits
    // for the window to release rather than racing it.
    expect(borrowedPlayer(entry({ surfaceFree: false }), CLAIM)).toBeNull()
  })

  it("withholds a player loaded with a DIFFERENT video", () => {
    // While the viewer opens a second video the host still holds the first
    // one's player; attaching here would show the previous video.
    expect(
      borrowedPlayer(entry({ identityKey: "slug:other" }), CLAIM),
    ).toBeNull()
  })

  it("withholds everything when nothing is claimed", () => {
    expect(borrowedPlayer(entry(), null)).toBeNull()
    expect(borrowedPlayer(null, CLAIM)).toBeNull()
  })

  it("matches a claim that has not resolved its videoId yet", () => {
    const slugOnly = {
      videoSlug: "birth-of-jesus",
      streamingUrl: CLAIM.streamingUrl,
    }
    expect(borrowedPlayer(entry(), slugOnly)).not.toBeNull()
  })
})

describe("resolveActivePlayback", () => {
  const SESSION = {
    videoId: "video-1",
    videoSlug: "birth-of-jesus",
    languageSlug: "english",
    streamingUrl: "https://stream.test/session.m3u8",
  }

  it("is null with neither a claim nor a session", () => {
    expect(resolveActivePlayback(null, null)).toBeNull()
  })

  it("follows the session when no route claims the player", () => {
    expect(resolveActivePlayback(null, SESSION)).toMatchObject({
      streamingUrl: SESSION.streamingUrl,
      videoId: "video-1",
    })
  })

  it("lets the route's claim win the SOURCE", () => {
    // The route is what the viewer is looking at, and its source re-points
    // first — the downloads manifest hydrating a file:// copy, for instance.
    const claim = { ...CLAIM, streamingUrl: "file:///offline/one.m3u8" }

    expect(resolveActivePlayback(claim, SESSION)?.streamingUrl).toBe(
      "file:///offline/one.m3u8",
    )
  })

  it("carries the session's videoId into a claim that lacks one", () => {
    // The route claims from its slug param before its query resolves. Without
    // this, the recorder loses the id its local progress bars are keyed on.
    const slugOnly: PlaybackClaim = {
      videoSlug: "birth-of-jesus",
      streamingUrl: "https://stream.test/one.m3u8",
    }

    expect(resolveActivePlayback(slugOnly, SESSION)).toMatchObject({
      videoId: "video-1",
      videoSlug: "birth-of-jesus",
    })
  })

  it("carries NOTHING from a session for a different video", () => {
    // Stamping the departing video's id onto the arriving one would record the
    // new video's position against the old one's bookmark.
    const other: PlaybackClaim = {
      videoSlug: "the-last-supper",
      streamingUrl: "https://stream.test/two.m3u8",
    }

    expect(resolveActivePlayback(other, SESSION)).toMatchObject({
      videoId: undefined,
      videoSlug: "the-last-supper",
    })
  })

  it("normalizes a missing language to null so compares stay stable", () => {
    const slugOnly: PlaybackClaim = {
      videoSlug: "solo",
      streamingUrl: "https://stream.test/solo.m3u8",
    }

    expect(resolveActivePlayback(slugOnly, null)?.languageSlug).toBeNull()
  })
})
