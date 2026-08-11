import { describe, expect, it, vi } from "vitest"

import {
  createSeekerPromptHealthCheck,
  startSeekerPromptHealthMonitor,
} from "./seeker-prompt-health"

describe("createSeekerPromptHealthCheck", () => {
  it("alerts once for label lag, recovers once, and never blocks pinned traffic", async () => {
    const log = vi.fn()
    const resolvePinned = vi.fn().mockResolvedValue({
      ok: true,
      text: "prompt",
      identity: { revision: "42" },
    })
    const fetchLabel = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        text: "prompt",
        version: 41,
        labels: ["production"],
      })
      .mockResolvedValueOnce({
        ok: true,
        text: "prompt",
        version: 41,
        labels: ["production"],
      })
      .mockResolvedValueOnce({
        ok: true,
        text: "prompt",
        version: 42,
        labels: ["production"],
      })
    const check = createSeekerPromptHealthCheck({
      pinned: {
        name: "seeker-system",
        revision: "42",
        contentHash: "a".repeat(64),
      },
      resolvePinned,
      fetchLabel,
      log,
    })
    expect(await check()).toMatchObject({ healthy: true, labelAligned: false })
    expect(await check()).toMatchObject({ healthy: true, labelAligned: false })
    expect(await check()).toMatchObject({ healthy: true, labelAligned: true })
    expect(log).toHaveBeenCalledTimes(2)
    expect(log.mock.calls[0][0]).toContain("effect=alert_only")
    expect(log.mock.calls[1][0]).toContain("event=recovered")
  })

  it("reports a critical pinned-version failure separately", async () => {
    const log = vi.fn()
    const check = createSeekerPromptHealthCheck({
      pinned: {
        name: "seeker-system",
        revision: "42",
        contentHash: "a".repeat(64),
      },
      resolvePinned: vi
        .fn()
        .mockResolvedValue({ ok: false, reason: "rejected" }),
      log,
    })
    expect(await check()).toMatchObject({ healthy: false, critical: true })
    expect(log.mock.calls[0][0]).toContain("effect=pinned_version_unavailable")
  })
})

describe("startSeekerPromptHealthMonitor", () => {
  it("runs at boot and daily only in configured production", async () => {
    vi.useFakeTimers()
    const check = vi.fn().mockResolvedValue(undefined)
    const monitor = startSeekerPromptHealthMonitor({
      environment: {
        NODE_ENV: "production",
        LANGFUSE_BASE_URL: "https://langfuse.example",
        LANGFUSE_PUBLIC_KEY: "pk-lf-public",
        LANGFUSE_SECRET_KEY: "sk-lf-secret",
      },
      check,
      intervalMs: 100,
    })
    expect(monitor).not.toBeNull()
    expect(check).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(100)
    expect(check).toHaveBeenCalledTimes(2)
    monitor?.stop()
    vi.useRealTimers()
  })

  it("stays silent outside configured production", () => {
    const check = vi.fn()
    expect(
      startSeekerPromptHealthMonitor({
        environment: { NODE_ENV: "production" },
        check,
      }),
    ).toBeNull()
    expect(check).not.toHaveBeenCalled()
  })
})
