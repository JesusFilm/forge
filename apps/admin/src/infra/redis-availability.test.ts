import { afterEach, expect, it, vi } from "vitest"
import { createRedisOperationGuard } from "./redis-availability"

afterEach(() => vi.useRealTimers())

it("bounds observation but retains capacity until the wire operation settles", async () => {
  vi.useFakeTimers()
  const run = createRedisOperationGuard(500, 1)
  let finish!: (value: string) => void
  const pending = run(
    () =>
      new Promise<string>((resolve) => {
        finish = resolve
      }),
  )
  const rejected = expect(pending).rejects.toThrow("Redis operation timed out")
  await vi.advanceTimersByTimeAsync(500)
  await rejected
  const next = vi.fn(async () => "PONG")
  await expect(run(next)).rejects.toThrow("Redis operation capacity exceeded")
  expect(next).not.toHaveBeenCalled()
  finish("late")
  await vi.advanceTimersByTimeAsync(0)
  await expect(run(next)).resolves.toBe("PONG")
})

it("releases capacity on failure without leaving an unhandled late rejection", async () => {
  vi.useFakeTimers()
  const run = createRedisOperationGuard(500, 1)
  let fail!: (error: Error) => void
  const pending = run(
    () =>
      new Promise<never>((_resolve, reject) => {
        fail = reject
      }),
  )
  const rejected = expect(pending).rejects.toThrow("timed out")
  await vi.advanceTimersByTimeAsync(500)
  await rejected
  fail(new Error("connection closed"))
  await vi.advanceTimersByTimeAsync(0)
  await expect(run(async () => 42)).resolves.toBe(42)
})

it("releases capacity after synchronous failure and successful concurrent operations", async () => {
  const run = createRedisOperationGuard(500, 2)
  await expect(
    run(() => {
      throw new Error("unavailable")
    }),
  ).rejects.toThrow("unavailable")
  await expect(
    Promise.all([run(async () => 1), run(async () => 2)]),
  ).resolves.toEqual([1, 2])
})
