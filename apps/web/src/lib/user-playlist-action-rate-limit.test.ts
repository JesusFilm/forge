import { describe, expect, it, vi } from "vitest"

import { RedisUserPlaylistActionLimiter } from "./user-playlist-action-rate-limit"

describe("RedisUserPlaylistActionLimiter", () => {
  it("atomically applies opaque subject, trusted-IP, and global ceilings", async () => {
    const evalCommand = vi.fn().mockResolvedValue(1)
    const limiter = new RedisUserPlaylistActionLimiter(async () => ({
      eval: evalCommand,
    }))

    await expect(
      limiter.consume({
        action: "write",
        subject: "consumer-user-123",
        viewerIp: "2001:db8::1",
        now: new Date("2026-08-21T12:00:00.000Z"),
      }),
    ).resolves.toBe("admitted")

    const [script, options] = evalCommand.mock.calls[0]!
    expect(script).toContain("INCR")
    expect(options.keys).toHaveLength(3)
    expect(options.keys.join(" ")).not.toContain("consumer-user-123")
    expect(options.keys.join(" ")).not.toContain("2001:db8::1")
  })

  it("keeps the authenticated subject and global ceilings without edge IP", async () => {
    const evalCommand = vi.fn().mockResolvedValue(0)
    const limiter = new RedisUserPlaylistActionLimiter(async () => ({
      eval: evalCommand,
    }))

    await expect(
      limiter.consume({
        action: "read",
        subject: "consumer-user-123",
        viewerIp: null,
        now: new Date(),
      }),
    ).resolves.toBe("limited")
    expect(evalCommand.mock.calls[0]?.[1].keys).toHaveLength(2)
  })

  it("fails closed distinctly when shared ingress storage is absent or errors", async () => {
    const input = {
      action: "share" as const,
      subject: "consumer-user-123",
      viewerIp: null,
      now: new Date(),
    }

    await expect(
      new RedisUserPlaylistActionLimiter(async () => null).consume(input),
    ).resolves.toBe("unavailable")
    await expect(
      new RedisUserPlaylistActionLimiter(async () => ({
        eval: vi.fn().mockRejectedValue(new Error("down")),
      })).consume(input),
    ).resolves.toBe("unavailable")
  })
})
