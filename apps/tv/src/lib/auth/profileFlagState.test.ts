import { resolveProfileSurfaceEnabled } from "./profileFlagState"

describe("resolveProfileSurfaceEnabled", () => {
  it("is on in dev builds regardless of the flag", () => {
    expect(resolveProfileSurfaceEnabled(true, undefined)).toBe(true)
    expect(resolveProfileSurfaceEnabled(true, "0")).toBe(true)
  })

  it('is on in release builds only when the flag is exactly "1"', () => {
    expect(resolveProfileSurfaceEnabled(false, "1")).toBe(true)
  })

  it("is off in release builds when the flag is unset or anything else", () => {
    expect(resolveProfileSurfaceEnabled(false, undefined)).toBe(false)
    expect(resolveProfileSurfaceEnabled(false, "")).toBe(false)
    expect(resolveProfileSurfaceEnabled(false, "true")).toBe(false)
    expect(resolveProfileSurfaceEnabled(false, "0")).toBe(false)
  })
})
