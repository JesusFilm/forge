import { isExternalRouteActive } from "../externalRoute"

describe("isExternalRouteActive", () => {
  it("is false while no external route is active", () => {
    expect(
      isExternalRouteActive({ airPlayActive: false, castActive: false }),
    ).toBe(false)
  })

  it("is true while AirPlay is active", () => {
    expect(
      isExternalRouteActive({ airPlayActive: true, castActive: false }),
    ).toBe(true)
  })

  it("is true while a cast session occupies the player (U4)", () => {
    expect(
      isExternalRouteActive({ airPlayActive: false, castActive: true }),
    ).toBe(true)
  })

  it("is true while both routes report active (KTD9 transition window)", () => {
    expect(
      isExternalRouteActive({ airPlayActive: true, castActive: true }),
    ).toBe(true)
  })
})
