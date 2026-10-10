import { WorkerCleanupError } from "./errors.js"
import { createStorage } from "./storage.js"
import { once } from "node:events"
import { createConnection } from "node:net"
import { createServer } from "node:http"
import { afterEach, expect, it, vi } from "vitest"
import { createJobLanes } from "./jobs.js"
import {
  createWorkerServer,
  createHandleRequest,
  createRequestListener,
} from "./server.js"
import type { JobResult } from "./types.js"

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
const result: JobResult = {
  artifacts: [],
  report: {
    portrait: {
      artifact: { assetId: "test", artifactType: "test", ext: "mp4" },
      outputDurationSec: 1,
      width: 1080,
      height: 1920,
    },
    wide: {
      artifact: { assetId: "test", artifactType: "test", ext: "mp4" },
      outputDurationSec: 1,
      width: 1920,
      height: 1080,
    },
  },
}
afterEach(() => vi.useRealTimers())

it("shutdown cancels without starting queued work and waits for actual cleanup despite late success", async () => {
  const queue = createJobLanes()
  const cleanup = deferred<JobResult>()
  let signal: AbortSignal | undefined
  const first = queue.submit("devotional-render", "first", async (context) => {
    signal = context.signal
    return cleanup.promise
  })
  await Promise.resolve()
  const never = vi.fn(async () => result)
  const second = queue.submit("devotional-render", "second", never)
  if (!first.ok || !second.ok) throw new Error("fixture admission failed")
  const stopped = queue.shutdown()
  expect(queue.shutdown()).toBe(stopped)
  expect(signal?.aborted).toBe(true)
  expect(queue.get(second.job.workerJobId)?.status).toBe("cancelled")
  expect(queue.submit("devotional-render", "late", never)).toEqual({
    ok: false,
    reason: "shutting_down",
  })
  let settled = false
  void stopped.then(() => {
    settled = true
  })
  await Promise.resolve()
  expect(settled).toBe(false)
  cleanup.resolve(result)
  await stopped
  expect(never).not.toHaveBeenCalled()
  expect(queue.get(first.job.workerJobId)).toMatchObject({
    status: "cancelled",
    result: null,
  })
})

it("shutdown before the pump prevents every start", async () => {
  const queue = createJobLanes()
  const execute = vi.fn(async () => result)
  queue.submit("devotional-render", "queued", execute)
  await queue.shutdown()
  expect(execute).not.toHaveBeenCalled()
})

it("one absolute grace includes an uncooperative job and repeated shutdown does not reset it", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] })
  const queue = createJobLanes()
  const work = deferred<JobResult>()
  queue.submit("devotional-render", "stuck", () => work.promise)
  await Promise.resolve()
  const worker = createWorkerServer({ queue, nodeEnv: "test" })
  const stopped = worker.shutdown()
  await vi.advanceTimersByTimeAsync(4000)
  expect(worker.shutdown()).toBe(stopped)
  await vi.advanceTimersByTimeAsync(1000)
  await expect(stopped).resolves.toBe("deadline-exceeded")
  work.resolve(result)
  await queue.shutdown()
})

it("shutdown called from an abort listener returns the same lifetime", async () => {
  const queue = createJobLanes()
  const work = deferred<JobResult>()
  const worker = createWorkerServer({ queue, nodeEnv: "test" })
  let reentered: ReturnType<typeof worker.shutdown> | undefined
  queue.submit("devotional-render", "reenter", ({ signal }) => {
    signal.addEventListener("abort", () => {
      reentered = worker.shutdown()
    })
    return work.promise
  })
  await Promise.resolve()
  const stopped = worker.shutdown()
  expect(reentered).toBe(stopped)
  work.resolve(result)
  await expect(stopped).resolves.toBe("drained")
})

it("HTTP closure shares the job grace instead of receiving a fresh timeout", async () => {
  const queue = createJobLanes()
  const work = deferred<JobResult>()
  queue.submit(
    "devotional-render",
    "finishes-near-deadline",
    () => work.promise,
  )
  await Promise.resolve()
  const worker = createWorkerServer({
    queue,
    nodeEnv: "test",
    auth: { apiKeysCsv: "local-test" },
  })
  worker.server.listen(0, "127.0.0.1")
  await once(worker.server, "listening")
  const address = worker.server.address()
  if (!address || typeof address === "string")
    throw new Error("missing local listener")
  const socket = createConnection(address.port, "127.0.0.1")
  socket.on("error", () => {})
  try {
    await once(socket, "connect")
    const observed = once(worker.server, "request")
    socket.write(
      "POST /jobs HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer local-test\r\nContent-Type: application/json\r\nContent-Length: 100\r\n\r\n{",
    )
    await observed
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] })
    const stopped = worker.shutdown()
    await vi.advanceTimersByTimeAsync(4000)
    work.resolve(result)
    await queue.shutdown()
    await vi.advanceTimersByTimeAsync(1000)
    await expect(stopped).resolves.toBe("deadline-exceeded")
  } finally {
    vi.useRealTimers()
    socket.destroy()
    worker.server.closeAllConnections()
    await worker.shutdown()
  }
})

