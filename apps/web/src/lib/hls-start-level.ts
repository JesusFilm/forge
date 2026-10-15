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
 * supports. Slow connections start low; fast connections still start on the
 * rung their bandwidth supports, so first-frame quality is unchanged. The
 * cost is one small extra download before the first real segment.
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
export const HLS_BANDWIDTH_TEST_START = {
  /** -1 = measure first, then start on the rung the bandwidth supports. */
  startLevel: -1,
  /**
   * hls.js's own default, pinned here because `startLevel: -1` does nothing
   * without it — hls.js would fall back to its first-variant guess.
   */
  testBandwidth: true,
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
