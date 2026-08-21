import { describe, expect, it } from "vitest"
import { UserPlaylistReportIntent } from "./user-playlist-report-intent"

const now = new Date("2026-08-21T12:00:00.000Z")

function intent(): UserPlaylistReportIntent {
  return new UserPlaylistReportIntent({
    keys: [{ id: "intent-v1", key: Buffer.alloc(32, 7), active: true }],
    randomBytes: (size) => Buffer.alloc(size, 9),
    ttlMs: 5 * 60 * 1000,
  })
}

describe("UserPlaylistReportIntent", () => {
  it("mints a short-lived intent bound to the playlist capability digest", () => {
    const service = intent()
    const token = service.mint({
      playlistId: "playlist-1",
      capabilityDigest: Buffer.alloc(32, 3),
      now,
    })

    expect(
      service.verify({
        token,
        capabilityDigest: Buffer.alloc(32, 3),
        now,
      }),
    ).toMatchObject({ playlistId: "playlist-1" })
    expect(
      service.verify({
        token,
        capabilityDigest: Buffer.alloc(32, 4),
        now,
      }),
    ).toBeNull()
    expect(
      service.verify({
        token,
        capabilityDigest: Buffer.alloc(32, 3),
        now: new Date(now.getTime() + 5 * 60 * 1000 + 1),
      }),
    ).toBeNull()

    const visibleSegments = token
      .split(".")
      .map((segment) => Buffer.from(segment, "base64url").toString("utf8"))
      .join(" ")
    expect(visibleSegments).not.toContain("playlist-1")
    expect(visibleSegments).not.toContain(
      Buffer.alloc(32, 3).toString("base64url"),
    )
  })
})
