import { describe, expect, it } from "vitest"

import { shouldBypassNextImageOptimization } from "./provider-image"

describe("shouldBypassNextImageOptimization", () => {
  it.each([
    "https://image.mux.com/playback/thumbnail.jpg?width=448&height=252",
    "https://imagedelivery.net/account/image/f=jpg,w=448,h=252",
  ])("bypasses Next for provider-sized images: %s", (src) => {
    expect(shouldBypassNextImageOptimization(src)).toBe(true)
  })

  it.each([
    "https://example.com/image.jpg",
    "http://image.mux.com/playback/thumbnail.jpg",
    "/local-image.jpg",
    "not a URL",
  ])("keeps Next optimization for other URLs: %s", (src) => {
    expect(shouldBypassNextImageOptimization(src)).toBe(false)
  })
})
