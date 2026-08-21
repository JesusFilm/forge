import { describe, expect, it } from "vitest"

import { normalizeWebReturnTo } from "./return-to"

describe("normalizeWebReturnTo", () => {
  const input = {
    requestOrigin: "https://preview.example.test",
    allowedOrigins: ["https://preview.example.test"],
  }

  it("retains only the relative Watch path, query, and fragment", () => {
    expect(
      normalizeWebReturnTo("/watch/jesus/english?ref=playlist#scene", input),
    ).toBe("/watch/jesus/english?ref=playlist#scene")
  })

  it.each([
    "https://preview.example.test/watch/jesus/english",
    "//attacker.example.test/watch",
    "/%2f%2fattacker.example.test/watch",
    "/watch%2fapi%2fauth%2fcallback",
    "/watch/api/download",
  ])("rejects non-relative, encoded, and API return target %s", (value) => {
    expect(normalizeWebReturnTo(value, input)).toBeUndefined()
  })
})
