import { describe, expect, it } from "vitest"

import { RecommendationRuntimeError } from "./recommendation-errors"

describe("RecommendationRuntimeError", () => {
  it("keeps a typed stable code without exposing upstream details", () => {
    const error = new RecommendationRuntimeError("delivery_unavailable")

    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe("RecommendationRuntimeError")
    expect(error.code).toBe("delivery_unavailable")
    expect(error.message).toBe("Semantic recommendation delivery unavailable")
  })
})
