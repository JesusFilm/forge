/**
 * Barrel + fetch-id union for the Home tab config. Curation is split by lifecycle,
 * because the two halves have opposite sync rules and must never read as
 * interchangeable (R12):
 *   - heroConfig.ts   — LIVE, client-owned hero; mirror web hero curation here.
 *   - fallbackConfig.ts — FROZEN emergency body fallback; the live body is the
 *     admin Experience (experienceAdapter.ts), so do NOT mirror web here.
 * Siblings: watch-home.ts -> ./model.ts; watch-home-carousel-sequence.ts -> ./carouselSequence.ts.
 */
export * from "./heroConfig"
export * from "./fallbackConfig"

import {
  WATCH_HOME_COLLECTION_BLACKLIST,
  WATCH_HOME_HERO_SOURCE_IDS,
} from "./heroConfig"
import { WATCH_HOME_SECTIONS } from "./fallbackConfig"

// The hardcoded home locale pair (KTD-7): query locale + language identity, keyed on languageSlug, never bcp47.
export const HOME_LOCALE = "en"
export const ENGLISH_LANGUAGE_SLUG = "english"

/**
 * Core-id union for the single `watchHomeVideos` fetch, which feeds BOTH the live
 * hero carousel and the frozen fallback body — so it must keep returning the
 * combined hero + section set even though the body's live source is the Experience
 * (KTD-3, R4): a narrower fetch would starve the hero's short-films sweep.
 */
export function getWatchHomeCoreIds(): string[] {
  const ids = [
    ...WATCH_HOME_HERO_SOURCE_IDS,
    ...WATCH_HOME_SECTIONS.flatMap((section) => [
      section.primaryCollectionId,
      ...(section.sources ?? []).map((source) => source.id),
    ]),
  ].filter(
    (id): id is string =>
      typeof id === "string" && !WATCH_HOME_COLLECTION_BLACKLIST.has(id),
  )

  return [...new Set(ids)]
}
