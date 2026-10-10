import { describe, expect, it } from "vitest"

import { fleetKeyIdFromRawKey } from "./fleet-key-id"

describe("fleetKeyIdFromRawKey", () => {
  it("returns a 12-char lowercase hex id", () => {
    expect(fleetKeyIdFromRawKey("fleet-key-zzz")).toMatch(/^[0-9a-f]{12}$/)
  })

  it("is stable for the same input", () => {
    expect(fleetKeyIdFromRawKey("k")).toBe(fleetKeyIdFromRawKey("k"))
  })

  it("distinguishes distinct keys (tv vs mobile)", () => {
    expect(fleetKeyIdFromRawKey("tv-key")).not.toBe(
      fleetKeyIdFromRawKey("mobile-key"),
    )
  })

  it("never reveals the raw key", () => {
    const raw = "super-secret-fleet-key"
    const id = fleetKeyIdFromRawKey(raw)
    expect(id).not.toBe(raw)
    expect(raw).not.toContain(id)
    expect(id).not.toContain(raw)
  })
})
