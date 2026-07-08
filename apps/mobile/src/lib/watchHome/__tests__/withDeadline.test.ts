import { withDeadline } from "../withDeadline"

describe("withDeadline", () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  it("resolves with the value when the promise settles before the deadline", async () => {
    await expect(withDeadline(Promise.resolve("ok"), 1000)).resolves.toBe("ok")
  })

  it("rejects once the promise outlives the deadline (the hung-query cap)", async () => {
    const raced = withDeadline(new Promise<never>(() => {}), 100)
    jest.advanceTimersByTime(100)
    await expect(raced).rejects.toThrow("deadline-exceeded")
  })

  it("propagates the promise's own rejection reached before the deadline", async () => {
    await expect(
      withDeadline(Promise.reject(new Error("boom")), 1000),
    ).rejects.toThrow("boom")
  })
})
