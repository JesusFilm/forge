import { mapWithConcurrency } from "../concurrentMap"

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms))

describe("mapWithConcurrency", () => {
  it("caps concurrency and preserves input order", async () => {
    let running = 0
    let maxRunning = 0
    const items = Array.from({ length: 10 }, (_, i) => i)
    const results = await mapWithConcurrency(items, 4, async (n) => {
      running += 1
      maxRunning = Math.max(maxRunning, running)
      await tick(5)
      running -= 1
      return n * 2
    })
    expect(maxRunning).toBeLessThanOrEqual(4)
    expect(maxRunning).toBeGreaterThan(1)
    expect(
      results.map((r) => (r.status === "fulfilled" ? r.value : null)),
    ).toEqual(items.map((n) => n * 2))
  })

  it("settles a synchronous throw as rejected without stalling siblings", async () => {
    const results = await mapWithConcurrency([1, 2, 3], 2, (n) => {
      if (n === 2) throw new Error("sync boom")
      return Promise.resolve(n)
    })
    expect(results[0]).toEqual({ status: "fulfilled", value: 1 })
    expect(results[1].status).toBe("rejected")
    expect(results[2]).toEqual({ status: "fulfilled", value: 3 })
  })

  it("settles an async rejection without failing the batch", async () => {
    const results = await mapWithConcurrency([1, 2, 3], 3, async (n) => {
      if (n === 2) throw new Error("async boom")
      return n
    })
    expect(results[0].status).toBe("fulfilled")
    expect(results[1].status).toBe("rejected")
    expect(results[2].status).toBe("fulfilled")
  })

  it("does not call fn when the signal is already aborted", async () => {
    const ctrl = new AbortController()
    ctrl.abort()
    const fn = jest.fn(async (n: number) => n)
    const results = await mapWithConcurrency([1, 2, 3], 2, fn, ctrl.signal)
    expect(fn).not.toHaveBeenCalled()
    expect(results.every((r) => r.status === "rejected")).toBe(true)
  })

  it("starts no new items and rejects in-flight once aborted mid-run", async () => {
    const ctrl = new AbortController()
    const started: number[] = []
    const pending = mapWithConcurrency(
      [1, 2, 3, 4, 5, 6],
      2,
      async (n) => {
        started.push(n)
        await tick(50)
        return n
      },
      ctrl.signal,
    )
    await tick(10) // let the first `cap` items start, none complete yet
    ctrl.abort()
    const results = await pending
    expect(started).toEqual([1, 2]) // only the first cap ever started
    expect(results.every((r) => r.status === "rejected")).toBe(true)
  })

  it("returns an empty array for empty input", async () => {
    expect(await mapWithConcurrency([], 4, async (x) => x)).toEqual([])
  })
})
