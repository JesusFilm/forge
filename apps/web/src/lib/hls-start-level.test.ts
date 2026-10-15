import { describe, expect, it } from "vitest"

import {
  HLS_BANDWIDTH_TEST_START,
  type HlsForStartLevel,
  LowestRungFallbackAbrController,
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
    expect(config.abrController).toBe(LowestRungFallbackAbrController)
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
      abrController: LowestRungFallbackAbrController,
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

/**
 * A stand-in for the hls.js instance, shaped like hls.js 1.6.16: levels are
 * sorted lowest bitrate first, and `firstLevel` starts on the first-listed
 * variant (index 2 here: Mux lists 720p first in a 270/480/720/1080 ladder).
 */
function fakeHls({ minAutoLevel = 0 }: { minAutoLevel?: number } = {}) {
  const listeners = new Map<string, Array<() => void>>()
  class DefaultAbrController {
    constructor(readonly hls: HlsForStartLevel) {}
  }
  class FakeHls {
    static Events = { MANIFEST_PARSED: "hlsManifestParsed" }
    static DefaultConfig = { abrController: DefaultAbrController }
    firstLevel = 2
    readonly minAutoLevel = minAutoLevel
    on(event: string, listener: () => void) {
      listeners.set(event, [...(listeners.get(event) ?? []), listener])
    }
  }
  const hls = new FakeHls() as unknown as HlsForStartLevel
  // The production type is hls.js's full constructor; the stand-in carries
  // only the slice the fallback reads.
  const asHlsJs = hls as unknown as ConstructorParameters<
    typeof LowestRungFallbackAbrController
  >[0]
  const emit = (event: string) =>
    listeners.get(event)?.forEach((listener) => listener())
  return { hls, asHlsJs, emit, DefaultAbrController }
}

describe("LowestRungFallbackAbrController", () => {
  it("hands hls.js its own default ABR controller", () => {
    const { hls, asHlsJs, DefaultAbrController } = fakeHls()

    const abr: unknown = new LowestRungFallbackAbrController(asHlsJs)

    expect(abr).toBeInstanceOf(DefaultAbrController)
    expect((abr as InstanceType<typeof DefaultAbrController>).hls).toBe(hls)
  })

  it("points the no-rung-fits start fallback at the lowest rung once the manifest is parsed", () => {
    // Without this, a connection too slow for any rung starts on firstLevel,
    // the first-listed 720p variant, after already paying for the test.
    const { hls, asHlsJs, emit } = fakeHls()
    new LowestRungFallbackAbrController(asHlsJs)
    expect(hls.firstLevel).toBe(2)

    emit("hlsManifestParsed")

    expect(hls.firstLevel).toBe(0)
  })

  it("uses the lowest rung ABR may pick, not index 0", () => {
    const { hls, asHlsJs, emit } = fakeHls({ minAutoLevel: 1 })
    new LowestRungFallbackAbrController(asHlsJs)

    emit("hlsManifestParsed")

    expect(hls.firstLevel).toBe(1)
  })
})
