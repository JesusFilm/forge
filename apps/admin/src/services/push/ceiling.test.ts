import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/config/env", () => ({
  env: {} as {
    PUSH_REGISTRATION_CEILING_PER_MIN: number
    PUSH_OPEN_CEILING_PER_MIN: number
    PUSH_CEILING_ENFORCE: "true" | "false"
  },
}))

vi.mock("@/auth/rate-limit", () => ({
  incrementFixedWindow: vi.fn(),
}))

const { env } = await import("@/config/env")
const { incrementFixedWindow } = await import("@/auth/rate-limit")
const { PushCeilingExceededError } = await import("./errors")
const { assertPushCeiling, checkPushCeiling } = await import("./ceiling")

const envMutable = env as unknown as {
  PUSH_REGISTRATION_CEILING_PER_MIN: number
  PUSH_OPEN_CEILING_PER_MIN: number
  PUSH_CEILING_ENFORCE: "true" | "false"
}
const incrementMock = incrementFixedWindow as ReturnType<typeof vi.fn>

function logLines(spy: ReturnType<typeof vi.spyOn>): string[] {
  return spy.mock.calls.map((args) => String(args[0] ?? ""))
}

beforeEach(() => {
  envMutable.PUSH_REGISTRATION_CEILING_PER_MIN = 10
  envMutable.PUSH_OPEN_CEILING_PER_MIN = 20
  envMutable.PUSH_CEILING_ENFORCE = "true"
  incrementMock.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("checkPushCeiling", () => {
  it("allows a request under the ceiling", async () => {
    incrementMock.mockResolvedValue({
      allowed: true,
      source: "redis",
      count: 3,
    })
    await expect(checkPushCeiling("register", "key1")).resolves.toEqual({
      overCeiling: false,
    })
  })

  it("counts each operation in its own bucket at its own ceiling", async () => {
    incrementMock.mockResolvedValue({
      allowed: true,
      source: "redis",
      count: 1,
    })
    await checkPushCeiling("register", "key1")
    await checkPushCeiling("open", "key1")
    expect(incrementMock.mock.calls[0][0]).toBe("push-register:key1")
    expect(incrementMock.mock.calls[0][1]).toBe(10)
    expect(incrementMock.mock.calls[1][0]).toBe("push-open:key1")
    expect(incrementMock.mock.calls[1][1]).toBe(20)
  })

  it("blocks over the ceiling and logs the first crossing", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    incrementMock.mockResolvedValue({
      allowed: false,
      source: "redis",
      count: 11,
    })
    await expect(checkPushCeiling("register", "key1")).resolves.toEqual({
      overCeiling: true,
    })
    expect(logLines(errSpy).join("\n")).toContain(
      "[push] event=ceiling.exceeded op=register fleetKeyId=key1",
    )
  })

  it("logs only once per window, on the crossing count", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    incrementMock.mockResolvedValue({
      allowed: false,
      source: "redis",
      count: 12,
    })
    await checkPushCeiling("register", "key1")
    expect(logLines(errSpy)).toEqual([])
  })

  it("logs but allows when enforcement is off", async () => {
    envMutable.PUSH_CEILING_ENFORCE = "false"
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    incrementMock.mockResolvedValue({
      allowed: false,
      source: "redis",
      count: 11,
    })
    await expect(checkPushCeiling("register", "key1")).resolves.toEqual({
      overCeiling: false,
    })
    expect(logLines(errSpy).join("\n")).toContain(
      "[push] event=ceiling.exceeded op=register",
    )
    expect(logLines(errSpy).join("\n")).toContain("enforce=false")
  })

  it("is disabled by a ceiling of zero, with no counter debited", async () => {
    envMutable.PUSH_OPEN_CEILING_PER_MIN = 0
    await expect(checkPushCeiling("open", "key1")).resolves.toEqual({
      overCeiling: false,
    })
    expect(incrementMock).not.toHaveBeenCalled()
  })

  it("honours the per-replica cap when redis is degraded", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    incrementMock.mockResolvedValue({
      allowed: false,
      source: "local",
      count: 11,
    })
    await expect(checkPushCeiling("register", "key1")).resolves.toEqual({
      overCeiling: true,
    })
    expect(logLines(warnSpy).join("\n")).toContain(
      "[push] event=ceiling.degraded op=register",
    )
  })

  it("warns near the ceiling only on the redis path", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    incrementMock.mockResolvedValue({
      allowed: true,
      source: "redis",
      count: 8,
    })
    await checkPushCeiling("register", "key1")
    expect(logLines(warnSpy).join("\n")).toContain(
      "[push] event=ceiling.near op=register",
    )
  })
})

describe("assertPushCeiling", () => {
  it("passes a caller with no fleet key id straight through", async () => {
    await expect(assertPushCeiling("register", null)).resolves.toBeUndefined()
    expect(incrementMock).not.toHaveBeenCalled()
  })

  it("throws the typed refusal over the ceiling", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    incrementMock.mockResolvedValue({
      allowed: false,
      source: "redis",
      count: 11,
    })
    await expect(assertPushCeiling("register", "key1")).rejects.toThrowError(
      PushCeilingExceededError,
    )
  })

  it("allows the request when a ceiling read fails", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    incrementMock.mockRejectedValue(new Error("redis down"))
    await expect(assertPushCeiling("open", "key1")).resolves.toBeUndefined()
    expect(logLines(errSpy).join("\n")).toContain(
      "[push] event=ceiling.error op=open",
    )
  })

  it("never logs the fleet key's raw value", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    incrementMock.mockResolvedValue({
      allowed: false,
      source: "redis",
      count: 11,
    })
    await expect(
      assertPushCeiling("register", "fleetkeyid1234"),
    ).rejects.toThrowError(PushCeilingExceededError)
    const combined = [...logLines(errSpy), ...logLines(warnSpy)].join("\n")
    expect(combined).toContain("fleetKeyId=fleetkeyid1234")
    expect(combined).not.toContain("Bearer")
  })
})
