import type { ComponentType, ReactNode } from "react"
import type { Route } from "next"
import Image from "next/image"
import Link from "next/link"
import { useTranslations } from "next-intl"
import {
  ArrowUp,
  ArrowUpRight,
  Captions,
  Headphones,
  Library,
  Play,
} from "lucide-react"

import { buttonVariants } from "@/components/ui/button-variants"
import { AudioLanguagesIcon } from "@/components/watch/chrome-icons"
import {
  VIDEO_THUMBNAIL_FOCUS_TARGET_CLASS,
  VideoThumbnailInteractionFrame,
} from "@/components/ui/video-thumbnail-interaction-frame"
import {
  WATCH_IMMERSIVE_BACKDROP_CLASS,
  WATCH_IMMERSIVE_BACKGROUND_BRIGHTNESS_CLASS,
  WATCH_IMMERSIVE_BACKGROUND_COLOR,
  WATCH_IMMERSIVE_BACKGROUND_SATURATION_CLASS,
  WATCH_LANGUAGE_TAG_CLASS,
  WATCH_PILL_BUTTON_CLASS,
  WATCH_SECTION_EYEBROW_CLASS,
} from "@/components/watch/watch-section-styles"
import { WATCH_PAGE_CONTENT_CLASSES } from "@/lib/content-width"
import { resolveMuxFrameThumbnailUrl } from "@/lib/url"
import { cn } from "@/lib/utils"
import { videoLabelMessageKey } from "@/lib/video-labels"
import {
  inventoryFilterFacets,
  isNewRelease,
  publishedAtSortTime,
  type WatchCollectionLanguageCounts,
  type WatchLanguageInventoryCard,
  type WatchLanguageInventoryModel,
} from "@/lib/watch-language-inventory"
import { InventoryFilterShell } from "./InventoryFilterShell"
import { LanguageCollectionSwitcher } from "./LanguageCollectionSwitcher"
import {
  englishAssistAttributes,
  type EnglishAssistToken,
} from "./english-assist"

type IconComponent = ComponentType<{ className?: string }>

// Anchor target for the end-of-page "Back to top" link.
const LANGUAGE_INVENTORY_TOP_ID = "language-inventory-top"

type LanguageInventoryPageProps = {
  inventory: WatchLanguageInventoryModel
}

// Inventory rows fall back to a frame from the video when it carries no
// authored artwork — the common shape for newer vertical series, whose
// episodes previously rendered as an empty gradient tile.
//
// Every surface here requests the single 448x252 recipe admin pre-generates
// (see `resolveMuxFrameThumbnailUrl`). The page hero would prefer a wider
// source for its `sizes="100vw"` box, but a bespoke width is an on-demand Mux
// render — a multi-second cold TTFB on a `priority` above-the-fold image — so
// the hero takes a softer upscale instead. It renders at `opacity-35` behind
// two stacked gradients, where sharpness is not load-bearing.
type InventoryCardImage = Pick<
  WatchLanguageInventoryCard,
  "imageUrl" | "muxPlaybackId"
>

type InventoryCardOrientation = Pick<
  WatchLanguageInventoryCard,
  "coreId" | "slug" | "parentSlug" | "title" | "parentTitle"
>

const PORTRAIT_INVENTORY_MARKER =
  /(?:^|[^a-z0-9])(?:vertical|9x16)(?=$|[^a-z0-9])/i

function hasPortraitInventoryMarker(candidate: string | null): boolean {
  return candidate != null && PORTRAIT_INVENTORY_MARKER.test(candidate)
}

function isPortraitInventoryVideo(item: InventoryCardOrientation): boolean {
  return (
    hasPortraitInventoryMarker(item.coreId) ||
    hasPortraitInventoryMarker(item.slug) ||
    hasPortraitInventoryMarker(item.parentSlug) ||
    hasPortraitInventoryMarker(item.title) ||
    hasPortraitInventoryMarker(item.parentTitle)
  )
}

function cardImageUrl(item: InventoryCardImage): string | null {
  return item.imageUrl ?? resolveMuxFrameThumbnailUrl(item.muxPlaybackId)
}

// Authored artwork from ANY candidate outranks a synthesized frame from any
// other. Without the two-pass split, a candidate that only has a playback id
// would preempt real artwork sitting later in the list.
/// Authored artwork only — never a synthesized frame. Lets a caller express
/// "authored anywhere, before any frame" across several tiers.
function authoredImageUrl(
  candidates: readonly (InventoryCardImage | null | undefined)[],
): string | null {
  for (const item of candidates) {
    if (item?.imageUrl) return item.imageUrl
  }
  return null
}

function preferAuthoredImageUrl(
  candidates: readonly (InventoryCardImage | null | undefined)[],
): string | null {
  const present = candidates.filter((item): item is InventoryCardImage =>
    Boolean(item),
  )
  return (
    present.find((item) => item.imageUrl)?.imageUrl ??
    present
      .map((item) => resolveMuxFrameThumbnailUrl(item.muxPlaybackId))
      .find((url) => url != null) ??
    null
  )
}

