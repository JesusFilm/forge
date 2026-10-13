import { concepts } from "./model"
import {
  TOP_SHELF_PREVIEW_OPTIONS,
  topShelfPreviewEnabled,
  parseTopShelfPreviewStyle,
  shelfConceptForPreview,
} from "./preview"

it("offers Automatic and exactly the five supported styles", () => {
  expect(TOP_SHELF_PREVIEW_OPTIONS.map((option) => option.value)).toEqual([
    "automatic",
    ...concepts,
  ])
})

it("enables previews only on Apple TV with an explicit beta build flag", () => {
  expect(topShelfPreviewEnabled(undefined, "ios", true)).toBe(false)
  expect(topShelfPreviewEnabled("false", "ios", true)).toBe(false)
  expect(topShelfPreviewEnabled("true", "android", true)).toBe(false)
  expect(topShelfPreviewEnabled("true", "ios", false)).toBe(false)
  expect(topShelfPreviewEnabled("true", "ios", true)).toBe(true)
  expect(topShelfPreviewEnabled("1", "ios", true)).toBe(true)
})

it("falls back safely when a stored choice is corrupt", () => {
  expect(parseTopShelfPreviewStyle("journey")).toBe("journey")
  expect(parseTopShelfPreviewStyle("automatic")).toBe("automatic")
  expect(parseTopShelfPreviewStyle("bad")).toBe("automatic")
  expect(parseTopShelfPreviewStyle(null)).toBe("automatic")
})

it("uses an eligible preview without changing the automatic choice", () => {
  expect(
    shelfConceptForPreview(["spotlight", "short"], "spotlight", "short"),
  ).toBe("short")
  expect(
    shelfConceptForPreview(["spotlight", "short"], "spotlight", "automatic"),
  ).toBe("spotlight")
})

it("never fabricates unavailable content or history", () => {
  expect(shelfConceptForPreview(["spotlight"], "spotlight", "continue")).toBe(
    "spotlight",
  )
  expect(shelfConceptForPreview([], undefined, "journey")).toBeUndefined()
})
