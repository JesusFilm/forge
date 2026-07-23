import { describe, expect, it } from "vitest"
import { nextConfig } from "../next.config.mjs"

describe("Next.js Server Action origins", () => {
  it("trusts only the canonical Watch reverse proxies", () => {
    expect(nextConfig.experimental.serverActions.allowedOrigins).toEqual([
      "develop.jesusfilm.org",
      "www.jesusfilm.org",
    ])
  })
})
