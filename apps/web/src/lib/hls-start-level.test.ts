import { describe, expect, it } from "vitest"

import {
  HLS_BANDWIDTH_TEST_START,
  withBandwidthTestStart,
} from "@/lib/hls-start-level"

describe("withBandwidthTestStart", () => {
  it("asks hls.js to measure bandwidth before choosing the first rendition", () => {
    // hls.js reads `startLevel: -1` + `testBandwidth: true` as "download one
    // lowest-rung segment, measure, then start on the rung that fits". Any
    // other startLevel (or leaving it unset) starts on the first variant in
    // the manifest, which Mux lists as 720p.
    const config = withBandwidthTestStart({})

    expect(config.startLevel).toBe(-1)
    expect(config.testBandwidth).toBe(true)
  })

  it("keeps every other setting from the base config", () => {
    const base = {
      maxBufferLength: 10,
      maxBufferSize: 5_000_000,
      backBufferLength: 5,
      enableWebVTT: false,
    }

    expect(withBandwidthTestStart(base)).toEqual({
      ...base,
      startLevel: -1,
      testBandwidth: true,
    })
  })

  it("replaces a start policy already present in the base config", () => {
    const config = withBandwidthTestStart({
      startLevel: 3,
      testBandwidth: false,
    })

    expect(config).toEqual(HLS_BANDWIDTH_TEST_START)
  })

  it("does not mutate the base config", () => {
    const base = { maxBufferLength: 10 }

    withBandwidthTestStart(base)

    expect(base).toEqual({ maxBufferLength: 10 })
  })
})