function formatRuntime(seconds: number | null): string | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return null
  const total = Math.floor(seconds)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const remainingSeconds = total % 60
  const pad2 = (value: number) => value.toString().padStart(2, "0")
  return hours > 0
    ? `${hours}:${pad2(minutes)}:${pad2(remainingSeconds)}`
    : `${minutes}:${pad2(remainingSeconds)}`
}

function titleSequenceParts(title: string): number[] | null {
  const patterns = [
    /\b(?:episode|episodio)\s*(\d{1,3})\b/i,
    /\b(?:day|d[ií]a)\s*(\d{1,3})\b/i,
    /^\s*(\d{1,3})\s*[.)]/,
    /\b(?:matthew|mateo|mark|marca|marcos|luke|lucas|john|juan)\s+(\d{1,3})(?::(\d{1,3}))?/i,
  ]

  for (const pattern of patterns) {
    const match = pattern.exec(title)
    if (!match) continue

    const parts = match
      .slice(1)
      .filter((part): part is string => part != null)
      .map((part) => Number.parseInt(part, 10))
      .filter((part) => Number.isFinite(part))

    if (parts.length > 0) return parts
  }

  return null
}

function compareSequenceParts(a: number[], b: number[]): number {
  const length = Math.max(a.length, b.length)
  for (let index = 0; index < length; index += 1) {
    const aPart = a[index] ?? 0
    const bPart = b[index] ?? 0
    if (aPart !== bPart) return aPart - bPart
  }
  return 0
}

function compareParentOrder(
  a: WatchLanguageInventoryCard,
  b: WatchLanguageInventoryCard,
): number {
  if (a.parentOrder != null && b.parentOrder != null) {
    return a.parentOrder - b.parentOrder
  }
  if (a.parentOrder != null) return -1
  if (b.parentOrder != null) return 1
  return 0
}

function sortGroupItems(
  items: WatchLanguageInventoryCard[],
): WatchLanguageInventoryCard[] {
  const rankedItems = items.map((item, index) => ({
    item,
    index,
    sequence: titleSequenceParts(item.title),
  }))
  const sequencedCount = rankedItems.filter(
    ({ sequence }) => sequence != null,
  ).length
  const useTitleSequence = sequencedCount >= 2

  return rankedItems
    .sort((a, b) => {
      if (useTitleSequence) {
        if (a.sequence && b.sequence) {
          const sequenceOrder = compareSequenceParts(a.sequence, b.sequence)
          if (sequenceOrder !== 0) return sequenceOrder
        } else if (a.sequence) {
          return -1
        } else if (b.sequence) {
          return 1
        }
      }

      return compareParentOrder(a.item, b.item) || a.index - b.index
    })
    .map(({ item }) => item)
}

function InventoryCardFrame({
  assistToken,
  href,
  title,
  className,
  children,
  ...facetAttributes
}: {
  assistToken: EnglishAssistToken
  href: Route | null
  title: string
  className: string
  children: ReactNode
} & Record<`data-inv-${string}`, string>) {
  if (!href) {
    return (
      <div aria-label={title} className={className} {...facetAttributes}>
        {children}
      </div>
    )
  }

  return (
    <Link
      href={href}
      aria-label={title}
      className={className}
      {...englishAssistAttributes(assistToken)}
      {...facetAttributes}
    >
      {children}
    </Link>
  )
}

function inventoryFacetAttributes(item: WatchLanguageInventoryCard) {
  const facets = inventoryFilterFacets(item, new Date())
  return {
    "data-inv-item": "",
    "data-inv-length": facets.length ?? "unknown",
    "data-inv-type": facets.type ?? "unknown",
    // Numeric so the date filter can compare cumulatively against any window
    // without emitting one attribute per bucket. `unknown` for undated rows,
    // which then match no window.
    //
    // Only attributes a filter actually READS are emitted: this page ships
    // ~9.5MB of HTML, and an unread attribute across ~990 items is pure weight.
    "data-inv-age-days":
      facets.ageDays == null ? "unknown" : String(facets.ageDays),
  } as const
}

