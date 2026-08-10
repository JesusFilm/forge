import { describe, expect, it, vi } from "vitest"

import { BoundedSearchTraceWriteQueue } from "./search-trace-write-queue"

describe("BoundedSearchTraceWriteQueue", () => {
  it("keeps trace work off the caller stack and bounds database concurrency", async () => {
    let releaseFirst!: () => void
    const firstPending = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const worker = vi
      .fn<(value: string) => Promise<void>>()
      .mockImplementationOnce(async () => firstPending)
      .mockResolvedValue(undefined)
    const queue = new BoundedSearchTraceWriteQueue({
      concurrency: 1,
      maxPending: 2,
      worker,
    })

    expect(queue.enqueue("first")).toBe(true)
    expect(worker).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(worker).toHaveBeenCalledWith("first"))

    expect(queue.enqueue("second")).toBe(true)
    expect(queue.enqueue("overflow")).toBe(false)
    expect(worker).toHaveBeenCalledTimes(1)

    releaseFirst()
    await vi.waitFor(() => expect(worker).toHaveBeenCalledWith("second"))
  })

  it("continues draining after a write fails", async () => {
    const onError = vi.fn()
    const worker = vi
      .fn<(value: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error("database unavailable"))
      .mockResolvedValue(undefined)
    const queue = new BoundedSearchTraceWriteQueue({
      concurrency: 1,
      maxPending: 2,
      onError,
      worker,
    })

    expect(queue.enqueue("failed")).toBe(true)
    expect(queue.enqueue("next")).toBe(true)

    await vi.waitFor(() => expect(worker).toHaveBeenCalledTimes(2))
    expect(onError).toHaveBeenCalledOnce()
  })

  it("resolves an accepted item's completion only after its worker settles", async () => {
    let release!: () => void
    const pending = new Promise<void>((resolve) => {
      release = resolve
    })
    const queue = new BoundedSearchTraceWriteQueue({
      concurrency: 1,
      maxPending: 1,
      worker: vi.fn(async () => pending),
    })

    const completion = queue.enqueueWithCompletion("trace")
    expect(completion).not.toBeNull()
    let completed = false
    void completion?.then(() => {
      completed = true
    })
    await Promise.resolve()
    expect(completed).toBe(false)

    release()
    await completion
    expect(completed).toBe(true)
  })
})
