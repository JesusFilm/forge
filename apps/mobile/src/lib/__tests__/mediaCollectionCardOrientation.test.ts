import { resolveMediaCollectionCardOrientation } from "../mediaCollectionCardOrientation"

describe("resolveMediaCollectionCardOrientation", () => {
  it.each(["horizontal", "vertical"] as const)(
    "uses an explicit %s orientation",
    (orientation) => {
      expect(
        resolveMediaCollectionCardOrientation(orientation, "vertical"),
      ).toBe(orientation)
    },
  )

  it.each([undefined, null, "unknown"])(
    "preserves the legacy fallback for %s",
    (orientation) => {
      expect(
        resolveMediaCollectionCardOrientation(orientation, "horizontal"),
      ).toBe("horizontal")
    },
  )
})
