import { resolveProfileSurfaceEnabled } from "./profileFlagState"

describe("resolveProfileSurfaceEnabled", () => {
  it("is on in dev builds regardless of the flag", () => {
    expect(resolveProfileSurfaceEnabled(true, undefined)).toBe(true)
    expect(resolveProfileSurfaceEnabled(true, "0")).toBe(true)
  })

  it('accepts both "1" and "true" in release builds', () => {
    // Both spellings, deliberately: the first TestFlight build shipped with
    // the surface invisibly dark because the operator wrote `true` into EAS
    // while the gate accepted only "1". The mismatch cannot be caught by any
    // build-time check — it surfaces only in front of a real TV.
    expect(resolveProfileSurfaceEnabled(false, "1")).toBe(true)
    expect(resolveProfileSurfaceEnabled(false, "true")).toBe(true)
  })

  it("is off in release builds when the flag is unset or anything else", () => {
    // Opt-in gate, not a boolean parser: unknown spellings fail CLOSED.
    expect(resolveProfileSurfaceEnabled(false, undefined)).toBe(false)
    expect(resolveProfileSurfaceEnabled(false, "")).toBe(false)
    expect(resolveProfileSurfaceEnabled(false, "0")).toBe(false)
    expect(resolveProfileSurfaceEnabled(false, "false")).toBe(false)
    expect(resolveProfileSurfaceEnabled(false, "TRUE")).toBe(false)
    expect(resolveProfileSurfaceEnabled(false, "yes")).toBe(false)
  })
})
