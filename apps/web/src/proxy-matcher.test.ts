import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server"
import { describe, expect, it } from "vitest"

import { config } from "./proxy"
import { WATCH_BASE_PATH } from "./lib/routes"

describe("Next compiled proxy matcher with the Watch basePath", () => {
  const matches = (url: string) =>
    unstable_doesMiddlewareMatch({
      config,
      nextConfig: { basePath: WATCH_BASE_PATH },
      url,
    })

  it("admits the exact basePath root before config rewrites", () => {
    expect(matches("/watch")).toBe(true)
    expect(matches("/watch?ref=entry")).toBe(true)
    expect(matches("/watch/")).toBe(true)
    expect(matches("/watch/languages")).toBe(true)
  })

  it("keeps assets, APIs, and other apps out of the proxy", () => {
    for (const url of [
      "/",
      "/watch/api/preview",
      "/watch/_next/static/x.js",
      "/watch/assets/x.svg",
      "/watch/demo-search",
    ]) {
      expect(matches(url), url).toBe(false)
    }
  })
})
