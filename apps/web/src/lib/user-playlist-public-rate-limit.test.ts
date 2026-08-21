import { describe, expect, it, vi } from "vitest"

import { RedisPublicUserPlaylistIngressLimiter } from "./user-playlist-public-rate-limit"

describe("RedisPublicUserPlaylistIngressLimiter", () => {
  it("atomically consumes capability, trusted-IP, and global dimensions without raw IP", async () => {
    const evalCommand = vi.fn().mockResolvedValue(1)
    const limiter = new RedisPublicUserPlaylistIngressLimiter(async () => ({
      eval: evalCommand,
    }))
    await expect(
      limiter.consume({
        action: "read",
        capabilityDigest: "already-opaque-capability",
        viewerIp: "203.0.113.9",
        now: new Date("2026-08-21T12:00:00.000Z"),
      }),
    ).resolves.toBe("admitted")

    const [, options] = evalCommand.mock.calls[0]!
    expect(options.keys).toHaveLength(3)
    expect(JSON.stringify(options.keys)).not.toContain("203.0.113.9")
    expect(options.arguments).toEqual([
      "120",
      "60000",
      "60",
      "60000",
      "5000",
      "60000",
    ])
  })

  it("uses coarse capability/global protection without trusted IP and fails closed", async () => {
    const evalCommand = vi.fn().mockResolvedValue(0)
    const limiter = new RedisPublicUserPlaylistIngressLimiter(async () => ({
      eval: evalCommand,
    }))
    await expect(
      limiter.consume({
        action: "report",
        capabilityDigest: "intent-digest",
        viewerIp: null,
        now: new Date(),
      }),
    ).resolves.toBe("limited")
    expect(evalCommand.mock.calls[0]?.[1].keys).toHaveLength(2)

    const unavailable = new RedisPublicUserPlaylistIngressLimiter(
      async () => null,
    )
    await expect(
      unavailable.consume({
        action: "read",
        capabilityDigest: "digest",
        viewerIp: null,
        now: new Date(),
      }),
    ).resolves.toBe("unavailable")
  })
})
