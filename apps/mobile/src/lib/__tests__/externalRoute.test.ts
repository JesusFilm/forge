import { isExternalRouteActive } from "../externalRoute"

describe("isExternalRouteActive", () => {
  it("is false while no external route is active", () => {
    expect(isExternalRouteActive({ airPlayActive: false })).toBe(false)
  })

  it("is true while AirPlay is active", () => {
    expect(isExternalRouteActive({ airPlayActive: true })).toBe(true)
  })
})
