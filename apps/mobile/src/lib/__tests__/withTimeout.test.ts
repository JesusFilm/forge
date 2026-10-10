import { withTimeout } from "../withTimeout"

describe("withTimeout", () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  it("resolves with the value when the promise settles before the deadline", async () => {
    await expect(withTimeout(Promise.resolve("ok"), 1000)).resolves.toBe("ok")
  })

  it("rejects once the promise outlives the deadline (the hung-call cap)", async () => {
    const raced = withTimeout(new Promise<never>(() => {}), 100)
    jest.advanceTimersByTime(100)
    await expect(raced).rejects.toThrow("Resolution timed out")
  })

  it("propagates the promise's own rejection reached before the deadline", async () => {
    await expect(
      withTimeout(Promise.reject(new Error("boom")), 1000),
    ).rejects.toThrow("boom")
  })

  it("rejects with Aborted when the signal aborts before the deadline", async () => {
    const controller = new AbortController()
    const raced = withTimeout(
      new Promise<never>(() => {}),
      1000,
      controller.signal,
    )
    controller.abort()
    await expect(raced).rejects.toThrow("Aborted")
  })

  it("rejects immediately for an already-aborted signal", async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      withTimeout(new Promise<never>(() => {}), 1000, controller.signal),
    ).rejects.toThrow("Aborted")
  })
})