function InventoryCard({
  item,
  index,
}: {
  item: WatchLanguageInventoryCard
  index: number
}) {
  const t = useTranslations("LanguageInventory")
  const videoLabels = useTranslations("VideoLabels")
  const runtime = formatRuntime(item.durationSeconds)
  const meta =
    item.childCount > 0
      ? t("videoCount", { count: item.childCount })
      : (runtime ?? videoLabels(videoLabelMessageKey(item.label)))
  const availability =
    item.availability === "AUDIO" ? t("dubbed") : t("subtitles")
  const isInteractive = Boolean(item.href)
  const thumbnailUrl = cardImageUrl(item)
  const frameClassName = cn(
    "relative block h-full overflow-hidden rounded-lg bg-stone-900 text-left text-inherit shadow-xl shadow-black/35 ring-1 ring-white/10 transition duration-300",
    isInteractive && "group hover:-translate-y-1",
    isInteractive && VIDEO_THUMBNAIL_FOCUS_TARGET_CLASS,
  )

  return (
    <InventoryCardFrame
      assistToken={item.childCount > 0 ? "openCollection" : "openVideo"}
      href={item.href}
      title={item.title}
      className={frameClassName}
      {...inventoryFacetAttributes(item)}
    >
      <div className="relative aspect-video w-full overflow-hidden bg-stone-800">
        {thumbnailUrl ? (
          <Image
            src={thumbnailUrl}
            alt={item.imageAlt}
            fill
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 360px"
            className="object-cover object-left-top transition duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="absolute inset-0 bg-[linear-gradient(135deg,#171717,#3f3f46_48%,#134e4a)]" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/15 to-transparent" />
        {isInteractive ? (
          <VideoThumbnailInteractionFrame data-testid="language-inventory-thumbnail-frame" />
        ) : null}
        <div
          className="absolute top-3 left-3 inline-flex items-center gap-1 rounded bg-black/45 px-2.5 py-1 text-sm sm:text-xs font-medium text-white backdrop-blur"
          {...englishAssistAttributes(
            item.availability === "AUDIO" ? "stateAudio" : "stateSubtitlesOnly",
          )}
        >
          {item.availability === "AUDIO" ? (
            <Headphones className="h-3.5 w-3.5" aria-hidden />
          ) : (
            <Captions className="h-3.5 w-3.5" aria-hidden />
          )}
          {availability}
        </div>
        <div className="absolute right-3 bottom-3 inline-flex items-center gap-1 rounded bg-black/45 px-2.5 py-1 text-sm sm:text-xs font-medium text-white backdrop-blur">
          {item.childCount === 0 && item.href ? (
            <Play className="h-3.5 w-3.5 fill-current" aria-hidden />
          ) : null}
          {meta}
        </div>
      </div>
      <div className="space-y-2 p-4">
        <div className="flex items-center gap-2 text-sm sm:text-xs leading-5 font-medium tracking-media-label text-stone-300/80 uppercase">
          <span>{videoLabels(videoLabelMessageKey(item.label))}</span>
        </div>
        <h3 className="line-clamp-2 text-lg leading-tight font-media-card-title break-words text-white">
          {item.title}
        </h3>
        {item.description ? (
          <p className="line-clamp-2 text-base sm:text-sm leading-relaxed font-normal break-words text-stone-300">
            {item.description}
          </p>
        ) : null}
        {item.parentTitle ? (
          <p className="line-clamp-1 text-sm sm:text-xs font-medium text-stone-400">
            {t("fromCollection", { collection: item.parentTitle })}
          </p>
        ) : null}
      </div>
      <span
        aria-hidden="true"
        className="absolute top-3 right-3 rounded bg-white/10 px-2 py-1 text-sm sm:text-xs font-medium text-white/70 tabular-nums"
      >
        {index + 1}
      </span>
    </InventoryCardFrame>
  )
}

type GroupedInventoryVideos = {
  key: string
  title: string
  collection: WatchLanguageInventoryCard | null
  items: WatchLanguageInventoryCard[]
}

// Collection groups are ordered newest release first.
//
// The key is the COLLECTION's own `publishedAt`, parsed through the same
// `parsePublishedAt` the new-release badge uses — sharing the parser is what
// stops the badge from contradicting the order (a divergent parse would put a
// badged series below an unbadged one).
//
// Ties are the common case, not the exception: `publishedAt` is date-only, so
// three English collections share 2026-04-23. Ties fall back to admin's
// original order rather than an alphabetical reshuffle, which leaves curation
// intact within a release date.
//
// Returns null — not -Infinity — for groups with no collection (the standalone
// bucket) or an unusable date. An -Infinity sentinel would make
// `bTime - aTime` NaN whenever BOTH groups are undated, and ECMA-262 leaves the
// order implementation-defined once a comparator returns a non-number. This is
// defensive, not a fix for an observed bug: measured on node 24.19.0
// (2026-08-27), V8 treats a NaN result as "equal", so the sentinel version
// currently produces the same order on both the insertion-sort and TimSort
// paths — which is exactly why no test can catch it and the shape has to be
// right by construction.
function collectionReleaseTime(
  group: GroupedInventoryVideos,
  now: Date,
): number | null {
  const publishedAt = group.collection?.publishedAt
  if (!publishedAt) return null
  // `publishedAtSortTime` rejects an implausibly far-future date, so one bad
  // row cannot pin its collection to the top of the page (and, through the
  // hero rule, take the hero as well).
  const parsed = publishedAtSortTime(publishedAt, now)
  return Number.isNaN(parsed) ? null : parsed
}

function compareCollectionRelease(
  a: GroupedInventoryVideos,
  b: GroupedInventoryVideos,
  now: Date,
): number {
  const aTime = collectionReleaseTime(a, now)
  const bTime = collectionReleaseTime(b, now)
  if (aTime != null && bTime != null) return bTime - aTime
  if (aTime != null) return -1
  if (bTime != null) return 1
  return 0
}

function groupVideosByParent(
  items: WatchLanguageInventoryCard[],
  collections: WatchLanguageInventoryCard[],
  standaloneTitle: string,
  now: Date,
): GroupedInventoryVideos[] {
  const groups = new Map<string, GroupedInventoryVideos>()
  const collectionsBySlug = new Map(
    collections.map((collection) => [collection.slug, collection]),
  )
  const collectionsByTitle = new Map(
    collections.map((collection) => [
      collection.title.trim().toLocaleLowerCase("en"),
      collection,
    ]),
  )

  for (const item of items) {
    const collection =
      (item.parentSlug ? collectionsBySlug.get(item.parentSlug) : null) ??
      (item.parentTitle
        ? collectionsByTitle.get(
            item.parentTitle.trim().toLocaleLowerCase("en"),
          )
        : null) ??
      null
    const title =
      collection?.title ?? item.parentTitle?.trim() ?? standaloneTitle
    const key = item.parentSlug
      ? `parent:${item.parentSlug}`
      : collection
        ? `collection:${collection.slug}`
        : `standalone:${title.toLocaleLowerCase("en")}`
    const group = groups.get(key)

    if (group) {
      if (!group.collection && collection) group.collection = collection
      group.items.push(item)
    } else {
      groups.set(key, {
        key,
        title,
        collection,
        items: [item],
      })
    }
  }

  return [...groups.values()]
    .map((group, index) => ({ group, index }))
    .sort(
      (a, b) =>
        compareCollectionRelease(a.group, b.group, now) || a.index - b.index,
    )
    .map(({ group }) => ({
      ...group,
      items: sortGroupItems(group.items),
    }))
}

function CompactVideoRow({
  item,
  index,
}: {
  item: WatchLanguageInventoryCard
  index: number
}) {
  const videoLabels = useTranslations("VideoLabels")
  const runtime = formatRuntime(item.durationSeconds)
  const thumbnailUrl = cardImageUrl(item)
  const isPortrait = isPortraitInventoryVideo(item)
  const metadata = [videoLabels(videoLabelMessageKey(item.label)), runtime]
    .filter((value): value is string => Boolean(value))
    .join(" / ")
  const content = (
    <>
      <span className="mr-1 w-10 shrink-0 text-right text-base font-medium text-stone-500 tabular-nums sm:mr-2 sm:text-lg">
        {index + 1}
      </span>
      <span
        className={cn(
          "relative shrink-0 overflow-hidden rounded bg-stone-800 ring-1 ring-white/10",
          isPortrait
            ? "h-12 aspect-[2/3] sm:h-14"
            : "h-12 w-20 sm:h-14 sm:w-24",
        )}
      >
        {thumbnailUrl ? (
          <Image
            src={thumbnailUrl}
            alt=""
            fill
            sizes={
              isPortrait
                ? "(max-width: 640px) 32px, 37px"
                : "(max-width: 640px) 80px, 96px"
            }
            className={cn(
              "object-cover transition duration-300 group-hover:scale-105",
              isPortrait ? "object-center" : "object-left-top",
            )}
          />
        ) : (
          <span className="absolute inset-0 bg-[linear-gradient(135deg,#1c1917,#44403c_55%,#292524)]" />
        )}
        <span
          className="absolute inset-0 bg-gradient-to-t from-black/65 via-black/10 to-transparent"
          aria-hidden
        />
        {item.href ? (
          <span className="absolute bottom-1.5 left-1.5 grid size-6 place-items-center rounded bg-black/60 text-amber-100 backdrop-blur">
            <Play className="h-3.5 w-3.5 fill-current" aria-hidden />
          </span>
        ) : null}
        {item.href ? (
          <VideoThumbnailInteractionFrame data-testid="language-inventory-compact-thumbnail-frame" />
        ) : null}
      </span>
      <span className="min-w-0 flex-1">
        {/* Two lines on phones: the row is `min-h-20`, so the 16px phone tier
            gets its second line for free rather than clamping a title that
            fitted on one line at 14px. */}
        <span className="line-clamp-2 text-base sm:line-clamp-1 sm:text-sm leading-tight font-media-card-title text-white">
          {item.title}
        </span>
        {metadata ? (
          <span className="mt-0.5 block truncate text-sm sm:text-xs leading-5 font-medium tracking-media-label text-stone-400 uppercase">
            {metadata}
          </span>
        ) : null}
      </span>
    </>
  )
  const className = cn(
    "flex min-h-20 items-center gap-3 px-3 py-4 transition sm:px-4",
    item.href && "group hover:bg-white/[0.055]",
    item.href && VIDEO_THUMBNAIL_FOCUS_TARGET_CLASS,
  )

  const facetAttributes = inventoryFacetAttributes(item)

  if (!item.href) {
    return (
      <div className={className} {...facetAttributes}>
        {content}
      </div>
    )
  }

  return (
    <Link
      href={item.href}
      className={className}
      {...englishAssistAttributes("openVideo")}
      {...facetAttributes}
    >
      {content}
    </Link>
  )
}

// Same shape as the single-video page's intro meta row (HeroPlayer's
// `hero-player-language-tag` / `hero-player-subtitle-language-count`): the
// audio-bars glyph, then the caption glyph, each followed by a pluralized
// count, at the same size/weight/opacity. The copy reuses HeroPlayer's own
// `audioTranslationCount` / `subtitleCount` messages so the two surfaces can
// never phrase or pluralize the same number differently.
function CollectionLanguageAvailability({
  counts,
}: {
  counts: WatchCollectionLanguageCounts
}) {
  const heroPlayer = useTranslations("HeroPlayer")
  const hasAudio = counts.audioLanguageCount > 0
  const hasSubtitles = counts.subtitleLanguageCount > 0
  // A collection with neither renders nothing at all rather than "0 languages".
  if (!hasAudio && !hasSubtitles) return null

  return (
    <div
      data-testid="language-inventory-collection-languages"
      className="flex flex-wrap items-center gap-2 pt-1 opacity-75"
    >
      {hasAudio ? (
        <span
          data-testid="language-inventory-collection-audio-languages"
          className={WATCH_LANGUAGE_TAG_CLASS}
        >
          <AudioLanguagesIcon />
          <span>
            {heroPlayer("audioTranslationCount", {
              count: counts.audioLanguageCount,
            })}
          </span>
        </span>
      ) : null}
      {hasSubtitles ? (
        <span
          data-testid="language-inventory-collection-subtitle-languages"
          className={WATCH_LANGUAGE_TAG_CLASS}
        >
          <Captions className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>
            {heroPlayer("subtitleCount", {
              count: counts.subtitleLanguageCount,
            })}
          </span>
        </span>
      ) : null}
    </div>
  )
}

function NewReleaseBadge() {
  const t = useTranslations("LanguageInventory")
  return (
    <span
      data-testid="language-inventory-new-release-badge"
      className="inline-flex shrink-0 items-center rounded-full bg-brand-red px-2 py-0.5 text-xs leading-4 font-medium tracking-media-label text-white uppercase sm:text-[10px]"
      {...englishAssistAttributes("stateNew")}
    >
      {t("new")}
    </span>
  )
}

/// The artwork a collection group presents — used BOTH for the panel thumbnail
/// and for the sidebar's blurred backdrop, so the two always agree.
function collectionGroupImageUrl(group: GroupedInventoryVideos): string | null {
  return preferAuthoredImageUrl([group.collection, group.items[0]])
}

function CollectionGroupOverview({
  group,
  languageCounts,
}: {
  group: GroupedInventoryVideos
  languageCounts: WatchCollectionLanguageCounts | undefined
}) {
  const t = useTranslations("LanguageInventory")
  const videoLabels = useTranslations("VideoLabels")
  const collection = group.collection
  const heroImage = collectionGroupImageUrl(group)
  const imageAlt =
    collection?.imageAlt ?? group.items[0]?.imageAlt ?? group.title
  const label = collection
    ? videoLabels(videoLabelMessageKey(collection.label))
    : videoLabels("collection")
  const title = collection?.title ?? group.title
  const isNew = isNewRelease(collection?.publishedAt, new Date())
  const description =
    collection?.description ??
    (group.items[0]?.parentTitle
      ? t("videosFromCollection", { collection: group.title })
      : t("standaloneDescription"))

  return (
    <div className="group flex h-full flex-col">
      <div className="relative aspect-video overflow-hidden rounded bg-stone-800 ring-1 ring-white/10">
        {heroImage ? (
          <Image
            src={heroImage}
            alt={imageAlt}
            fill
            sizes="(max-width: 1024px) 100vw, 320px"
            className="object-cover object-left-top transition duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="absolute inset-0 bg-[linear-gradient(135deg,#171717,#3f3f46_48%,#134e4a)]" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/10 to-transparent" />
        <span className="absolute right-3 bottom-3 rounded bg-black/55 px-2.5 py-1 text-sm sm:text-xs font-medium text-white backdrop-blur">
          {t("videoCount", { count: group.items.length })}
        </span>
      </div>
      <div className="mt-4 flex flex-1 flex-col space-y-2">
        <div className="flex w-full items-center gap-2">
          <span className="min-w-0 truncate text-sm sm:text-xs leading-5 font-medium tracking-media-label text-stone-300/80 uppercase">
            {label}
          </span>
          {isNew ? <NewReleaseBadge /> : null}
        </div>
        <h3 className="text-xl leading-tight font-media-card-title break-words text-white">
          {title}
        </h3>
        {collection?.href ? (
          <Link
            href={collection.href}
            data-slot="button"
            className={cn(
              buttonVariants({
                variant: "pill",
                className: WATCH_PILL_BUTTON_CLASS,
              }),
              // `self-start` so the pill hugs its label instead of stretching
              // to the column now that the column stretches its children.
              //
              // The rest bounds the label: `buttonVariants` sets
              // `whitespace-nowrap`, so the longest catalog value ("Fosgail a’
              // chruinneachadh", gd — 25 chars vs English's 15) renders a 279px
              // pill and spills 19px out of the narrowest 260px sidebar column.
              // Same antidote BibleQuotesSection already uses for its pills.
              "mt-2 max-w-full self-start text-center leading-tight break-words whitespace-normal",
            )}
            {...englishAssistAttributes("openCollection")}
          >
            <span>{t("openCollection")}</span>
            <ArrowUpRight aria-hidden size={18} />
          </Link>
        ) : null}
        {languageCounts ? (
          <CollectionLanguageAvailability counts={languageCounts} />
        ) : null}
        {description ? (
          <p className="line-clamp-4 pt-1 text-base sm:text-sm leading-relaxed font-normal break-words text-stone-300">
            {description}
          </p>
        ) : null}
      </div>
    </div>
  )
}

function GroupedVideoListSection({
  id,
  eyebrow,
  title,
  description,
  icon: Icon,
  groups,
  languageCounts,
  totalItems,
  testId,
}: {
  id: string
  eyebrow: string
  title: string
  description: string
  icon: IconComponent
  groups: GroupedInventoryVideos[]
  languageCounts: Record<string, WatchCollectionLanguageCounts>
  totalItems: number
  testId: string
}) {
  const t = useTranslations("LanguageInventory")
  // An empty catalog renders nothing at all — heading, count, and a "none yet"
  // box is more chrome than information.
  if (groups.length === 0) return null

  return (
    <section
      id={id}
      className="scroll-mt-80 border-t border-white/10 py-14 xl:scroll-mt-44"
      data-testid={testId}
      data-inv-section=""
    >
      <div className={WATCH_PAGE_CONTENT_CLASSES}>
        <div className="mb-7 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="max-w-3xl">
            <div
              data-testid="language-inventory-section-eyebrow"
              className={cn(
                "mb-3 flex items-center gap-2",
                WATCH_SECTION_EYEBROW_CLASS,
              )}
              {...englishAssistAttributes("labelCollections")}
            >
              <Icon className="h-4 w-4" aria-hidden />
              {eyebrow}
            </div>
            <h2 className="text-lg leading-[1.08] font-semibold text-stone-100 sm:text-[27px] md:text-4xl xl:text-5xl">
              {title}
            </h2>
            <p className="mt-3 max-w-2xl text-base leading-relaxed font-normal text-stone-200/80 md:text-lg">
              {description}
            </p>
          </div>
          <div
            className="text-base sm:text-sm font-medium text-stone-400"
            {...englishAssistAttributes("labelItemCount")}
          >
            {t("videosInGroups", {
              videoCount: totalItems,
              groupCount: groups.length,
            })}
          </div>
        </div>

        <div className="space-y-4">
          {groups.map((group) => {
            const groupImageUrl = collectionGroupImageUrl(group)
            return (
              <section
                key={group.key}
                // The sidebar gets a wider track from `xl` up: at 1280px the
                // group is 1201px wide and 340px left the collection panel only
                // 28% of it, cramping the title and description against a
                // 859px-wide episode list. Keep the 440px maximum at wider
                // breakpoints so the episode list receives the added rail space.
                className="overflow-clip rounded-lg border border-white/10 bg-white/[0.035] lg:grid lg:grid-cols-[minmax(260px,340px)_minmax(0,1fr)] xl:grid-cols-[minmax(320px,440px)_minmax(0,1fr)]"
                aria-label={group.title}
                data-testid="language-inventory-collection-group"
                data-inv-group=""
              >
                <div
                  // `overflow-clip`, NOT `overflow-hidden`: the panel inside is
                  // `lg:sticky`, and `overflow: hidden` on an ancestor makes it
                  // the sticky scroll container, which kills the stick. Same
                  // reason the group wrapper above uses `overflow-clip`.
                  className="relative overflow-clip border-b border-white/10 p-4 lg:border-r lg:border-b-0 lg:p-5"
                  data-testid="language-inventory-collection-sidebar"
                  style={{ backgroundColor: WATCH_IMMERSIVE_BACKGROUND_COLOR }}
                >
                  {/* Same immersive backdrop as authored Experience collection
                    sections: `MediaCollection` reads these exact shared
                    constants, so blur, brightness, and base colour cannot
                    drift between the two surfaces. */}
                  {groupImageUrl ? (
                    <div
                      aria-hidden
                      data-testid="language-inventory-collection-backdrop"
                      className={cn(
                        WATCH_IMMERSIVE_BACKDROP_CLASS,
                        WATCH_IMMERSIVE_BACKGROUND_BRIGHTNESS_CLASS,
                        WATCH_IMMERSIVE_BACKGROUND_SATURATION_CLASS,
                      )}
                      style={{ backgroundImage: `url("${groupImageUrl}")` }}
                    />
                  ) : null}
                  <div
                    className="relative z-[1] lg:sticky lg:top-[calc(env(safe-area-inset-top,0px)+7rem)]"
                    data-testid="language-inventory-collection-overview"
                  >
                    <CollectionGroupOverview
                      group={group}
                      languageCounts={
                        group.collection
                          ? languageCounts[group.collection.slug]
                          : undefined
                      }
                    />
                  </div>
                </div>
                <div className="divide-y divide-white/10">
                  {group.items.map((item, index) => (
                    <CompactVideoRow key={item.id} item={item} index={index} />
                  ))}
                </div>
              </section>
            )
          })}
        </div>
      </div>
    </section>
  )
}

function InventorySection({
  assistToken,
  id,
  eyebrow,
  title,
  description,
  icon: Icon,
  items,
  testId,
}: {
  assistToken: EnglishAssistToken
  id: string
  eyebrow: string
  title: string
  description: string
  icon: IconComponent
  items: WatchLanguageInventoryCard[]
  testId: string
}) {
  const t = useTranslations("LanguageInventory")
  if (items.length === 0) return null

  return (
    <section
      id={id}
      className="scroll-mt-80 border-t border-white/10 py-14 xl:scroll-mt-44"
      data-testid={testId}
      data-inv-section=""
    >
      <div className={WATCH_PAGE_CONTENT_CLASSES}>
        <div className="mb-7 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="max-w-3xl">
            <div
              data-testid="language-inventory-section-eyebrow"
              className={cn(
                "mb-3 flex items-center gap-2",
                WATCH_SECTION_EYEBROW_CLASS,
              )}
              {...englishAssistAttributes(assistToken)}
            >
              <Icon className="h-4 w-4" aria-hidden />
              {eyebrow}
            </div>
            <h2 className="text-lg leading-[1.08] font-semibold text-stone-100 sm:text-[27px] md:text-4xl xl:text-5xl">
              {title}
            </h2>
            <p className="mt-3 max-w-2xl text-base leading-relaxed font-normal text-stone-200/80 md:text-lg">
              {description}
            </p>
          </div>
          <div
            className="text-base sm:text-sm font-medium text-stone-400"
            {...englishAssistAttributes("labelItemCount")}
          >
            {t("itemCount", { count: items.length })}
          </div>
        </div>

        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {items.map((item, index) => (
            <InventoryCard key={item.id} item={item} index={index} />
          ))}
        </div>
      </div>
    </section>
  )
}

export function LanguageInventoryPage({
  inventory,
}: LanguageInventoryPageProps) {
  const t = useTranslations("LanguageInventory")
  const languageDisplayName =
    inventory.languageNativeName?.trim() || inventory.languageName
  const now = new Date()
  const groupedAudioVideos = groupVideosByParent(
    inventory.audioVideos,
    inventory.audioCollections,
    t("standaloneVideos"),
    now,
  )
  // The hero shows the FIRST collection rendered on the page — the newest
  // release, since `groupVideosByParent` sorts newest-first — so the artwork
  // above the fold matches the first thing a visitor scrolls to. It used to
  // prefer `promoted`, which is why English showed the Jesus Film wordmark
  // rather than anything in the catalog below.
  //
  // Falls back through the old preference chain when the first group carries no
  // usable artwork, and `preferAuthoredImageUrl` still puts authored artwork
  // ahead of a synthesized Mux frame within each tier.
  // Scans the WHOLE first group, not just its first item: every card can
  // synthesize a Mux frame, so a two-element `[collection, items[0]]` scan
  // would hand the hero a frame whenever the group's authored artwork happens
  // to sit on a later episode. `preferAuthoredImageUrl` does the two passes.
  const firstCollectionGroup = groupedAudioVideos[0]
  // AUTHORED artwork only at each tier. `preferAuthoredImageUrl` falls back to a
  // synthesized 448x252 Mux frame, which would (a) make every later tier dead
  // code and (b) hand this `priority` / `sizes="100vw"` LCP image an upscaled
  // thumbnail. A frame is acceptable only once no authored artwork exists
  // anywhere on the page.
  const heroImage =
    authoredImageUrl([
      firstCollectionGroup?.collection,
      ...(firstCollectionGroup?.items ?? []),
    ]) ??
    authoredImageUrl([
      ...inventory.audioCollections,
      ...inventory.audioVideos,
      ...inventory.promoted,
      ...inventory.subtitleOnlyVideos,
    ]) ??
    preferAuthoredImageUrl([
      firstCollectionGroup?.collection,
      ...(firstCollectionGroup?.items ?? []),
    ])

  return (
    <main
      className="min-h-screen bg-stone-950 text-stone-100"
      data-testid="language-inventory-page"
    >
      <section
        id={LANGUAGE_INVENTORY_TOP_ID}
        // No `border-b`: the filter bar follows directly, and this rule was the
        // line that showed above FILTERS. Zeroing the filter section's own
        // `border-t` was not enough — this border sits at the same boundary.
        className="relative isolate overflow-hidden bg-stone-950"
      >
        {heroImage ? (
          <Image
            src={heroImage}
            alt=""
            fill
            priority
            sizes="100vw"
            className="object-cover object-left-top opacity-60"
          />
        ) : null}
        <div
          className="absolute inset-0 bg-[linear-gradient(90deg,rgba(12,10,9,.92),rgba(12,10,9,.6)_48%,rgba(12,10,9,.24)),linear-gradient(0deg,rgba(12,10,9,.96),rgba(12,10,9,.04)_46%,rgba(12,10,9,.7))]"
          aria-hidden
        />
        {/* 54vh is three quarters of the previous 72vh. Read as "reduce to 3/4"
            rather than a 3:4 aspect ratio: the hero is already 2.2:1, so a 3:4
            ratio would have made it ~3x TALLER, not shorter. */}
        <div
          className={`relative grid min-h-[54vh] items-end gap-8 pt-36 pb-10 sm:pt-40 lg:grid-cols-[minmax(0,1fr)_minmax(320px,420px)] lg:gap-10 lg:pt-44 ${WATCH_PAGE_CONTENT_CLASSES}`}
        >
          <div className="max-w-4xl">
            <h1 className="text-2xl leading-[1.08] font-bold text-balance break-words text-white drop-shadow-lg sm:text-4xl md:max-w-[18ch] md:text-6xl xl:max-w-[20ch] xl:text-7xl">
              {t("heroTitle", { language: languageDisplayName })}
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-relaxed font-normal text-stone-200/80 md:text-lg">
              {t("heroDescription", { language: languageDisplayName })}
            </p>
          </div>
          <LanguageCollectionSwitcher
            className="max-w-none lg:justify-self-end lg:pb-2"
            currentLanguageName={inventory.languageName}
            currentNativeName={inventory.languageNativeName}
            currentSlug={inventory.languageSlug}
            languages={inventory.switcherLanguages}
            totalItems={inventory.counts.total}
          />
        </div>
      </section>

      <InventoryFilterShell>
        <GroupedVideoListSection
          id="audio-collections"
          eyebrow={t("fullyDubbed")}
          title={t("dubbedVideosTitle", { language: languageDisplayName })}
          description={t("dubbedVideosDescription", {
            language: languageDisplayName,
          })}
          icon={Library}
          groups={groupedAudioVideos}
          languageCounts={inventory.collectionLanguageCounts}
          totalItems={inventory.audioVideos.length}
          testId="language-inventory-audio-collections"
        />

        {/* Both sections hide themselves when empty, so without this the page
          could render as a bare hero. The route only 404s on an unrecognized
          language slug, not on an empty inventory, so that state is reachable. */}
        {groupedAudioVideos.length === 0 &&
        inventory.subtitleOnlyVideos.length === 0 ? (
          <section
            className="border-t border-white/10 py-14"
            data-testid="language-inventory-empty"
          >
            <div className={WATCH_PAGE_CONTENT_CLASSES}>
              <p className="rounded-lg border border-white/10 bg-white/[0.04] px-5 py-8 text-stone-300">
                {t("noPublishedVideos")}
              </p>
            </div>
          </section>
        ) : null}

        <InventorySection
          assistToken="labelSubtitlesOnly"
          id="subtitles-only"
          eyebrow={t("subtitlesAvailable")}
          title={t("subtitlesTitle", { language: languageDisplayName })}
          description={t("subtitlesDescription", {
            language: languageDisplayName,
          })}
          icon={Captions}
          items={inventory.subtitleOnlyVideos}
          testId="language-inventory-subtitle-only"
        />
      </InventoryFilterShell>

      {/* A link, not a button: this navigates within the document, so it needs
          no client JavaScript and keeps this Server Component free of a client
          boundary. Styled as the shared watch pill, like "Open collection". */}
      <div className="border-t border-white/10 py-10">
        <div className={`flex justify-center ${WATCH_PAGE_CONTENT_CLASSES}`}>
          <a
            href={`#${LANGUAGE_INVENTORY_TOP_ID}`}
            data-slot="button"
            data-testid="language-inventory-back-to-top"
            className={cn(
              buttonVariants({
                variant: "pill",
                className: WATCH_PILL_BUTTON_CLASS,
              }),
              "max-w-full text-center leading-tight break-words whitespace-normal",
            )}
          >
            <ArrowUp aria-hidden size={18} />
            <span>{t("backToTop")}</span>
          </a>
        </div>
      </div>
    </main>
  )
}
