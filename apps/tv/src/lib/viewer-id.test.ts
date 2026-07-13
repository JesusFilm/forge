import { getViewerId, uuidV4Fallback } from "./viewer-id"

describe("getViewerId", () => {
  it("returns a stable id across calls within a launch", () => {
    const first = getViewerId()
    expect(getViewerId()).toBe(first)
  })

  it("generates an admin-sanitizer-safe id (charset + length)", () => {
    // Must satisfy admin's sanitizeViewerId (/^[A-Za-z0-9._-]{1,64}$/) or admin
    // drops it and falls back to IP bucketing.
    expect(getViewerId()).toMatch(/^[A-Za-z0-9._-]{1,64}$/)
  })
})

describe("uuidV4Fallback (Hermes path)", () => {
  it("produces an RFC4122 v4 UUID", () => {
    expect(uuidV4Fallback()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
  })

  it("is admin-sanitizer-safe", () => {
    expect(uuidV4Fallback()).toMatch(/^[A-Za-z0-9._-]{1,64}$/)
  })

  it("produces distinct ids across many calls (per-install uniqueness)", () => {
    // The Hermes path runs in prod; a gross Math.random correlation would collide
    // ids and silently merge two devices' buckets.
    const ids = new Set(Array.from({ length: 1000 }, () => uuidV4Fallback()))
    expect(ids.size).toBe(1000)
  })
})
