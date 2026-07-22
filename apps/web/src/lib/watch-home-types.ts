export type WatchHomeProgramActionIcon = "join" | "share"

export type WatchHomeProgramAction = {
  label: string
  href: string
  icon: WatchHomeProgramActionIcon | null
}

export type WatchHomeProgramPromoItem = {
  id: string
  playbackId: string
  src: string
  durationSeconds: number | null
  posterUrl: string
  label: string | null
  title: string
  description: string | null
  showLogo: boolean
  primaryAction: WatchHomeProgramAction | null
  secondaryAction: WatchHomeProgramAction | null
}

export type WatchHomeProgramVideoItem = {
  id: string
  videoId: string
  coreId: string
  title: string
  description: string | null
  label: string
  href: string | null
  posterUrl: string | null
  thumbnailUrl: string | null
  imageAlt: string
  src: string
  playbackId: string | null
  subtitleVttSrc: string | null
  subtitleLanguageBcp47: string | null
  durationSeconds: number | null
}

export type WatchHomeProgramVideoBucket = {
  kind: "video"
  id: string
  label: string
  items: WatchHomeProgramVideoItem[]
}

export type WatchHomeProgramPromoBucket = {
  kind: "promo"
  id: string
  label: string
  items: WatchHomeProgramPromoItem[]
}

export type WatchHomeProgramBucket =
  | WatchHomeProgramVideoBucket
  | WatchHomeProgramPromoBucket

export type WatchHomeProgram = {
  intro: WatchHomeProgramPromoItem | null
  buckets: WatchHomeProgramBucket[]
  rotation: string[]
}

export const WATCH_HOME_PROGRAM_DELIVERY_LIMITS = {
  bytes: 128 * 1024,
  buckets: 24,
  rotationSlots: 48,
  itemsPerBucket: 40,
  uniqueVideos: 100,
  promos: 100,
  labelCharacters: 80,
  titleCharacters: 120,
  actionLabelCharacters: 120,
  descriptionCharacters: 500,
} as const
