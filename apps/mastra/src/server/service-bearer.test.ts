import { describe, expect, it } from "vitest"

import { isValidServiceBearer, parseServiceApiKeys } from "./service-bearer"

describe("Mastra service bearer", () => {
  it("parses comma-separated service keys", () => {
    expect(parseServiceApiKeys(" one, two ,,three ")).toEqual([
      "one",
      "two",
      "three",
    ])
  })

  it("accepts a matching bearer", () => {
    expect(
      isValidServiceBearer({
        authHeader: "Bearer secret-two",
        allowlist: ["secret-one", "secret-two"],
      }),
    ).toBe(true)
  })

  it("rejects missing, malformed, wrong, and empty allowlist values", () => {
    expect(
      isValidServiceBearer({ authHeader: null, allowlist: ["secret"] }),
    ).toBe(false)
    expect(
      isValidServiceBearer({
        authHeader: "Basic secret",
        allowlist: ["secret"],
      }),
    ).toBe(false)
    expect(
      isValidServiceBearer({
        authHeader: "Bearer wrong",
        allowlist: ["secret"],
      }),
    ).toBe(false)
    expect(
      isValidServiceBearer({ authHeader: "Bearer secret", allowlist: [] }),
    ).toBe(false)
  })

  it("does not throw for length-mismatched unicode keys", () => {
    expect(
      isValidServiceBearer({
        authHeader: "Bearer key",
        allowlist: ["kéy"],
      }),
    ).toBe(false)
  })
})
