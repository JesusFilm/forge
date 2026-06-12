import { describe, expect, it } from "vitest"
import {
  createJobLanes,
  TERMINAL_RECORD_RETENTION_MS,
  type JobExecutor,
} from "./jobs.js"
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
    artifacts: [{ assetId: label, artifactType: "shorts-clip-v1", ext: "mp4" }],
    report: {
      hasAudio: true,
      clipDurationSec: 10,
      captionsCount: 4,
      annotation: null,
    },
  }
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe("createJobLanes — per-lane execution", () => {
  it("runs prepare and render CONCURRENTLY (independent lanes)", async () => {
    const lanes = createJobLanes({
      prepare: { concurrency: 1, limit: 2 },
      render: { concurrency: 1, limit: 2 },
    })
    const prepareGate = deferred<JobResult>()
    const renderGate = deferred<JobResult>()
    const started: string[] = []

    const prepare = lanes.submit("prepare", "prepare:a", async () => {
      started.push("prepare")
      return prepareGate.promise
    })
    const render = lanes.submit("render", "render:a:h1", async () => {
      started.push("render")
      return renderGate.promise
    })
    if (!prepare.ok || !render.ok) throw new Error("submit failed")

    await settle()
    // Both lanes started despite each lane having concurrency 1.
    expect(started.sort()).toEqual(["prepare", "render"])
    expect(lanes.get(prepare.job.workerJobId)!.status).toBe("running")
    expect(lanes.get(render.job.workerJobId)!.status).toBe("running")

    prepareGate.resolve(fakeResult("a"))
    renderGate.resolve(fakeResult("a"))
    await settle()
    expect(lanes.get(prepare.job.workerJobId)!.status).toBe("completed")
    expect(lanes.get(render.job.workerJobId)!.status).toBe("completed")
  })

  it("queues the second job of the SAME lane (concurrency 1)", async () => {
    const lanes = createJobLanes({ render: { concurrency: 1, limit: 5 } })
    const first = deferred<JobResult>()
    const order: string[] = []

    const submitFirst = lanes.submit("render", "render:a:h1", async () => {
      order.push("first")
      return first.promise
    })
    const submitSecond = lanes.submit("render", "render:b:h2", async () => {
      order.push("second")
      return fakeResult("b")
    })
    if (!submitFirst.ok || !submitSecond.ok) throw new Error("submit failed")

    await settle()
    expect(order).toEqual(["first"])
    expect(lanes.get(submitSecond.job.workerJobId)!.status).toBe("queued")

    first.resolve(fakeResult("a"))
    await settle()
    expect(order).toEqual(["first", "second"])
    expect(lanes.get(submitSecond.job.workerJobId)!.status).toBe("completed")
  })

  it("rejects with queue_full at the lane cap, while the OTHER lane stays open", async () => {
    const lanes = createJobLanes({
      prepare: { concurrency: 1, limit: 2 },
      render: { concurrency: 1, limit: 2 },
    })
    const blocker = deferred<JobResult>()

    // Fill the render lane: 1 running + 1 queued = limit 2.
    const first = lanes.submit(
      "render",
      "render:a:h1",
      async () => blocker.promise,
    )
    const second = lanes.submit(
      "render",
      "render:b:h2",
      async () => blocker.promise,
    )
    const third = lanes.submit(
      "render",
      "render:c:h3",
      async () => blocker.promise,
    )

    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    expect(third).toEqual({ ok: false, reason: "queue_full" })

    // The prepare lane is unaffected by render-lane saturation.
    const prepare = lanes.submit(
      "prepare",
      "prepare:a",
      async () => blocker.promise,
    )
    expect(prepare.ok).toBe(true)

    // Finishing a render frees render capacity.
    blocker.resolve(fakeResult("a"))
    await settle()
    const fourth = lanes.submit("render", "render:d:h4", async () =>
      fakeResult("d"),
    )
    expect(fourth.ok).toBe(true)
  })
})

