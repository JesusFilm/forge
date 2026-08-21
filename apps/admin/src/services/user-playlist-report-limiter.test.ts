import { describe, expect, it, vi } from "vitest"
import { RedisUserPlaylistReportLimiter } from "./user-playlist-report-limiter"

describe("RedisUserPlaylistReportLimiter", () => {
  it("atomically admits intent, playlist, IP, and global dimensions", async () => {
    const evalCommand = vi.fn().mockResolvedValue(1)
    const limiter = new RedisUserPlaylistReportLimiter({
      eval: evalCommand,
    } as never)
    await expect(
      limiter.consume({
        intentDigest: "intent-digest",
        playlistId: "playlist-1",
        ipDigest: "ip-digest",
        coarseIpBucket: false,
        globalKey: "user-playlist-report",
        now: new Date("2026-08-21T12:00:00.000Z"),
      }),
    ).resolves.toBe(true)

    const args = evalCommand.mock.calls[0]!
    expect(args[1]).toBe(4)
    expect(args.slice(2, 6)).toHaveLength(4)
    expect(args.join(" ")).not.toContain("playlist-1")
  })

  it("uses only intent, playlist, and global dimensions without trusted IP", async () => {
    const evalCommand = vi.fn().mockResolvedValue(0)
    const limiter = new RedisUserPlaylistReportLimiter({
      eval: evalCommand,
    } as never)
    await expect(
      limiter.consume({
        intentDigest: "intent-digest",
        playlistId: "playlist-1",
        ipDigest: null,
        coarseIpBucket: true,
        globalKey: "user-playlist-report",
        now: new Date(),
      }),
    ).resolves.toBe(false)
    expect(evalCommand.mock.calls[0]?.[1]).toBe(3)
  })

  it("fails closed when Redis is absent or unavailable", async () => {
    const input = {
      intentDigest: "intent-digest",
      playlistId: "playlist-1",
      ipDigest: null,
      coarseIpBucket: true,
      globalKey: "user-playlist-report" as const,
      now: new Date(),
    }
    await expect(
      new RedisUserPlaylistReportLimiter(null).consume(input),
    ).resolves.toBe(false)
    await expect(
      new RedisUserPlaylistReportLimiter({
        eval: vi.fn().mockRejectedValue(new Error("down")),
      } as never).consume(input),
    ).resolves.toBe(false)
  })
})
