import { describe, expect, it, vi } from "vitest"
import {
  isPrismaPoolTimeoutError,
  withPrismaPoolTimeoutRetry,
} from "./pool-timeout-retry"

function prismaPoolTimeout(message = "pool exhausted") {
  return Object.assign(new Error(message), { code: "P2024" })
}

describe("isPrismaPoolTimeoutError", () => {
  it("matches Prisma P2024 typed errors", () => {
    expect(isPrismaPoolTimeoutError(prismaPoolTimeout())).toBe(true)
  })

  it("matches the Prisma pool timeout message fallback", () => {
    expect(
      isPrismaPoolTimeoutError(
        new Error(
          "Timed out fetching a new connection from the connection pool.",
        ),
      ),
    ).toBe(true)
  })

  it("does not match unrelated errors", () => {
    expect(isPrismaPoolTimeoutError(new Error("record not found"))).toBe(false)
  })
})

describe("withPrismaPoolTimeoutRetry", () => {
  it("retries P2024 pool timeouts until the operation succeeds", async () => {
    const run = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(prismaPoolTimeout())
      .mockResolvedValueOnce("ok")
    const sleep = vi.fn(async () => undefined)
    const onRetry = vi.fn()

    await expect(
      withPrismaPoolTimeoutRetry(run, {
        operation: "core-sync.test",
        sleep,
        onRetry,
      }),
    ).resolves.toBe("ok")

    expect(run).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledWith(1_000)
    expect(onRetry).toHaveBeenCalledWith({
      operation: "core-sync.test",
      attempt: 1,
      nextAttempt: 2,
      delayMs: 1_000,
    })
  })

  it("rethrows the final P2024 after attempts are exhausted", async () => {
    const finalError = prismaPoolTimeout("still exhausted")
    const run = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(prismaPoolTimeout())
      .mockRejectedValueOnce(finalError)

    await expect(
      withPrismaPoolTimeoutRetry(run, {
        operation: "core-sync.test",
        maxAttempts: 2,
        sleep: vi.fn(async () => undefined),
        onRetry: vi.fn(),
      }),
    ).rejects.toBe(finalError)

    expect(run).toHaveBeenCalledTimes(2)
  })

  it("does not retry non-pool errors", async () => {
    const error = new Error("validation failed")
    const run = vi.fn<() => Promise<string>>().mockRejectedValueOnce(error)
    const sleep = vi.fn(async () => undefined)

    await expect(
      withPrismaPoolTimeoutRetry(run, {
        operation: "core-sync.test",
        sleep,
        onRetry: vi.fn(),
      }),
    ).rejects.toBe(error)

    expect(run).toHaveBeenCalledTimes(1)
    expect(sleep).not.toHaveBeenCalled()
  })
})