describe("createJobLanes — in-flight dedupe", () => {
  it("re-attaches to an ACTIVE job with the same dedupe key", async () => {
    const lanes = createJobLanes({ render: { concurrency: 1, limit: 5 } })
    const running = deferred<JobResult>()

    const first = lanes.submit(
      "render",
      "render:a:h1",
      async () => running.promise,
    )
    if (!first.ok) throw new Error("submit failed")
    await settle()

    const duplicate = lanes.submit("render", "render:a:h1", async () =>
      fakeResult("dup"),
    )
    expect(duplicate).toEqual({ ok: true, job: first.job, deduped: true })
  })

  it("does not dedupe against completed or failed records", async () => {
    const lanes = createJobLanes({ render: { concurrency: 1, limit: 5 } })

    const completed = lanes.submit("render", "render:a:h1", async () =>
      fakeResult("ok"),
    )
    const failed = lanes.submit("render", "render:b:h2", async () => {
      throw new Error("boom")
    })
    if (!completed.ok || !failed.ok) throw new Error("submit failed")
    await settle()
    expect(lanes.get(completed.job.workerJobId)!.status).toBe("completed")
    expect(lanes.get(failed.job.workerJobId)!.status).toBe("failed")

    const rerunCompleted = lanes.submit("render", "render:a:h1", async () =>
      fakeResult("again"),
    )
    const rerunFailed = lanes.submit("render", "render:b:h2", async () =>
      fakeResult("again"),
    )
    if (!rerunCompleted.ok || !rerunFailed.ok) throw new Error("submit failed")

    expect(rerunCompleted.deduped).toBe(false)
    expect(rerunCompleted.job.workerJobId).not.toBe(completed.job.workerJobId)
    expect(rerunFailed.deduped).toBe(false)
    expect(rerunFailed.job.workerJobId).not.toBe(failed.job.workerJobId)
  })

  it("distinct propsHash values do not dedupe (re-render after an edit)", async () => {
    const lanes = createJobLanes({ render: { concurrency: 1, limit: 5 } })
    const gate = deferred<JobResult>()

    const first = lanes.submit(
      "render",
      "render:a:h1",
      async () => gate.promise,
    )
    const second = lanes.submit(
      "render",
      "render:a:h2",
      async () => gate.promise,
    )
    if (!first.ok || !second.ok) throw new Error("submit failed")
    expect(second.deduped).toBe(false)
    expect(second.job.workerJobId).not.toBe(first.job.workerJobId)
  })
})

describe("createJobLanes — failure containment", () => {
  it("contains async failures with a STRUCTURED error body and keeps processing", async () => {
    const lanes = createJobLanes({ render: { concurrency: 1, limit: 5 } })
    const failing = lanes.submit("render", "render:a:h1", async () => {
      throw new Error("render exploded")
    })
    const following = lanes.submit("render", "render:b:h2", async () =>
      fakeResult("ok"),
    )
    if (!failing.ok || !following.ok) throw new Error("submit failed")

    await settle()

    const failedJob = lanes.get(failing.job.workerJobId)!
    expect(failedJob.status).toBe("failed")
    expect(failedJob.error).toEqual({
      reason: "internal_error",
      messages: ["render exploded"],
      retryable: false,
    })
    expect(failedJob.result).toBeNull()

    expect(lanes.get(following.job.workerJobId)!.status).toBe("completed")
  })

  it("releases the lane slot on a SYNCHRONOUS throw (slot-leak guard)", async () => {
    const lanes = createJobLanes({ render: { concurrency: 1, limit: 5 } })
    const syncThrow = (() => {
      throw new Error("sync boom")
    }) as unknown as JobExecutor

    const failing = lanes.submit("render", "render:a:h1", syncThrow)
    const following = lanes.submit("render", "render:b:h2", async () =>
      fakeResult("ok"),
    )
    if (!failing.ok || !following.ok) throw new Error("submit failed")

    await settle()

    expect(lanes.get(failing.job.workerJobId)!.status).toBe("failed")
    expect(lanes.get(failing.job.workerJobId)!.error?.messages).toEqual([
      "sync boom",
    ])
    expect(lanes.get(following.job.workerJobId)!.status).toBe("completed")
  })
})

