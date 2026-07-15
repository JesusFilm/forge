import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { BearerCheckResult } from "@/auth/search-bearer"

vi.mock("@/config/env", () => ({
  env: {} as {
    FLEET_SEARCH_GLOBAL_CEILING_PER_MIN: number
    FLEET_SEARCH_CEILING_ENFORCE: "true" | "false"
  },
}))

vi.mock("@/auth/rate-limit", () => ({
  incrementFixedWindow: vi.fn(),
}))

const { env } = await import("@/config/env")
const { incrementFixedWindow } = await import("@/auth/rate-limit")
const { checkFleetGlobalCeiling, shouldShedFleetRequest } =
  await import("./fleet-ceiling")

const envMutable = env as {
  FLEET_SEARCH_GLOBAL_CEILING_PER_MIN: number
  FLEET_SEARCH_CEILING_ENFORCE: "true" | "false"
}
const incrementMock = incrementFixedWindow as ReturnType<typeof vi.fn>

function logLines(spy: ReturnType<typeof vi.spyOn>): string[] {
  return spy.mock.calls.map((args) => String(args[0] ?? ""))
}

beforeEach(() => {
  envMutable.FLEET_SEARCH_GLOBAL_CEILING_PER_MIN = 10
  envMutable.FLEET_SEARCH_CEILING_ENFORCE = "true"
  incrementMock.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("checkFleetGlobalCeiling", () => {
  it("allows a request under the ceiling (redis)", async () => {
    incrementMock.mockResolvedValue({
      allowed: true,
      source: "redis",
      count: 5,
    })
    await expect(checkFleetGlobalCeiling("k", "graphql")).resolves.toEqual({
      overCeiling: false,
    })
  })

  it("blocks over the ceiling and logs .exceeded (redis, enforce on)", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    incrementMock.mockResolvedValue({
      allowed: false,
      source: "redis",
      count: 11,
    })
    await expect(checkFleetGlobalCeiling("k", "graphql")).resolves.toEqual({
      overCeiling: true,
    })
    expect(
      logLines(errSpy).some(
        (l) =>
          l.includes("event=fleet_ceiling.exceeded") && l.includes("rl=redis"),
      ),
    ).toBe(true)
  })

  it("logs .exceeded ONLY on the first-over (count === ceiling + 1)", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    incrementMock.mockResolvedValueOnce({
      allowed: false,
      source: "redis",
      count: 11,
    })
    await checkFleetGlobalCeiling("k", "graphql")
    incrementMock.mockResolvedValueOnce({
      allowed: false,
      source: "redis",
      count: 12,
    })
    await checkFleetGlobalCeiling("k", "graphql")
    expect(
      logLines(errSpy).filter((l) => l.includes("fleet_ceiling.exceeded"))
        .length,
    ).toBe(1)
  })

  it("logs .near ONLY on the exact redis threshold crossing (floor(ceiling*0.8))", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    for (const count of [7, 8, 9]) {
      incrementMock.mockResolvedValueOnce({
        allowed: true,
        source: "redis",
        count,
      })
      await checkFleetGlobalCeiling("k", "graphql")
    }
    expect(
      logLines(warnSpy).filter((l) => l.includes("fleet_ceiling.near")).length,
    ).toBe(1)
  })

  it("does NOT log .near on the local (sliding-window) source", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    // count 8 == floor(10*0.8), but source=local must be excluded (non-monotonic).
    incrementMock.mockResolvedValue({
      allowed: true,
      source: "local",
      count: 8,
    })
    await checkFleetGlobalCeiling("k", "graphql")
    expect(
      logLines(warnSpy).some((l) => l.includes("fleet_ceiling.near")),
    ).toBe(false)
  })

  it("honors the per-replica local cap when Redis is degraded (source=local)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    incrementMock.mockResolvedValue({
      allowed: false,
      source: "local",
      count: 11,
    })
    await expect(checkFleetGlobalCeiling("k", "rest")).resolves.toEqual({
      overCeiling: true,
    })
    expect(
      logLines(warnSpy).some(
        (l) =>
          l.includes("fleet_ceiling.degraded") && l.includes("blocked=true"),
      ),
    ).toBe(true)
  })

  it("does NOT block under the local cap (source=local, allowed)", async () => {
    incrementMock.mockResolvedValue({
      allowed: true,
      source: "local",
      count: 3,
    })
    await expect(checkFleetGlobalCeiling("k", "rest")).resolves.toEqual({
      overCeiling: false,
    })
  })

  it("computes + logs but does NOT block when enforcement is off", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    envMutable.FLEET_SEARCH_CEILING_ENFORCE = "false"
    incrementMock.mockResolvedValue({
      allowed: false,
      source: "redis",
      count: 11,
    })
    await expect(checkFleetGlobalCeiling("k", "graphql")).resolves.toEqual({
      overCeiling: false,
    })
    expect(
      logLines(errSpy).some((l) => l.includes("fleet_ceiling.exceeded")),
    ).toBe(true)
  })

  it("is a no-op kill-switch at ceiling 0 (no counter debit)", async () => {
    envMutable.FLEET_SEARCH_GLOBAL_CEILING_PER_MIN = 0
    await expect(checkFleetGlobalCeiling("k", "graphql")).resolves.toEqual({
      overCeiling: false,
    })
    expect(incrementMock).not.toHaveBeenCalled()
  })

  it("logs the fleetKeyId (matching the code identifier), never a raw key", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    incrementMock.mockResolvedValue({
      allowed: false,
      source: "redis",
      count: 11,
    })
    await checkFleetGlobalCeiling("keyid12chars", "graphql")
    expect([...logLines(warnSpy), ...logLines(errSpy)].join("\n")).toContain(
      "fleetKeyId=keyid12chars",
    )
  })
})

