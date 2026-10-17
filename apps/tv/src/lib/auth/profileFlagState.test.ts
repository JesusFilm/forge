import { resolveProfileSurfaceEnabled } from "./profileFlagState"

describe("resolveProfileSurfaceEnabled", () => {
  it("hides Profile in development builds", () => {
    expect(resolveProfileSurfaceEnabled(true, undefined)).toBe(false)
    expect(resolveProfileSurfaceEnabled(true, "1")).toBe(false)
  })

  it("hides Profile in release builds even when the old opt-in is set", () => {
    expect(resolveProfileSurfaceEnabled(false, undefined)).toBe(false)
    expect(resolveProfileSurfaceEnabled(false, "1")).toBe(false)
    expect(resolveProfileSurfaceEnabled(false, "true")).toBe(false)
  })
})