describe("createJobLanes — terminal record eviction", () => {
  it("evicts completed/failed records older than the retention window on submit", async () => {
    let clock = new Date("2026-06-11T00:00:00.000Z")
    const lanes = createJobLanes({
      render: { concurrency: 2, limit: 5 },
      now: () => clock,
    })

    const completed = lanes.submit("render", "render:a:h1", async () =>
      fakeResult("a"),
    )
    const failed = lanes.submit("render", "render:b:h2", async () => {
      throw new Error("boom")
    })
    if (!completed.ok || !failed.ok) throw new Error("submit failed")
    await settle()
    expect(lanes.get(completed.job.workerJobId)!.status).toBe("completed")
    expect(lanes.get(failed.job.workerJobId)!.status).toBe("failed")

    // Just inside the window: both records survive the next submit.
    clock = new Date(clock.getTime() + TERMINAL_RECORD_RETENTION_MS - 1)
    const within = lanes.submit("render", "render:c:h3", async () =>
      fakeResult("c"),
    )
    if (!within.ok) throw new Error("submit failed")
    expect(lanes.get(completed.job.workerJobId)).toBeDefined()
    expect(lanes.get(failed.job.workerJobId)).toBeDefined()
    await settle()

    // Beyond the window: the stale terminal records are pruned.
    clock = new Date(clock.getTime() + TERMINAL_RECORD_RETENTION_MS + 1)
    const later = lanes.submit("render", "render:d:h4", async () =>
      fakeResult("d"),
    )
    if (!later.ok) throw new Error("submit failed")
    expect(lanes.get(completed.job.workerJobId)).toBeUndefined()
    expect(lanes.get(failed.job.workerJobId)).toBeUndefined()
    await settle()
  })

  it("never evicts ACTIVE jobs, no matter how old", async () => {
    let clock = new Date("2026-06-11T00:00:00.000Z")
    const lanes = createJobLanes({
      render: { concurrency: 1, limit: 5 },
      now: () => clock,
    })
    const gate = deferred<JobResult>()

    const running = lanes.submit(
      "render",
      "render:a:h1",
      async () => gate.promise,
    )
    const queued = lanes.submit(
      "render",
      "render:b:h2",
      async () => gate.promise,
    )
    if (!running.ok || !queued.ok) throw new Error("submit failed")
    await settle()
    expect(lanes.get(running.job.workerJobId)!.status).toBe("running")
    expect(lanes.get(queued.job.workerJobId)!.status).toBe("queued")

    // Advance far beyond the retention window — active jobs must survive.
    clock = new Date(clock.getTime() + TERMINAL_RECORD_RETENTION_MS * 3)
    const trigger = lanes.submit("render", "render:c:h3", async () =>
      fakeResult("c"),
    )
    if (!trigger.ok) throw new Error("submit failed")
    expect(lanes.get(running.job.workerJobId)!.status).toBe("running")
    expect(lanes.get(queued.job.workerJobId)!.status).toBe("queued")

    gate.resolve(fakeResult("a"))
    await settle()
  })
})

describe("createJobLanes — progress and lookups", () => {
  it("tracks clamped progress and messages while running", async () => {
    const lanes = createJobLanes({ render: { concurrency: 1, limit: 5 } })
    const gate = deferred<JobResult>()
    let report!: Parameters<JobExecutor>[0]["onProgress"]

    const submitted = lanes.submit(
      "render",
      "render:a:h1",
      async ({ onProgress }) => {
        report = onProgress
        return gate.promise
      },
    )
    if (!submitted.ok) throw new Error("submit failed")

    await settle()
    report(0.45, "Rendering 45%")
    let job = lanes.get(submitted.job.workerJobId)!
    expect(job.progress).toBe(0.45)
    expect(job.message).toBe("Rendering 45%")

    report(1.5, "over")
    expect(lanes.get(submitted.job.workerJobId)!.progress).toBe(1)
    report(-2, "under")
    expect(lanes.get(submitted.job.workerJobId)!.progress).toBe(0)

    gate.resolve(fakeResult("done"))
    await settle()
    job = lanes.get(submitted.job.workerJobId)!
    expect(job.status).toBe("completed")
    expect(job.progress).toBe(1)
    expect(job.result).toEqual(fakeResult("done"))
  })

  it("returns undefined for unknown job ids and prefixes ids with wj_", () => {
    const lanes = createJobLanes()
    expect(lanes.get("wj_missing")).toBeUndefined()

    const submitted = lanes.submit("prepare", "prepare:a", async () =>
      fakeResult("a"),
    )
    if (!submitted.ok) throw new Error("submit failed")
    expect(submitted.job.workerJobId).toMatch(/^wj_[0-9a-f-]{36}$/)
    expect(submitted.job.status).toBe("queued")
  })
})
