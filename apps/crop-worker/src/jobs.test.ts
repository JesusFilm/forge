import { describe, expect, it } from "vitest"
import { createJobQueue, type JobExecutor } from "./jobs.js"
import type { JobResult } from "./types.js"

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function fakeResult(label: string): JobResult {
  return {
    artifacts: [
      { assetId: label, artifactType: "smart-crop-preview-9x16", ext: "mp4" },
    ],
    report: { shotCount: 1, durationSeconds: 1, width: 1, height: 1 },
  }
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe("createJobQueue", () => {
  it("runs jobs one at a time with concurrency 1, in submission order", async () => {
    const queue = createJobQueue({ concurrency: 1, limit: 10 })
    const first = deferred<JobResult>()
    const second = deferred<JobResult>()
    const order: string[] = []

    const submitFirst = queue.submit("fingerprint", async () => {
      order.push("first-started")
      return first.promise
    })
    const submitSecond = queue.submit("render", async () => {
      order.push("second-started")
      return second.promise
    })
    if (!submitFirst.ok || !submitSecond.ok) throw new Error("submit failed")

    await settle()
    expect(order).toEqual(["first-started"])
    expect(queue.get(submitFirst.job.workerJobId)!.status).toBe("running")
    expect(queue.get(submitSecond.job.workerJobId)!.status).toBe("queued")

    first.resolve(fakeResult("a"))
    await settle()

    expect(order).toEqual(["first-started", "second-started"])
    expect(queue.get(submitFirst.job.workerJobId)!.status).toBe("completed")
    expect(queue.get(submitSecond.job.workerJobId)!.status).toBe("running")

    second.resolve(fakeResult("b"))
    await settle()
    expect(queue.get(submitSecond.job.workerJobId)!.status).toBe("completed")
  })

  it("rejects submissions beyond the queue limit with queue_full", async () => {
    const queue = createJobQueue({ concurrency: 1, limit: 2 })
    const blocker = deferred<JobResult>()

    const first = queue.submit("render", async () => blocker.promise)
    const second = queue.submit("render", async () => blocker.promise)
    const third = queue.submit("render", async () => blocker.promise)

    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    expect(third).toEqual({ ok: false, reason: "queue_full" })

    // Finishing a job frees capacity for new submissions.
    blocker.resolve(fakeResult("a"))
    await settle()
    const fourth = queue.submit("render", async () => fakeResult("b"))
    expect(fourth.ok).toBe(true)
  })

  it("contains async failures: job marked failed, queue keeps processing", async () => {
    const queue = createJobQueue({ concurrency: 1, limit: 10 })
    const failing = queue.submit("render", async () => {
      throw new Error("render exploded")
    })
    const following = queue.submit("fingerprint", async () => fakeResult("ok"))
    if (!failing.ok || !following.ok) throw new Error("submit failed")

    await settle()

    const failedJob = queue.get(failing.job.workerJobId)!
    expect(failedJob.status).toBe("failed")
    expect(failedJob.error).toBe("render exploded")
    expect(failedJob.result).toBeNull()

    const followingJob = queue.get(following.job.workerJobId)!
    expect(followingJob.status).toBe("completed")
  })

  it("releases the slot on a synchronous throw (slot-leak guard)", async () => {
    const queue = createJobQueue({ concurrency: 1, limit: 10 })
    const syncThrow = (() => {
      throw new Error("sync boom")
    }) as unknown as JobExecutor

    const failing = queue.submit("render", syncThrow)
    const following = queue.submit("render", async () => fakeResult("ok"))
    if (!failing.ok || !following.ok) throw new Error("submit failed")

    await settle()

    expect(queue.get(failing.job.workerJobId)!.status).toBe("failed")
    expect(queue.get(failing.job.workerJobId)!.error).toBe("sync boom")
    expect(queue.get(following.job.workerJobId)!.status).toBe("completed")
  })

  it("tracks clamped progress and messages while running", async () => {
    const queue = createJobQueue({ concurrency: 1, limit: 10 })
    const gate = deferred<JobResult>()
    let report!: Parameters<JobExecutor>[0]["onProgress"]

    const submitted = queue.submit("render", async ({ onProgress }) => {
      report = onProgress
      return gate.promise
    })
    if (!submitted.ok) throw new Error("submit failed")

    await settle()
    report(0.45, "Rendering segment 1 of 2")
    let job = queue.get(submitted.job.workerJobId)!
    expect(job.progress).toBe(0.45)
    expect(job.message).toBe("Rendering segment 1 of 2")

    report(1.5, "over")
    expect(queue.get(submitted.job.workerJobId)!.progress).toBe(1)
    report(-2, "under")
    expect(queue.get(submitted.job.workerJobId)!.progress).toBe(0)

    gate.resolve(fakeResult("done"))
    await settle()
    job = queue.get(submitted.job.workerJobId)!
    expect(job.status).toBe("completed")
    expect(job.progress).toBe(1)
    expect(job.result).toEqual(fakeResult("done"))
  })

  it("returns undefined for unknown job ids and prefixes ids with wj_", () => {
    const queue = createJobQueue({ concurrency: 1, limit: 10 })
    expect(queue.get("wj_missing")).toBeUndefined()

    const submitted = queue.submit("fingerprint", async () => fakeResult("a"))
    if (!submitted.ok) throw new Error("submit failed")
    expect(submitted.job.workerJobId).toMatch(/^wj_[0-9a-f-]{36}$/)
    expect(submitted.job.status).toBe("queued")
  })
})
