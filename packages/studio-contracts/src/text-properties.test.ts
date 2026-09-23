import { expect, it } from "vitest"
import { studioTextPropertiesSchema } from "./index"

it("keeps legacy properties unchanged and accepts independent readability and motion controls", () => {
  expect(studioTextPropertiesSchema.parse({})).toEqual({})
  const properties = {
    fontFamily: "Inter",
    fontWeight: 600,
    shadow: true,
    shadowBlur: 8,
    shadowOffset: 3,
    strokeWidth: 2,
    strokeColor: "#000000",
    scrimOpacity: 0.6,
    scrimPadding: 16,
    entrance: "slide",
    entranceFrames: 9,
    exit: "fade",
    exitFrames: 12,
  }
  expect(studioTextPropertiesSchema.parse(properties)).toEqual(properties)
  expect(
    studioTextPropertiesSchema.parse({ fontFamily: "legacy-font" }),
  ).toEqual({ fontFamily: "legacy-font" })
})

it.each([
  { shadow: "yes" },
  { shadowBlur: -1 },
  { shadowOffset: 101 },
  { strokeWidth: 21 },
  { strokeColor: "url(x)" },
  { scrimOpacity: 1.1 },
  { scrimPadding: -1 },
  { entrance: "unknown" },
  { exitFrames: 0 },
  { entranceFrames: 2.5 },
  { entranceFrames: 301 },
])("rejects malformed or out-of-range text settings: %j", (properties) => {
  expect(studioTextPropertiesSchema.safeParse(properties).success).toBe(false)
})
