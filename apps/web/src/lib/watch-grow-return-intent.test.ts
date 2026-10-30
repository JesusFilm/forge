import { describe, expect, it } from "vitest"
import { hasWatchGrowReturnIntent } from "./watch-grow-return-intent"

describe("course return intent without loading curriculum", () => {
  it("recognises all nine lesson identities", () => {
    for (let lesson = 1; lesson <= 9; lesson += 1) {
      expect(
        hasWatchGrowReturnIntent(
          `https://watch.test/watch?growLesson=lesson-${lesson}`,
        ),
      ).toBe(true)
    }
  })
  it("leaves unknown lessons and ordinary entry closed", () => {
    for (const value of [
      "",
      "lesson-0",
      "lesson-10",
      "lesson-01",
      "../lesson-1",
    ]) {
      expect(
        hasWatchGrowReturnIntent(
          `https://watch.test/watch?growLesson=${value}`,
        ),
      ).toBe(false)
    }
  })
  it("leaves card validation to the deferred course after a valid lesson intent", () => {
    expect(
      hasWatchGrowReturnIntent(
        "https://watch.test/watch?growLesson=lesson-1&growCard=retired",
      ),
    ).toBe(true)
  })
  it("fails closed for a malformed address", () => {
    expect(hasWatchGrowReturnIntent("not an address")).toBe(false)
  })
})
