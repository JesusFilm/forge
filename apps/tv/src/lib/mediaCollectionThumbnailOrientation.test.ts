import { resolveMediaCollectionThumbnailOrientation } from "./mediaCollectionThumbnailOrientation"

describe("resolveMediaCollectionThumbnailOrientation", () => {
  it.each(["horizontal", "vertical"] as const)(
    "uses an explicit %s orientation",
    (orientation) => {
      expect(
        resolveMediaCollectionThumbnailOrientation(orientation, "vertical"),
      ).toBe(orientation)
    },
  )

  it.each([undefined, null, "unknown"])(
    "preserves the legacy fallback for %s",
    (orientation) => {
      expect(
        resolveMediaCollectionThumbnailOrientation(orientation, "horizontal"),
      ).toBe("horizontal")
    },
  )
})
