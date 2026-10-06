import type { GoogleTvVideo } from "../../modules/google-tv-home"
import type { ContinueWatchingEntry } from "./watchEvents/continueWatching"
import type { WatchHomeCard, WatchHomeModel } from "./watchHome/model"
import type { RecommendationItem } from "./recommendations/client"

export type DiscoveryConcept = "spotlight" | "collection" | "hope" | "journey"
export type DiscoverySelection = {
  concept: DiscoveryConcept
  title: string
  videos: GoogleTvVideo[]
}
export type DiscoveryRotation = {
  selectedAt: number
  concept: DiscoveryConcept
  remaining?: DiscoveryConcept[]
  cycle?: DiscoveryConcept[]
}
export const DISCOVERY_INTERVAL_MS = 86_400_000

export function googleTvPersonalizedModel(
  items: readonly Pick<
    RecommendationItem,
    "videoSlug" | "videoTitle" | "imageUrl" | "description" | "durationSeconds"
  >[],
  catalogue: WatchHomeModel,
): WatchHomeModel {
  const known = new Map(
    [
      ...catalogue.featured,
      ...catalogue.sections.flatMap((section) => section.cards),
    ].map((card) => [card.slug, card]),
  )
  const cards = items.flatMap((item) => {
    const record = item.videoSlug ? known.get(item.videoSlug) : null
    if (
      !record ||
      (record.rawLabel !== "FEATURE_FILM" && record.rawLabel !== "SHORT_FILM")
    )
      return []
    return [
      {
        ...record,
        title: item.videoTitle ?? record.title,
        description: item.description ?? null,
        durationSeconds: item.durationSeconds ?? null,
        imageUrl: item.imageUrl ?? null,
        landscapeImageUrl: item.imageUrl ?? null,
      },
    ]
  })
  return {
    featured: cards,
    sections: [
      {
        id: "google-tv-for-you",
        title: "Recommended for you",
        eyebrow: "",
        description: null,
        layout: "rail",
        orientation: "horizontal",
        showSequenceNumbers: false,
        isPosterRail: false,
        cards,
      },
      ...catalogue.sections.map((section) => {
        const slugs = new Set(section.cards.map((card) => card.slug))
        return {
          ...section,
          cards: cards.filter((card) => slugs.has(card.slug)),
        }
      }),
    ],
    missingData: [],
  }
}

export function googleTvPoster(input: string | null): string | null {
  if (!input) return null
  try {
    const url = new URL(input)
    if (url.protocol !== "https:" || url.username || url.password || url.port)
      return null
    if (url.hostname === "imagedelivery.net") {
      const parts = url.pathname.split("/")
      if (
        parts.length !== 4 ||
        parts[1] !== "tMY86qEHFACTO8_0kAeRFA" ||
        !parts[2]
      )
        return null
      return `${url.origin}/${parts[1]}/${parts[2]}/f=jpg,w=448,h=252,fit=cover,q=85`
    }
    if (
      url.hostname === "image.mux.com" &&
      /^\/[A-Za-z0-9_-]+\/thumbnail\.jpg$/.test(url.pathname)
    ) {
      return `${url.origin}${url.pathname}?width=448&height=252&fit_mode=smartcrop`
    }
  } catch {
    return null
  }
  return null
}

function movie(card: WatchHomeCard): GoogleTvVideo | null {
  if (card.rawLabel !== "FEATURE_FILM" && card.rawLabel !== "SHORT_FILM")
    return null
  const posterUri = googleTvPoster(card.landscapeImageUrl)
  const duration = card.durationSeconds
  if (
    !card.slug ||
    !/^[a-z0-9-]{1,120}$/.test(card.slug) ||
    !card.title.trim() ||
    !posterUri ||
    duration == null ||
    !Number.isFinite(duration) ||
    duration <= 0 ||
    duration > 86400
  )
    return null
  return {
    slug: card.slug,
    title: card.title.slice(0, 150),
    description: (card.description ?? "").slice(0, 500),
    posterUri,
    playbackUri: `org.jesusfilm.forgetv://watch/${card.slug}?autoplay=1`,
    durationMillis: Math.floor(duration * 1000),
  }
}

function movies(cards: readonly WatchHomeCard[]): GoogleTvVideo[] {
  const seen = new Set<string>()
  return cards.flatMap((card) => {
    const video = movie(card)
    if (!video || seen.has(video.slug)) return []
    seen.add(video.slug)
    return [video]
  })
}

