/**
 * Barrel + fetch-id union. Curation is split by lifecycle so the halves never read
 * as interchangeable (R12): heroConfig.ts is LIVE (mirror web), fallbackConfig.ts
 * is the FROZEN body fallback (do NOT mirror — the live body is the Experience).
 */
export * from "./heroConfig"
export * from "./fallbackConfig"

import {
  WATCH_HOME_COLLECTION_BLACKLIST,
  WATCH_HOME_HERO_SOURCE_IDS,
} from "./heroConfig"
import { WATCH_HOME_SECTIONS } from "./fallbackConfig"

// Home and For You read their languages from the store (U6, U7).
export const ENGLISH_LANGUAGE_SLUG = "english"

/**
 * Core-id union for the single `watchHomeVideos` fetch, which feeds BOTH the hero
 * carousel and the frozen fallback body — so it keeps the combined hero + section
 * set even though the live body is the Experience (KTD-3, R4; narrowing starves the hero).
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