it("stopping readiness/admission remains distinct from authenticated terminal reads", async () => {
  const queue = createJobLanes()
  const submitted = queue.submit(
    "devotional-render",
    "completed",
    async () => result,
  )
  await new Promise((done) => setImmediate(done))
  if (!submitted.ok) throw new Error("fixture admission")
  await queue.shutdown()
  const server = createServer(
    createRequestListener(
      createHandleRequest(
        { queue, auth: { apiKeysCsv: "local-test" } },
        () => true,
      ),
    ),
  )
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const address = server.address()
  if (!address || typeof address === "string")
    throw new Error("missing listener")
  const origin = `http://127.0.0.1:${address.port}`
  try {
    expect((await fetch(`${origin}/health`)).status).toBe(503)
    expect((await fetch(`${origin}/jobs`, { method: "POST" })).status).toBe(401)
    const rejected = await fetch(`${origin}/jobs`, {
      method: "POST",
      headers: { authorization: "Bearer local-test" },
    })
    expect(rejected.status).toBe(503)
    expect(await rejected.json()).toEqual({ error: "shutting_down" })
    const upload = `${origin}/devotional-inputs/input/devotional-render-input-v1.json`
    expect((await fetch(upload, { method: "PUT" })).status).toBe(401)
    expect(
      (
        await fetch(upload, {
          method: "PUT",
          headers: { authorization: "Bearer local-test" },
        })
      ).status,
    ).toBe(503)
    const path = `${origin}/jobs/${submitted.job.workerJobId}`
    expect((await fetch(path)).status).toBe(401)
    const read = await fetch(path, {
      headers: { authorization: "Bearer local-test" },
    })
    expect((await read.json()).status).toBe("completed")
  } finally {
    server.closeAllConnections()
    await new Promise<void>((done) => server.close(() => done()))
  }
})

it("does not report drained when an admitted HTTP handler outlives its disconnected socket", async () => {
  const entered = deferred<void>()
  const lookup = deferred<boolean>()
  const storage = createStorage({ localRootDir: "/unused-owned-test" })
  storage.artifactExists = async () => {
    entered.resolve()
    return lookup.promise
  }
  const worker = createWorkerServer({
    artifactStorage: storage,
    auth: { apiKeysCsv: "local-test" },
  })
  worker.server.listen(0, "127.0.0.1")
  await once(worker.server, "listening")
  const address = worker.server.address()
  if (!address || typeof address === "string")
    throw new Error("missing listener")
  const socket = createConnection(address.port, "127.0.0.1")
  socket.on("error", () => {})
  try {
    await once(socket, "connect")
    socket.write(
      "HEAD /artifacts/output/devotional-output-portrait-v1.mp4 HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer local-test\r\n\r\n",
    )
    await entered.promise
    socket.destroy()
    await once(socket, "close")
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] })
    const stopped = worker.shutdown()
    await vi.advanceTimersByTimeAsync(5000)
    await expect(stopped).resolves.toBe("deadline-exceeded")
  } finally {
    lookup.resolve(false)
    vi.useRealTimers()
    socket.destroy()
    worker.server.closeAllConnections()
    await worker.shutdown()
  }
})

it("cleanup failure latches admission closed before successor pumping and reports failed drain", async () => {
  const cleanup = deferred<JobResult>()
  let closedAtNotification = false
  const successor = vi.fn(async () => result)
  const queue = createJobLanes({
    onCleanupFailure: () => {
      closedAtNotification = !queue.submit(
        "devotional-render",
        "inside-notification",
        successor,
      ).ok
    },
  })
  queue.submit("devotional-render", "fatal", async () => {
    await cleanup.promise
    throw new WorkerCleanupError()
  })
  await Promise.resolve()
  const next = queue.submit("devotional-render", "successor", successor)
  cleanup.resolve(result)
  await new Promise((resolve) => setImmediate(resolve))
  expect(closedAtNotification).toBe(true)
  expect(successor).not.toHaveBeenCalled()
  if (!next.ok) throw new Error("fixture admission")
  expect(queue.get(next.job.workerJobId)?.status).toBe("cancelled")
  const worker = createWorkerServer({ queue })
  await expect(worker.shutdown()).resolves.toBe("failed")
})

it("production-owned queue cleanup failure triggers unsuccessful retirement without a new grace", async () => {
  const retired = deferred<string>()
  const worker = createWorkerServer(
    {
      auth: { apiKeysCsv: "local-test" },
      runDevotionalRenderImpl: async () => {
        throw new WorkerCleanupError()
      },
    },
    (outcome) => retired.resolve(outcome),
  )
  worker.server.listen(0, "127.0.0.1")
  await once(worker.server, "listening")
  const address = worker.server.address()
  if (!address || typeof address === "string")
    throw new Error("missing listener")
  try {
    await fetch(`http://127.0.0.1:${address.port}/jobs`, {
      method: "POST",
      headers: {
        authorization: "Bearer local-test",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        kind: "devotional-render",
        runId: "local",
        inputAssetId: "input",
        outputAssetId: "output",
        inputHash: "a".repeat(64),
      }),
    }).catch(() => undefined)
    await expect(retired.promise).resolves.toBe("failed")
    await expect(worker.shutdown()).resolves.toBe("failed")
  } finally {
    worker.server.closeAllConnections()
    await worker.shutdown()
  }
})
