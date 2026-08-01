import { describe, expect, it } from "vitest"
import { getAllowedDevOrigins, nextConfig } from "../next.config.mjs"

describe("Next.js Server Action origins", () => {
  it("trusts only the canonical Watch reverse proxies", () => {
    expect(nextConfig.experimental.serverActions.allowedOrigins).toEqual([
      "develop.jesusfilm.org",
      "www.jesusfilm.org",
    ])
  })
})

describe("Next.js development origins", () => {
  it("keeps loopback and admits the configured canonical hostname", () => {
    expect(getAllowedDevOrigins("https://base.example.test:8400")).toEqual([
      "127.0.0.1",
      "base.example.test",
    ])
  })

  it("falls back to loopback when the optional canonical origin is invalid", () => {
    expect(getAllowedDevOrigins("not a URL")).toEqual(["127.0.0.1"])
  })
})
