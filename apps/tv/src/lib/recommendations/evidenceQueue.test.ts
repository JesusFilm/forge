import { createEvidenceQueue } from "./evidenceQueue"

const settle = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve()
}
beforeEach(() => jest.useFakeTimers())
afterEach(() => jest.useRealTimers())

it("retries the identical event IDs, timestamps and payload, respecting backoff", async () => {
  const send = jest
    .fn()
    .mockRejectedValueOnce(new Error("timeout"))
    .mockResolvedValue(undefined)
  const queue = createEvidenceQueue({
    send,
    retryable: () => true,
    now: Date.now,
  })
  const event = {
    eventId: "immutable",
    occurredAt: "2026-10-02T00:00:00.000Z",
    payload: { activeMilliseconds: 1000 },
  }
  queue.push([event])
  await settle()
  queue.push([{ ...event, eventId: "next" }])
  await settle()
  expect(send).toHaveBeenCalledTimes(1)
  jest.advanceTimersByTime(999)
  await settle()
  expect(send).toHaveBeenCalledTimes(1)
  jest.advanceTimersByTime(1)
  await settle()
  expect(send.mock.calls[1][0]).toBe(send.mock.calls[0][0])
  expect(send.mock.calls[1][0][0]).toBe(event)
  expect(send).toHaveBeenCalledTimes(3)
})
it("uses three serialized attempts with a longer final recovery window", async () => {
  const send = jest.fn().mockRejectedValue(new Error("unavailable"))
  const failed = jest.fn()
  const queue = createEvidenceQueue({
    send,
    retryable: () => true,
    now: Date.now,
    failed,
  })
  queue.push(["fact"])
  await settle()
  jest.advanceTimersByTime(1000)
  await settle()
  expect(send).toHaveBeenCalledTimes(2)
  jest.advanceTimersByTime(7999)
  await settle()
  expect(send).toHaveBeenCalledTimes(2)
  jest.advanceTimersByTime(1)
  await settle()
  expect(send).toHaveBeenCalledTimes(3)
  expect(failed).toHaveBeenCalledTimes(1)
  queue.push(["new-fact"])
  jest.advanceTimersByTime(60000)
  await settle()
  expect(send).toHaveBeenCalledTimes(3)
})
it("does not retry a definitive authentication or binding rejection", async () => {
  const send = jest.fn().mockRejectedValue(new Error("binding"))
  const queue = createEvidenceQueue({
    send,
    retryable: () => false,
    now: Date.now,
  })
  queue.push(["fact"])
  await settle()
  jest.advanceTimersByTime(30000)
  await settle()
  expect(send).toHaveBeenCalledTimes(1)
})
it("stops queued work and retries on privacy retirement", async () => {
  const send = jest.fn().mockRejectedValue(new Error("timeout"))
  const queue = createEvidenceQueue({
    send,
    retryable: () => true,
    now: Date.now,
  })
  queue.push(["fact"])
  await settle()
  queue.retire()
  jest.advanceTimersByTime(30000)
  queue.push(["stale"])
  await settle()
  expect(send).toHaveBeenCalledTimes(1)
})
it("batches no more than sixteen facts and serializes acknowledgements", async () => {
  const send = jest.fn().mockResolvedValue(undefined)
  const queue = createEvidenceQueue({
    send,
    retryable: () => false,
    now: Date.now,
  })
  queue.push(Array.from({ length: 35 }, (_, index) => index))
  await settle()
  expect(send.mock.calls.map((call) => call[0].length)).toEqual([16, 16, 3])
})
