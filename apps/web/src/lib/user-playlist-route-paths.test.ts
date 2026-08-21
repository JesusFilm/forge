import { describe, expect, it } from "vitest"

import { userPlaylistServerLoginPath } from "./user-playlist-route-paths"

describe("userPlaylistServerLoginPath", () => {
  it("leaves the app base path for Next to apply exactly once", () => {
    expect(userPlaylistServerLoginPath("/watch/playlists")).toBe(
      "/api/auth/login?returnTo=%2Fwatch%2Fplaylists",
    )
    expect(userPlaylistServerLoginPath("/watch/playlists/playlist_123")).toBe(
      "/api/auth/login?returnTo=%2Fwatch%2Fplaylists%2Fplaylist_123",
    )
  })
})