export function googleTvDiscoveryCandidates(
  model: WatchHomeModel,
): DiscoverySelection[] {
  const featured = movies(model.featured)
  const all = movies([
    ...model.featured,
    ...model.sections.flatMap((section) => section.cards),
  ])
  const grouped = model.sections.map((section) => ({
    section,
    videos: movies(section.cards).slice(0, 25),
  }))
  const collection = grouped.find(({ videos }) => videos.length >= 2)
  const topic = grouped.find(
    ({ section, videos }) =>
      videos.length > 0 &&
      /hope|faith|forgiv|journey|peace|worth/i.test(section.title),
  )
  const short = all
    .filter((video) => video.durationMillis <= 10 * 60 * 1000)
    .slice(0, 25)
  return [
    ...(featured.length
      ? [
          {
            concept: "spotlight" as const,
            title: "Cinematic Spotlight",
            videos: featured.slice(0, 1),
          },
        ]
      : []),
    ...(collection
      ? [
          {
            concept: "collection" as const,
            title: collection.section.title.slice(0, 100),
            videos: collection.videos,
          },
        ]
      : []),
    ...(short.length
      ? [{ concept: "hope" as const, title: "A Moment of Hope", videos: short }]
      : []),
    ...(topic
      ? [
          {
            concept: "journey" as const,
            title: topic.section.title.slice(0, 100),
            videos: topic.videos,
          },
        ]
      : []),
  ]
}

export function selectGoogleTvDiscovery(
  candidates: readonly DiscoverySelection[],
  previous: DiscoveryRotation | null,
  now: number,
  random = Math.random,
): { selection: DiscoverySelection; rotation: DiscoveryRotation } | null {
  if (!candidates.length) return null
  const existing = candidates.find((item) => item.concept === previous?.concept)
  if (previous && existing && now - previous.selectedAt < DISCOVERY_INTERVAL_MS)
    return { selection: existing, rotation: previous }
  const eligible = [...new Set(candidates.map((item) => item.concept))]
  let cycle = Array.isArray(previous?.cycle)
    ? previous.cycle.filter((item) => eligible.includes(item))
    : previous
      ? [previous.concept]
      : []
  let remaining = Array.isArray(previous?.remaining)
    ? [
        ...new Set(
          previous.remaining.filter(
            (item) => eligible.includes(item) && item !== previous?.concept,
          ),
        ),
      ]
    : []
  const added = eligible.filter((item) => !cycle.includes(item))
  remaining.push(...added)
  cycle.push(...added)
  if (!remaining.length) {
    remaining = [...eligible]
    cycle = [...eligible]
  }
  if (added.length || remaining.length === eligible.length) {
    for (let index = remaining.length - 1; index > 0; index--) {
      const swap = Math.min(
        index,
        Math.max(0, Math.floor(random() * (index + 1))),
      )
      ;[remaining[index], remaining[swap]] = [
        remaining[swap]!,
        remaining[index]!,
      ]
    }
  }
  if (remaining.length > 1 && remaining[0] === previous?.concept) {
    ;[remaining[0], remaining[1]] = [remaining[1]!, remaining[0]!]
  }
  const concept = remaining.shift()!
  const selection = candidates.find((item) => item.concept === concept)!
  return {
    selection,
    rotation: { concept, selectedAt: now, remaining, cycle },
  }
}

export function googleTvContinuation(
  entries: readonly ContinueWatchingEntry[],
  model: WatchHomeModel,
  now: number,
): GoogleTvVideo[] {
  const catalogue = new Map(
    movies([
      ...model.featured,
      ...model.sections.flatMap((section) => section.cards),
    ]).map((video) => [video.slug, video]),
  )
  const seen = new Set<string>()
  return [...entries]
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .flatMap((entry) => {
      const metadata = catalogue.get(entry.slug)
      const duration = entry.durationSeconds
      const position = entry.positionSeconds
      const updated = Date.parse(entry.updatedAt)
      if (
        !metadata ||
        seen.has(entry.slug) ||
        duration == null ||
        !Number.isFinite(duration) ||
        duration <= 0 ||
        duration > 86400 ||
        !Number.isFinite(position) ||
        position <= 0 ||
        position / duration >= 0.95 ||
        (position < 30 && position / duration < 0.25) ||
        !Number.isFinite(updated) ||
        updated > now + 60000 ||
        now - updated > 30 * DISCOVERY_INTERVAL_MS
      )
        return []
      seen.add(entry.slug)
      return [
        {
          ...metadata,
          durationMillis: Math.floor(duration * 1000),
          positionMillis: Math.floor(position * 1000),
          lastEngagementMillis: updated,
        },
      ]
    })
    .slice(0, 5)
}
