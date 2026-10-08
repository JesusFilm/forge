import { describe, expect, it } from "vitest"
import {
  recommendationJson,
  recommendationSerializedJson,
} from "./recommendation-route-response"

describe("recommendation private response headers", () => {
  it("marks JSON responses private and varies them by cookie", () => {
    for (const response of [
      recommendationJson({ profile: {} }),
      recommendationSerializedJson('{"profile":{}}'),
    ]) {
      expect(response.headers.get("cache-control")).toBe(
        "private, no-store, max-age=0",
      )
      expect(response.headers.get("vary")).toBe("Cookie")
    }
  })
})
