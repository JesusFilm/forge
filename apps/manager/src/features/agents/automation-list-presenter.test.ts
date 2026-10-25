import { describe, expect, it } from "vitest"

import { formatLanguageSummary } from "./automation-list-presenter"

describe("formatLanguageSummary", () => {
  it("uses readable language labels with core id fallback", () => {
    const labels = new Map([
      ["529", "Ελληνικά"],
      ["6414", "Русский"],
    ])

    expect(formatLanguageSummary(["529", "unknown"], labels)).toBe(
      "Ελληνικά, unknown",
    )
  })

  it("reports none when no target languages are selected", () => {
    expect(formatLanguageSummary([], new Map())).toBe("None")
  })
})
