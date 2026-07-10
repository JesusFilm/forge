import { describe, expect, it } from "vitest"
import { parseApiKeysCsv, validateBearer } from "./auth.js"

describe("parseApiKeysCsv", () => {
  it("splits, trims, and drops empty entries", () => {
    expect(parseApiKeysCsv(" key-a , key-b ,,key-c")).toEqual([
      "key-a",
      "key-b",
      "key-c",
    ])
  })

  it("returns an empty list for undefined", () => {
    expect(parseApiKeysCsv(undefined)).toEqual([])
  })
})

describe("validateBearer", () => {
  it("returns ok for a key anywhere in the allowlist", () => {
    expect(
      validateBearer("Bearer key-b", {
        apiKeysCsv: "key-a,key-b",
        nodeEnv: "production",
      }),
    ).toBe("ok")
    expect(
      validateBearer("Bearer key-a", {
        apiKeysCsv: "key-a,key-b",
        nodeEnv: "production",
      }),
    ).toBe("ok")
  })

  it("returns unauthorized for a wrong bearer", () => {
    expect(
      validateBearer("Bearer wrong", {
        apiKeysCsv: "key-a,key-b",
        nodeEnv: "production",
      }),
    ).toBe("unauthorized")
  })

  it("returns unauthorized for a missing or malformed header", () => {
    const options = { apiKeysCsv: "key-a", nodeEnv: "production" }

    expect(validateBearer(undefined, options)).toBe("unauthorized")
    expect(validateBearer("key-a", options)).toBe("unauthorized")
    expect(validateBearer("Basic key-a", options)).toBe("unauthorized")
  })

  it("returns unauthorized for a bearer with mismatched length", () => {
    expect(
      validateBearer("Bearer key-a-with-longer-length", {
        apiKeysCsv: "key-a",
        nodeEnv: "production",
      }),
    ).toBe("unauthorized")
  })

  it("returns config_missing in production when no allowlist is set", () => {
    expect(
      validateBearer("Bearer anything", {
        apiKeysCsv: undefined,
        nodeEnv: "production",
      }),
    ).toBe("config_missing")
    expect(
      validateBearer("Bearer anything", {
        apiKeysCsv: " , ",
        nodeEnv: "production",
      }),
    ).toBe("config_missing")
  })

  it("bypasses auth outside production when no allowlist is set", () => {
    expect(
      validateBearer(undefined, { apiKeysCsv: undefined, nodeEnv: "test" }),
    ).toBe("ok")
    expect(
      validateBearer(undefined, {
        apiKeysCsv: undefined,
        nodeEnv: "development",
      }),
    ).toBe("ok")
  })

  it("still enforces the allowlist outside production when set", () => {
    expect(
      validateBearer("Bearer wrong", { apiKeysCsv: "key-a", nodeEnv: "test" }),
    ).toBe("unauthorized")
    expect(
      validateBearer("Bearer key-a", { apiKeysCsv: "key-a", nodeEnv: "test" }),
    ).toBe("ok")
  })

  it("uses the first value when the header arrives as an array", () => {
    expect(
      validateBearer(["Bearer key-a", "Bearer wrong"], {
        apiKeysCsv: "key-a",
        nodeEnv: "production",
      }),
    ).toBe("ok")
  })
})