describe("shouldShedFleetRequest", () => {
  it("returns false and does not debit for a non-fleet consumer bearer", async () => {
    const auth: BearerCheckResult = { valid: true, source: "consumer" }
    await expect(shouldShedFleetRequest(auth, "graphql")).resolves.toBe(false)
    expect(incrementMock).not.toHaveBeenCalled()
  })

  it("returns false for an invalid bearer", async () => {
    const auth: BearerCheckResult = { valid: false }
    await expect(shouldShedFleetRequest(auth, "rest")).resolves.toBe(false)
    expect(incrementMock).not.toHaveBeenCalled()
  })

  it("loud-degrades (false + logs) when a fleet result lacks a fleetKeyId", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    const auth: BearerCheckResult = { valid: true, source: "fleet" }
    await expect(shouldShedFleetRequest(auth, "rest")).resolves.toBe(false)
    expect(incrementMock).not.toHaveBeenCalled()
    expect(
      logLines(errSpy).some((l) =>
        l.includes("fleet_ceiling.missing_key_id path=rest"),
      ),
    ).toBe(true)
  })

  it("sheds (true) a fleet request over the ceiling", async () => {
    incrementMock.mockResolvedValue({
      allowed: false,
      source: "redis",
      count: 11,
    })
    const auth: BearerCheckResult = {
      valid: true,
      source: "fleet",
      fleetKeyId: "abc123def456",
    }
    await expect(shouldShedFleetRequest(auth, "graphql")).resolves.toBe(true)
    expect(incrementMock).toHaveBeenCalledWith(
      "fleet-global:abc123def456",
      10,
      60_000,
    )
  })

  it("passes (false) a fleet request under the ceiling", async () => {
    incrementMock.mockResolvedValue({
      allowed: true,
      source: "redis",
      count: 3,
    })
    const auth: BearerCheckResult = {
      valid: true,
      source: "fleet",
      fleetKeyId: "abc123def456",
    }
    await expect(shouldShedFleetRequest(auth, "rest")).resolves.toBe(false)
  })

  it("loud-degrades (false + logs error) when the ceiling check throws", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    incrementMock.mockRejectedValue(new Error("boom"))
    const auth: BearerCheckResult = {
      valid: true,
      source: "fleet",
      fleetKeyId: "abc123def456",
    }
    await expect(shouldShedFleetRequest(auth, "graphql")).resolves.toBe(false)
    expect(
      logLines(errSpy).some((l) => l.includes("fleet_ceiling.error")),
    ).toBe(true)
  })
})
