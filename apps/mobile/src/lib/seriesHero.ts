// What the series-detail screen puts at the top (U8, R9/R10). Pure, because
// the trailer and the poster hero are ONE decision: the screen must always
// carry exactly one of them.

export type SeriesHeroInput = {
  /** The series record has loaded (a seed alone can never source a trailer). */
  hasSeries: boolean
  /** A trailer stream resolved for the selected language. */
  hasTrailer: boolean
  /** A mini player session holds playback (R9/R10). */
  miniPlayerActive: boolean
}

/**
 * The trailer autostarts, so a live session must suppress it: two decoders and
 * two audio streams otherwise, on a screen the window's default destination is
 * one tap from.
 */
export function showsSeriesTrailer({
  hasSeries,
  hasTrailer,
  miniPlayerActive,
}: SeriesHeroInput): boolean {
  return hasSeries && hasTrailer && !miniPlayerActive
}

/**
 * The complement, and it is stated rather than implied: the screen's poster
 * hero used to key on the trailer URL alone, so suppressing the trailer
 * without this leaves the screen with no hero at all.
 */
export function showsSeriesPosterHero(input: SeriesHeroInput): boolean {
  return !showsSeriesTrailer(input)
}
