import { describe, expect, it } from "vitest"

import {
  WATCH_MODAL_COLLECTION_WIDTH_CLASS,
  WATCH_MODAL_FILM_WIDTH_CLASS,
} from "@/components/watch/watch-modal-presentation"

// Fixed close button: `right: max(1rem, ...)` and `w-12` (3rem). A dialog is
// centred, so each side needs the whole close footprint free.
const CLOSE_FOOTPRINT_REM = 1 + 3

function gutterRem(widthClass: string): number {
  const match =
    /sm:max-w-\[min\(\d+px,calc\(100vw-(\d+(?:\.\d+)?)rem\)\)\]/.exec(
      widthClass,
    )
  expect(match, widthClass).not.toBeNull()
  return Number(match?.[1])
}

describe("watch modal close gutter", () => {
  it.each([
    ["film", WATCH_MODAL_FILM_WIDTH_CLASS],
    ["collection", WATCH_MODAL_COLLECTION_WIDTH_CLASS],
  ])("%s dialog leaves both sides clear of the fixed close button", (_n, c) => {
    expect(gutterRem(c)).toBeGreaterThanOrEqual(CLOSE_FOOTPRINT_REM * 2)
  })

  it("keeps the narrow-screen widths below sm unchanged", () => {
    expect(WATCH_MODAL_FILM_WIDTH_CLASS).toContain("max-w-[min(90vw,608px)]")
    expect(WATCH_MODAL_COLLECTION_WIDTH_CLASS).toContain(
      "max-w-[min(94vw,960px)]",
    )
  })
})
