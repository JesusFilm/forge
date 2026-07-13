/**
 * Client-owned hero composition, mirroring apps/mobile/src/lib/watchHome/carouselSequence.ts
 * + the pool builder in apps/mobile/src/lib/watchHome/model.ts. The TV hero rotates through
 * WATCH_HOME_PLAYLIST_SEQUENCE via a deterministic, day-seeded round-robin — the SAME algorithm
 * web/mobile use — so it shows the same day's videos/series. TV deliberately diverges from mobile
 * in two ways that do NOT change the picked set:
 *   - it emits WatchHomeCard[] (no parallel slide type); the queue dedupes on `coreId` to match
 *     mobile's slide-id-is-coreId dedupe (KTD2).
 *   - `businessDate` is computed without Hermes Intl (KTD6) — see clockFormat.ts precedent.
 * TV builds NO Mux inserts (no web-link/promo slides). Pure TS.
 */

import {
  WATCH_HOME_COLLECTION_BLACKLIST,
  WATCH_HOME_PLAYLIST_SEQUENCE,
} from "./config"
import {
  normalizeCard,
  type WatchHomeCard,
  type WatchHomeMissingData,
  type WatchHomeVideoInput,
} from "./model"

/** Web's initial hero queue size (mobile's WATCH_HOME_HERO_QUEUE_TARGET). */
const WATCH_HOME_HERO_QUEUE_TARGET = 7

type HeroPool = {
  id: string
  collectionIds: readonly string[]
  cards: readonly WatchHomeCard[]
}

// --- Deterministic day-seeded selection (verbatim from mobile carouselSequence.ts) ---

export function simpleHash(value: string): number {
  let hash = 0
  for (let i = 0; i < value.length; i++) {
    hash = (hash << 5) - hash + value.charCodeAt(i)
    hash &= hash
  }
  return Math.abs(hash)
}

function nthSundayOfMonthUtc(
  year: number,
  monthIndex: number,
  n: number,
): number {
  const firstWeekday = new Date(Date.UTC(year, monthIndex, 1)).getUTCDay()
  const firstSunday = 1 + ((7 - firstWeekday) % 7)
  return firstSunday + (n - 1) * 7
}

/**
 * ET calendar date as `YYYY-MM-DD`, WITHOUT Intl timezone data. Mobile uses
 * `toLocaleDateString("en-CA", { timeZone })`, but TV avoids Hermes Intl
 * (clockFormat.ts) — a silently-ignored timeZone would return the device-local
 * date and desync the rotation. Applies the US Eastern offset via the standard
 * DST rule (2nd-Sunday-March 07:00 UTC → 1st-Sunday-November 06:00 UTC). The
 * output string equals mobile's for the same instant (asserted in the tests).
 */
