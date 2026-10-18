import assert from "node:assert/strict"
import test from "node:test"
import { setImmediate } from "node:timers/promises"
import { renderOrderedFrames } from "../src/frame-pool.mjs"

function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

test("out-of-order rendering stays bounded and encoding receives every global frame once", async () => {
  const first = [deferred(), deferred()]
  const started = [],
    encoded = [],
    closed = []
  const pipeline = renderOrderedFrames({
    durationInFrames: 11,
    workerCount: 2,
    chunkFrames: 2,
    createWorker(id) {
      return {
        ready: Promise.resolve(),
        render(range) {
          started.push(range)
          return range.index < 2
            ? first[range.index].promise
            : Promise.resolve()
        },
        async close(abort) {
          closed.push({ id, abort })
        },
      }
    },
    async consume({ start, end }) {
      for (let frame = start; frame <= end; frame++) encoded.push(frame)
    },
  })
  await setImmediate()
  assert.deepEqual(
    started.map((r) => [r.start, r.end]),
    [
      [0, 1],
      [2, 3],
    ],
  )
  first[1].resolve()
  await setImmediate()
  assert.deepEqual(encoded, [])
  assert.equal(
    started.length,
    2,
    "a completed later chunk cannot widen lookahead",
  )
  first[0].resolve()
  await pipeline
  assert.deepEqual(
    encoded,
    Array.from({ length: 11 }, (_, i) => i),
  )
  assert.deepEqual(
    closed.sort((a, b) => a.id - b.id),
    [
      { id: 0, abort: false },
      { id: 1, abort: false },
    ],
  )
})

test("encoder backpressure stops the producer window from advancing", async () => {
  const pressure = deferred(),
    started = []
  const pipeline = renderOrderedFrames({
    durationInFrames: 20,
    workerCount: 2,
    chunkFrames: 2,
    createWorker: () => ({
      ready: Promise.resolve(),
      render(range) {
        started.push(range.index)
        return Promise.resolve()
      },
      close: async () => {},
    }),
    consume: async (range) => {
      if (range.index === 0) await pressure.promise
    },
  })
  await setImmediate()
  assert.deepEqual(started, [0, 1])
  pressure.resolve()
  await pipeline
  assert.equal(started.length, 10)
})

test("a worker failure stops scheduling and aborts every sibling", async () => {
  const closed = [],
    started = []
  await assert.rejects(
    renderOrderedFrames({
      durationInFrames: 300,
      workerCount: 3,
      chunkFrames: 60,
      createWorker: (id) => ({
        ready: Promise.resolve(),
        render(range) {
          started.push(range.index)
          return id === 0
            ? Promise.reject(new Error("decode failed"))
            : Promise.resolve()
        },
        close: async (abort) => {
          closed.push(abort)
        },
      }),
      consume: () => assert.fail("failed range must not reach encoder"),
    }),
    /decode failed/,
  )
  assert.deepEqual(started, [0, 1, 2])
  assert.deepEqual(closed, [true, true, true])
})

test("encoder failure aborts workers without rendering the rest of the timeline", async () => {
  let started = 0,
    aborted = 0
  await assert.rejects(
    renderOrderedFrames({
      durationInFrames: 300,
      workerCount: 2,
      chunkFrames: 60,
      createWorker: () => ({
        ready: Promise.resolve(),
        render: async () => {
          started++
        },
        close: async (abort) => {
          if (abort) aborted++
        },
      }),
      consume: async () => {
        throw new Error("encoder closed")
      },
    }),
    /encoder closed/,
  )
  assert.equal(started, 2)
  assert.equal(aborted, 2)
})

test("a later worker failure aborts even when the first range never completes", async () => {
  let aborted = 0
  const never = new Promise(() => {})
  await assert.rejects(
    renderOrderedFrames({
      durationInFrames: 300,
      workerCount: 2,
      chunkFrames: 60,
      createWorker: (id) => ({
        ready: Promise.resolve(),
        render: () =>
          id === 0 ? never : Promise.reject(new Error("later worker died")),
        close: async (abort) => {
          if (abort) aborted++
        },
      }),
      consume: () => assert.fail("no complete first range"),
    }),
    /later worker died/,
  )
  assert.equal(aborted, 2)
})

test("initialization failure closes every created worker", async () => {
  let closed = 0
  await assert.rejects(
    renderOrderedFrames({
      durationInFrames: 300,
      workerCount: 2,
      chunkFrames: 60,
      createWorker: (id) => ({
        ready:
          id === 0
            ? Promise.reject(new Error("browser failed"))
            : Promise.resolve(),
        close: async (abort) => {
          assert.equal(abort, true)
          closed++
        },
      }),
      consume: () => assert.fail("no initialized pool"),
    }),
    /browser failed/,
  )
  assert.equal(closed, 2)
})

test("successful frames still fail if worker cleanup fails", async () => {
  await assert.rejects(
    renderOrderedFrames({
      durationInFrames: 1,
      workerCount: 2,
      chunkFrames: 60,
      createWorker: () => ({
        ready: Promise.resolve(),
        render: async () => {},
        close: async () => {
          throw new Error("cleanup failed")
        },
      }),
      consume: async () => {},
    }),
    /cleanup failed/,
  )
})

test("encoder failure interrupts a stuck earlier frame without waiting for its deadline", async () => {
  const died = deferred()
  let closed = 0
  const pipeline = renderOrderedFrames({
    durationInFrames: 300,
    workerCount: 2,
    chunkFrames: 60,
    failure: died.promise,
    createWorker: () => ({
      ready: Promise.resolve(),
      render: () => new Promise(() => {}),
      close: async (abort) => {
        assert.equal(abort, true)
        closed++
      },
    }),
    consume: () => assert.fail("no frames ready"),
  })
  died.reject(new Error("encoder died"))
  await assert.rejects(pipeline, /encoder died/)
  assert.equal(closed, 2)
})

test("a completed worker dying interrupts its sibling's stuck earlier range", async () => {
  const died = deferred()
  const pipeline = renderOrderedFrames({
    durationInFrames: 300,
    workerCount: 2,
    chunkFrames: 60,
    createWorker: (id) => ({
      ready: Promise.resolve(),
      failed: died.promise,
      render: () => (id === 0 ? new Promise(() => {}) : Promise.resolve()),
      close: async () => {},
    }),
    consume: () => assert.fail("earlier range not ready"),
  })
  await setImmediate()
  died.reject(new Error("idle worker died"))
  await assert.rejects(pipeline, /idle worker died/)
})
