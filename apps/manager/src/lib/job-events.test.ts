import { beforeEach, describe, expect, it, vi } from "vitest"
import type { JobRecord } from "@/types/job"

function buildJob(id: string): JobRecord {
  return {
    id,
    muxAssetId: `asset-${id}`,
    muxPlaybackId: `playback-${id}`,
    languages: ["fr"],
    options: {},
    status: "running",
    retries: 0,
    createdAt: "2026-04-22T00:00:00.000Z",
    updatedAt: "2026-04-22T00:01:00.000Z",
    artifacts: {},
    steps: [],
    errors: [],
  }
}

describe("job-events", () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it("delivers job-upsert events to all-jobs subscribers", async () => {
    const { publishJobEvent, subscribeToAllJobEvents } =
      await import("@/lib/job-events")
    const handler = vi.fn()

    const unsubscribe = subscribeToAllJobEvents(handler)
    publishJobEvent(buildJob("job-1"))

    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledWith({
      type: "job-upsert",
      job: expect.objectContaining({ id: "job-1" }),
    })

    unsubscribe()
  })

  it("only delivers matching jobs to job-specific subscribers", async () => {
    const { publishJobEvent, subscribeToJobEvents } =
      await import("@/lib/job-events")
    const handler = vi.fn()

    const unsubscribe = subscribeToJobEvents("job-1", handler)
    publishJobEvent(buildJob("job-2"))
    publishJobEvent(buildJob("job-1"))

    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledWith({
      type: "job-upsert",
      job: expect.objectContaining({ id: "job-1" }),
    })

    unsubscribe()
  })

  it("stops delivery after unsubscribe", async () => {
    const { publishJobEvent, subscribeToAllJobEvents } =
      await import("@/lib/job-events")
    const handler = vi.fn()

    const unsubscribe = subscribeToAllJobEvents(handler)
    unsubscribe()

    publishJobEvent(buildJob("job-1"))

    expect(handler).not.toHaveBeenCalled()
  })

  it("keeps fan-out best-effort when one subscriber throws", async () => {
    const { publishJobEvent, subscribeToAllJobEvents } =
      await import("@/lib/job-events")
    const failingHandler = vi.fn(() => {
      throw new Error("listener exploded")
    })
    const healthyHandler = vi.fn()

    const unsubscribeFailing = subscribeToAllJobEvents(failingHandler)
    const unsubscribeHealthy = subscribeToAllJobEvents(healthyHandler)

    expect(() => publishJobEvent(buildJob("job-1"))).not.toThrow()
    expect(failingHandler).toHaveBeenCalledTimes(1)
    expect(healthyHandler).toHaveBeenCalledTimes(1)

    unsubscribeFailing()
    unsubscribeHealthy()
  })

  it("encodes SSE events with event and data framing", async () => {
    const { encodeEvent } = await import("@/lib/job-events")
    const payload = encodeEvent({
      type: "job-upsert",
      job: buildJob("job-1"),
    })

    const decoded = new TextDecoder().decode(payload)

    expect(decoded).toContain("event: job-upsert\n")
    expect(decoded).toContain('data: {"type":"job-upsert","job":')
    expect(decoded).toContain('"id":"job-1"')
    expect(decoded.endsWith("\n\n")).toBe(true)
  })
})
