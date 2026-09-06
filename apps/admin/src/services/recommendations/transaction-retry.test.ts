import { describe, expect, it, vi } from "vitest"
import { withRecommendationSerializableRetry } from "./transaction-retry"

function conflict() {
  return Object.assign(new Error("serialization conflict"), { code: "P2034" })
}

describe("recommendation serializable transaction retry", () => {
  it("retries a bounded P2034 conflict before succeeding", async () => {
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(conflict())
      .mockResolvedValueOnce("ok")

    await expect(withRecommendationSerializableRetry(operation)).resolves.toBe(
      "ok",
    )
    expect(operation).toHaveBeenCalledTimes(2)
  })

  it("rethrows after the third P2034 conflict", async () => {
    const error = conflict()
    const operation = vi.fn<() => Promise<never>>().mockRejectedValue(error)

    await expect(withRecommendationSerializableRetry(operation)).rejects.toBe(
      error,
    )
    expect(operation).toHaveBeenCalledTimes(3)
  })
})
