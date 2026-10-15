/**
 * How hls.js picks the first rendition for a Watch player.
 *
 * Left alone, hls.js starts on the FIRST variant listed in the master
 * playlist. Mux lists its 720p rung first (measured 2026-10-14 on the JESUS
 * film: 720p 2.72 Mbps, then 480p, 270p, 1080p), and hls.js also raises its
 * initial bandwidth guess to that variant's bitrate. So every viewer, however
 * slow, starts on 720p. On Chrome's Slow 3G profile that first 5-second
 * segment takes about 35 seconds to arrive, and playback then rebuffers while
 * ABR walks down to 270p (QA-609, finding N63a).
 *
 * `startLevel: -1` switches hls.js to its bandwidth-test start: it downloads
 * one segment of the LOWEST rung, measures real throughput, discards that
 * segment unbuffered, and then starts on the best rung the measurement
 * supports. Fast connections start on the highest rung their bandwidth and
 * the player size allow, which can be ABOVE the old fixed 720p start. The
 * cost is one extra lowest-rung playlist and segment fetch before the first
 * real segment, paid on every new source.
 *
 * The test alone makes slow connections WORSE. When no rung can load within
 * hls.js's 4-second start budget (`maxStarvationDelay`), hls.js gives up and
 * starts on `hls.firstLevel`, the first-listed variant: 720p again, now after
 * a wasted test download. On Slow 3G that measured 45.7 s to first frame
 * versus 35.1 s without the test. `LowestRungFallbackAbrController` moves
 * that fallback to the lowest rung (19.4 s, 270p). Measured 2026-10-15 on the
 * JESUS film manifest in Chrome 1280x720, cache disabled.
 *
 * Verified by hand 2026-10-15 against hls.js 1.6.16 (`stream-controller.ts`
 * `startLoad` + `_loadBitrateTestFrag`, `abr-controller.ts`
 * `firstAutoLevel`) and @mux/playback-core 0.34.1, which spreads the caller's
 * `_hlsConfig` LAST into `new Hls(...)`, so these keys win over Mux's
 * defaults (Mux sets no `abrController`). Re-check both after bumping either
 * package.
 *
 * Why a measurement and not `navigator.connection`: the Network Information
 * API exists only in Chromium, and Chrome's own network throttling does not
 * update it (it kept reporting `4g` under Slow 3G in our runs). A real
 * download measures what the viewer actually has, in every browser that
 * plays through hls.js.
 *
 * Scope: hls.js only. iOS Safari and other native-HLS players ignore hls.js
 * config entirely and choose their own start rung.
 */
import type { Props as MuxVideoProps } from "@mux/mux-video-react"

/** hls.js's own config type, reached through Mux's typed `_hlsConfig`. */
type HlsConfig = NonNullable<MuxVideoProps["_hlsConfig"]>
type AbrControllerClass = NonNullable<HlsConfig["abrController"]>

/**
 * The slice of the hls.js instance the fallback needs. Typed structurally
 * because apps/web does not depend on hls.js directly; the instance comes
 * from @mux/playback-core.
 */
export type HlsForStartLevel = {
  readonly constructor: {
    readonly Events: { readonly MANIFEST_PARSED: string }
    readonly DefaultConfig: {
      readonly abrController: new (hls: HlsForStartLevel) => object
    }
  }
  on(event: string, listener: () => void): void
  /** Writable on hls.js: the rung used when no rung fits the start budget. */
  firstLevel: number
  /** Index of the lowest rung ABR may pick (levels are sorted ascending). */
  readonly minAutoLevel: number
}

/**
 * hls.js's own ABR controller, with one change: after each manifest parse,
 * the "nothing fits" start fallback points at the lowest rung instead of the
 * first-listed variant. hls.js builds `config.abrController` with `new` and
 * passes itself, so this returns hls.js's default controller untouched; it
 * only adds the listener. Using `hls.constructor` keeps it tied to whichever
 * hls.js build Mux loaded.
 *
 * A `function`, not a class, because it returns a different object from
 * `new`, and not an arrow function, because hls.js calls it with `new`.
 */
export const LowestRungFallbackAbrController = function (
  hls: HlsForStartLevel,
) {
  const Hls = hls.constructor
  hls.on(Hls.Events.MANIFEST_PARSED, () => {
    hls.firstLevel = hls.minAutoLevel
  })
  return new Hls.DefaultConfig.abrController(hls)
  // hls.js passes its full instance; only the slice above is used.
} as unknown as AbrControllerClass

export const HLS_BANDWIDTH_TEST_START = {
  /** -1 = measure first, then start on the rung the bandwidth supports. */
  startLevel: -1,
  /**
   * hls.js's own default, pinned here because `startLevel: -1` does nothing
   * without it — hls.js would fall back to its first-variant guess.
   */
  testBandwidth: true,
  /** Slow links that fit no rung start on the lowest one, not on 720p. */
  abrController: LowestRungFallbackAbrController,
} as const

/**
 * Pure. Returns a new config with the bandwidth-test start applied on top of
 * `base`. Any start-level settings already in `base` are replaced so the
 * start policy has exactly one owner.
 */
export function withBandwidthTestStart<T extends object>(
  base: T,
): Omit<T, keyof typeof HLS_BANDWIDTH_TEST_START> &
  typeof HLS_BANDWIDTH_TEST_START {
  return { ...base, ...HLS_BANDWIDTH_TEST_START }
}