export function businessDate(now: Date): string {
  const year = now.getUTCFullYear()
  const dstStart = Date.UTC(year, 2, nthSundayOfMonthUtc(year, 2, 2), 7)
  const dstEnd = Date.UTC(year, 10, nthSundayOfMonthUtc(year, 10, 1), 6)
  const t = now.getTime()
  const offsetHours = t >= dstStart && t < dstEnd ? -4 : -5
  const et = new Date(t + offsetHours * 3_600_000)
  const y = et.getUTCFullYear()
  const m = String(et.getUTCMonth() + 1).padStart(2, "0")
  const d = String(et.getUTCDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

export function getWatchHomeDeterministicOffset(
  poolId: string,
  videoCount: number,
  options: {
    now?: Date
    poolIndex?: number
    totalVideosLoaded?: number
  } = {},
): number {
  if (videoCount <= 0) return 0

  const now = options.now ?? new Date()
  let seed = `${businessDate(now)}${poolId}`

  if (options.poolIndex != null) {
    seed += `-cycle${Math.floor(options.poolIndex / 15)}`
  }
  if (options.totalVideosLoaded != null) {
    seed += `-prog${Math.floor(options.totalVideosLoaded / 10)}`
  }

  return simpleHash(seed) % videoCount
}

/** KTD1 eligibility: a usable hero card needs an image + slug and a non-blacklisted coreId. */
function isEligibleHeroCard(card: WatchHomeCard): boolean {
  return (
    Boolean(card.imageUrl && card.slug) &&
    !WATCH_HOME_COLLECTION_BLACKLIST.has(card.coreId)
  )
}

// --- Pool building (mirrors mobile buildCarouselPools / eligibleSlidesForSource) ---

/** Top-level-only source map (mirrors mobile model.ts:551-553). NOT the child-inclusive index. */
export function buildHeroSourceMap(
  videos: readonly WatchHomeVideoInput[],
): Map<string, WatchHomeVideoInput> {
  const map = new Map<string, WatchHomeVideoInput>()
  for (const video of videos) {
    if (typeof video.coreId === "string" && video.coreId.length > 0) {
      map.set(video.coreId, video)
    }
  }
  return map
}

function eligibleCardsForSource(args: {
  sourceId: string
  videoByCoreId: Map<string, WatchHomeVideoInput>
  languageSlug: string
  missingData: WatchHomeMissingData[]
}): WatchHomeCard[] {
  if (WATCH_HOME_COLLECTION_BLACKLIST.has(args.sourceId)) return []

  const parent = args.videoByCoreId.get(args.sourceId)
  if (!parent) {
    args.missingData.push({
      sectionId: "home-carousel",
      sourceId: args.sourceId,
      field: "record",
      detail: `Admin watchHomeVideos did not return carousel pool source Core id ${args.sourceId}.`,
      fallback: "Pool skipped",
      followUp:
        "Verify the Core id exists in admin sync or replace the carousel playlist source.",
    })
    return []
  }

  // Mirror mobile: iterate RAW parent.children (NOT resolvedChildren — its
  // self-filter/dedupe would change candidates.length and the modulus pick).
  const childCards = (parent.children ?? [])
    .map((rel) =>
      rel.child
        ? normalizeCard({
            sectionId: "home-carousel",
            sourceId: args.sourceId,
            video: rel.child,
            parent,
            languageSlug: args.languageSlug,
          })
        : null,
    )
    .filter((card): card is WatchHomeCard => card != null)
    .filter(isEligibleHeroCard)

  if (childCards.length > 0) return childCards

  const parentCard = normalizeCard({
    sectionId: "home-carousel",
    sourceId: args.sourceId,
    video: parent,
    languageSlug: args.languageSlug,
  })
  return parentCard && isEligibleHeroCard(parentCard) ? [parentCard] : []
}

export function buildHeroPools(args: {
  videoByCoreId: Map<string, WatchHomeVideoInput>
  languageSlug: string
  missingData: WatchHomeMissingData[]
}): HeroPool[] {
  const pools: HeroPool[] = WATCH_HOME_PLAYLIST_SEQUENCE.map((group, index) => {
    const collectionIds = group.filter(
      (id) => !WATCH_HOME_COLLECTION_BLACKLIST.has(id),
    )
    const cards = collectionIds.flatMap((sourceId) =>
      eligibleCardsForSource({
        sourceId,
        videoByCoreId: args.videoByCoreId,
        languageSlug: args.languageSlug,
        missingData: args.missingData,
      }),
    )
    return {
      id: `playlist-${index}-${collectionIds.join("|")}`,
      collectionIds,
      cards,
    }
  }).filter((pool) => pool.cards.length > 0)

  // Synthetic shortFilms pool last (mirrors mobile), iterating the same
  // top-level source map so the ordering matches. Deduped by coreId.
  const shortFilmByCoreId = new Map<string, WatchHomeCard>()
  for (const video of args.videoByCoreId.values()) {
    const cards: WatchHomeCard[] = []
    const parentCard = normalizeCard({
      sectionId: "home-carousel-short-films",
      sourceId: video.coreId ?? video.documentId ?? "unknown",
      video,
      languageSlug: args.languageSlug,
    })
    if (parentCard) cards.push(parentCard)
    for (const rel of video.children ?? []) {
      if (!rel.child || rel.child.label !== "SHORT_FILM") continue
      const childCard = normalizeCard({
        sectionId: "home-carousel-short-films",
        sourceId: video.coreId ?? video.documentId ?? "unknown",
        video: rel.child,
        parent: video,
        languageSlug: args.languageSlug,
      })
      if (childCard) cards.push(childCard)
    }
    for (const card of cards) {
      if (card.label !== "Short film") continue
      if (!isEligibleHeroCard(card)) continue
      shortFilmByCoreId.set(card.coreId, card)
    }
  }

  if (shortFilmByCoreId.size > 0) {
    pools.push({
      id: "shortFilms",
      collectionIds: ["shortFilms"],
      cards: [...shortFilmByCoreId.values()],
    })
  }

  return pools
}

// --- Queue building (verbatim port of mobile buildWatchHomeVideoQueue; dedupe on coreId) ---

export function buildHeroVideoQueue(args: {
  pools: readonly HeroPool[]
  now?: Date
  startPoolIndex?: number
  targetVideoCount?: number
}): WatchHomeCard[] {
  const now = args.now ?? new Date()
  const startPoolIndex = args.startPoolIndex ?? 0
  const targetVideoCount = args.targetVideoCount ?? WATCH_HOME_HERO_QUEUE_TARGET

  if (targetVideoCount <= 0 || args.pools.length === 0) return []

  const cards: WatchHomeCard[] = []
  const seen = new Set<string>() // keyed on coreId (KTD2)
  let poolIndex = Math.max(0, startPoolIndex)
  let attempts = 0
  const maxAttempts = Math.max(args.pools.length * 4, targetVideoCount * 6)

  while (cards.length < targetVideoCount && attempts < maxAttempts) {
    const pool = args.pools[poolIndex % args.pools.length]
    attempts += 1

    if (!pool) {
      poolIndex += 1
      continue
    }

    const candidates = pool.cards.filter(
      (card) => isEligibleHeroCard(card) && !seen.has(card.coreId),
    )

    if (candidates.length === 0) {
      poolIndex += 1
      continue
    }

    const offset = getWatchHomeDeterministicOffset(pool.id, candidates.length, {
      now,
      poolIndex,
      totalVideosLoaded: cards.length,
    })
    const candidate = candidates[offset]
    if (candidate) {
      cards.push(candidate)
      seen.add(candidate.coreId)
    }

    poolIndex += 1
  }

  return cards
}

/** Full hero build: top-level source map → pools → day-seeded queue. Empty when nothing hydrates. */
export function buildHeroFeatured(args: {
  videos: readonly WatchHomeVideoInput[]
  languageSlug: string
  missingData: WatchHomeMissingData[]
  now?: Date
}): WatchHomeCard[] {
  const videoByCoreId = buildHeroSourceMap(args.videos)
  const pools = buildHeroPools({
    videoByCoreId,
    languageSlug: args.languageSlug,
    missingData: args.missingData,
  })
  return buildHeroVideoQueue({ pools, now: args.now })
}
