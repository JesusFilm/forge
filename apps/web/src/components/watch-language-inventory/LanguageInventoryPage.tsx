import type { ComponentType, ReactNode } from "react"
import type { Route } from "next"
import Image from "next/image"
import Link from "next/link"
import { useFormatter, useTranslations } from "next-intl"
import {
  ArrowUpRight,
  BookOpen,
  Captions,
  Clock,
  Headphones,
  Library,
  Play,
  Sparkles,
  Trophy,
} from "lucide-react"

import {
  Carousel,
  CarouselContent,
  CarouselItem,
} from "@/components/ui/carousel"
import {
  VIDEO_THUMBNAIL_FOCUS_TARGET_CLASS,
  VideoThumbnailInteractionFrame,
} from "@/components/ui/video-thumbnail-interaction-frame"
import { WatchHomeSection } from "@/components/home/WatchHomeSection"
import type { WatchHomeSection as WatchHomeSectionModel } from "@/lib/watch-home"
import { cn } from "@/lib/utils"
import { videoLabelMessageKey } from "@/lib/video-labels"
import { isolateBidiDisplayText } from "@/lib/bidi"
import {
  type WatchLanguageInventoryCard,
  type WatchLanguageInventoryModel,
} from "@/lib/watch-language-inventory"
import { LanguageCollectionSwitcher } from "./LanguageCollectionSwitcher"

type IconComponent = ComponentType<{ className?: string }>

type LanguageInventoryPageProps = {
  inventory: WatchLanguageInventoryModel
  homeSections?: WatchHomeSectionModel[]
}

const VIDEO_BIBLE_COLLECTION_SLUGS = new Set([
  "lumo",
  "lumo-the-gospel-of-matthew",
  "lumo-the-gospel-of-mark",
  "lumo-the-gospel-of-luke",
  "lumo-the-gospel-of-john",
  "jesus",
  "jesus-film",
  "the-jesus-film",
  "magdalena",
  "book-of-acts-bible-study",
  "acts-bible-study",
  "hechos-de-los-apostoles",
])
const VIDEO_BIBLE_COLLECTION_PATTERN =
  /\b(lumo|magdalena|acts|hechos)\b|\bjesus[-\s]+film\b/i
const BIBLE_PROJECT_COLLECTION_SLUGS = new Set([
  "bp-spiritual-beings",
  "shema-listen",
  "sermon-on-the-mount-bp",
  "how-to-read-bible",
  "advent-series",
])
const BIBLE_PROJECT_COLLECTION_PATTERN = /\b(bibleproject|bible project)\b/i
const SPORTS_COLLECTION_SLUGS = new Set([
  "sports",
  "soccer_event_collection",
  "brazil-2014",
  "dealing-with-winning",
  "dealing-with-loss",
  "dealing-with-injury",
  "is-it-worth-it",
])
const SPORTS_COLLECTION_PATTERN =
  /\b(sport|sports|deporte|deportes|soccer|football|f[uú]tbol|world cup|copa mundial|athlete|athletes|atleta|atletas|olympic|ol[ií]mpic|winning|victoria|injury|lesiones)\b/i

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

function SectionMetricAnchor({
  href,
  icon: Icon,
  label,
  tone,
  value,
}: {
  href: string
  icon: IconComponent
  label: string
  tone: "blue" | "violet" | "indigo" | "magenta" | "amber" | "teal"
  value: number
}) {
  const t = useTranslations("LanguageInventory")
  const format = useFormatter()
  const toneClass = {
    blue: "border-sky-300/25 bg-[linear-gradient(135deg,#0f3f9d,#0f8ee8_58%,#155e75)]",
    violet:
      "border-violet-300/25 bg-[linear-gradient(135deg,#2e1065,#6d28d9_56%,#1d4ed8)]",
    indigo:
      "border-indigo-300/25 bg-[linear-gradient(135deg,#1e1b4b,#4338ca_52%,#0f766e)]",
    magenta:
      "border-fuchsia-300/25 bg-[linear-gradient(135deg,#701a75,#9d174d_55%,#431407)]",
    amber:
      "border-amber-200/30 bg-[linear-gradient(135deg,#713f12,#b45309_55%,#365314)]",
    teal: "border-teal-200/25 bg-[linear-gradient(135deg,#134e4a,#0f766e_52%,#164e63)]",
  }[tone]

  return (
    <a
      href={href}
      aria-label={t("sectionMetricLabel", { label, count: value })}
      className={cn(
        "group relative flex aspect-[3/4] w-[9.5rem] flex-col overflow-hidden rounded-lg border p-4 text-white shadow-2xl shadow-black/30 transition duration-300 hover:-translate-y-0.5 hover:shadow-black/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 sm:w-[11rem] lg:w-[12rem]",
        toneClass,
      )}
    >
      <span
        className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,.08),rgba(255,255,255,0)_38%,rgba(0,0,0,.24))]"
        aria-hidden
      />
      <Icon
        className="relative h-7 w-7 text-amber-100 drop-shadow-sm sm:h-8 sm:w-8"
        aria-hidden
      />
      <span className="relative mt-auto block">
        <span className="block text-xs leading-tight font-medium text-white/68 sm:text-sm">
          {label}
        </span>
        <span className="mt-2 block text-4xl leading-none font-medium tracking-normal text-white sm:text-[50px]">
          {format.number(value)}
        </span>
      </span>
    </a>
  )
}

function InventoryCardFrame({
  href,
  title,
  className,
  children,
}: {
  href: Route | null
  title: string
  className: string
  children: ReactNode
}) {
  if (!href) {
    return (
      <div aria-label={title} className={className}>
        {children}
      </div>
    )
  }

  return (
    <Link href={href} aria-label={title} className={className}>
      {children}
    </Link>
  )
}

function isVideoBibleCollection(item: WatchLanguageInventoryCard): boolean {
  if (VIDEO_BIBLE_COLLECTION_SLUGS.has(item.slug)) return true

  const normalizedTitle = item.title.trim().toLocaleLowerCase("en")
  if (normalizedTitle === "jesus" || normalizedTitle === "jesús") return true

  return [item.slug, item.title]
    .filter((value): value is string => Boolean(value))
    .some((value) => VIDEO_BIBLE_COLLECTION_PATTERN.test(value))
}

function isBibleProjectCollection(item: WatchLanguageInventoryCard): boolean {
  if (BIBLE_PROJECT_COLLECTION_SLUGS.has(item.slug)) return true

  return [item.title, item.description, item.label]
    .filter((value): value is string => Boolean(value))
    .some((value) => BIBLE_PROJECT_COLLECTION_PATTERN.test(value))
}

function isSportsCollection(item: WatchLanguageInventoryCard): boolean {
  if (SPORTS_COLLECTION_SLUGS.has(item.slug)) return true

  return [item.title, item.description, item.label]
    .filter((value): value is string => Boolean(value))
    .some((value) => SPORTS_COLLECTION_PATTERN.test(value))
}

function InventoryCard({
  item,
  index,
  promoted = false,
}: {
  item: WatchLanguageInventoryCard
  index: number
  promoted?: boolean
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
  const frameClassName = cn(
    "relative block h-full overflow-hidden rounded-lg bg-stone-900 text-start text-inherit shadow-xl shadow-black/35 ring-1 ring-white/10 transition duration-300",
    isInteractive && "group hover:-translate-y-1",
    isInteractive && VIDEO_THUMBNAIL_FOCUS_TARGET_CLASS,
    promoted ? "min-w-[78vw] sm:min-w-[340px] lg:min-w-[380px]" : "",
  )

  return (
    <InventoryCardFrame
      href={item.href}
      title={item.title}
      className={frameClassName}
    >
      <div className="relative aspect-video w-full overflow-hidden bg-stone-800">
        {item.imageUrl ? (
          <Image
            src={item.imageUrl}
            alt={item.imageAlt}
            fill
            sizes={
              promoted
                ? "(max-width: 640px) 78vw, 380px"
                : "(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 360px"
            }
            className="object-cover object-left-top transition duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="absolute inset-0 bg-[linear-gradient(135deg,#171717,#3f3f46_48%,#134e4a)]" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/15 to-transparent" />
        {isInteractive ? (
          <VideoThumbnailInteractionFrame data-testid="language-inventory-thumbnail-frame" />
        ) : null}
        <div className="absolute top-3 left-3 inline-flex items-center gap-1 rounded bg-black/45 px-2.5 py-1 text-xs font-bold text-white backdrop-blur">
          {item.availability === "AUDIO" ? (
            <Headphones className="h-3.5 w-3.5" aria-hidden />
          ) : (
            <Captions className="h-3.5 w-3.5" aria-hidden />
          )}
          {availability}
        </div>
        <div className="absolute right-3 bottom-3 inline-flex items-center gap-1 rounded bg-black/45 px-2.5 py-1 text-xs font-bold text-white backdrop-blur">
          {item.childCount === 0 && item.href ? (
            <Play className="h-3.5 w-3.5 fill-current" aria-hidden />
          ) : null}
          {meta}
        </div>
      </div>
      <div className="space-y-2 p-4">
        <div className="flex items-center gap-2 text-xs font-semibold text-amber-200/90">
          <span>{videoLabels(videoLabelMessageKey(item.label))}</span>
          {promoted ? (
            <>
              <span aria-hidden="true">/</span>
              <span>{t("newLabel")}</span>
            </>
          ) : null}
        </div>
        <h3 className="line-clamp-2 text-lg leading-tight font-bold text-white">
          <bdi>{item.title}</bdi>
        </h3>
        {item.description ? (
          <p className="line-clamp-2 text-sm leading-6 text-stone-300">
            <bdi>{item.description}</bdi>
          </p>
        ) : null}
        {item.parentTitle ? (
          <p className="line-clamp-1 text-xs font-semibold text-stone-400">
            {t("fromCollection", {
              collection: isolateBidiDisplayText(item.parentTitle),
            })}
          </p>
        ) : null}
      </div>
      <span
        aria-hidden="true"
        className="absolute top-3 right-3 rounded bg-white/10 px-2 py-1 text-xs font-bold text-white/70"
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

function groupVideosByParent(
  items: WatchLanguageInventoryCard[],
  collections: WatchLanguageInventoryCard[],
  standaloneTitle: string,
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

  return [...groups.values()].map((group) => ({
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
  const metadata = [videoLabels(videoLabelMessageKey(item.label)), runtime]
    .filter((value): value is string => Boolean(value))
    .join(" / ")
  const content = (
    <>
      <span className="w-8 shrink-0 text-end text-xs font-black text-stone-500 tabular-nums">
        {index + 1}
      </span>
      <span className="relative h-12 w-20 shrink-0 overflow-hidden rounded bg-stone-800 ring-1 ring-white/10 sm:h-14 sm:w-24">
        {item.imageUrl ? (
          <Image
            src={item.imageUrl}
            alt=""
            fill
            sizes="(max-width: 640px) 80px, 96px"
            className="object-cover object-left-top transition duration-300 group-hover:scale-105"
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
        <span className="line-clamp-1 text-sm font-bold text-white">
          <bdi>{item.title}</bdi>
        </span>
        {metadata ? (
          <span className="mt-0.5 block truncate text-xs font-semibold text-stone-400">
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

  if (!item.href) {
    return <div className={className}>{content}</div>
  }

  return (
    <Link href={item.href} className={className}>
      {content}
    </Link>
  )
}

function CollectionGroupOverview({ group }: { group: GroupedInventoryVideos }) {
  const t = useTranslations("LanguageInventory")
  const videoLabels = useTranslations("VideoLabels")
  const collection = group.collection
  const heroImage = collection?.imageUrl ?? group.items[0]?.imageUrl ?? null
  const imageAlt =
    collection?.imageAlt ?? group.items[0]?.imageAlt ?? group.title
  const label = collection
    ? videoLabels(videoLabelMessageKey(collection.label))
    : videoLabels("collection")
  const title = collection?.title ?? group.title
  const description =
    collection?.description ??
    (group.items[0]?.parentTitle
      ? t("videosFromCollection", {
          collection: isolateBidiDisplayText(group.title),
        })
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
        <span className="absolute right-3 bottom-3 rounded bg-black/55 px-2.5 py-1 text-xs font-black text-white backdrop-blur">
          {t("videoCount", { count: group.items.length })}
        </span>
      </div>
      <div className="mt-4 flex flex-1 flex-col items-start space-y-2">
        <div className="text-xs font-bold text-amber-200/90">{label}</div>
        <h3 className="text-xl leading-tight font-black text-white">
          <bdi>{title}</bdi>
        </h3>
        {collection?.href ? (
          <Link
            href={collection.href}
            className="mt-2 inline-flex items-center gap-2 rounded-full border border-amber-200/35 bg-amber-200/10 px-4 py-2 text-sm font-black text-amber-100 transition hover:border-amber-200/60 hover:bg-amber-200/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
          >
            {t("openCollection")}
            <ArrowUpRight className="h-4 w-4" aria-hidden />
          </Link>
        ) : null}
        {description ? (
          <p className="line-clamp-4 pt-1 text-sm leading-6 text-stone-300">
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
  totalItems,
  testId,
  empty,
}: {
  id: string
  eyebrow: string
  title: string
  description: string
  icon: IconComponent
  groups: GroupedInventoryVideos[]
  totalItems: number
  testId: string
  empty: string
}) {
  const t = useTranslations("LanguageInventory")
  return (
    <section
      id={id}
      className="scroll-mt-80 border-t border-white/10 py-14 xl:scroll-mt-44"
      data-testid={testId}
    >
      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        <div className="mb-7 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="max-w-3xl">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-white/[0.06] px-3 py-1 text-sm font-semibold text-amber-200">
              <Icon className="h-4 w-4" aria-hidden />
              {eyebrow}
            </div>
            <h2 className="text-3xl font-bold text-white md:text-4xl">
              <bdi>{title}</bdi>
            </h2>
            <p className="mt-3 max-w-2xl text-base leading-7 text-stone-300">
              {description}
            </p>
          </div>
          <div className="text-sm font-semibold text-stone-400">
            {t("videosInGroups", {
              videoCount: totalItems,
              groupCount: groups.length,
            })}
          </div>
        </div>

        {groups.length > 0 ? (
          <div className="space-y-4">
            {groups.map((group) => (
              <section
                key={group.key}
                className="overflow-clip rounded-lg border border-white/10 bg-white/[0.035] lg:grid lg:grid-cols-[minmax(260px,340px)_minmax(0,1fr)]"
                aria-label={group.title}
                data-testid="language-inventory-collection-group"
              >
                <div
                  className="border-b border-white/10 bg-white/[0.035] p-4 lg:border-e lg:border-b-0 lg:p-5"
                  data-testid="language-inventory-collection-sidebar"
                >
                  <div
                    className="lg:sticky lg:top-[calc(env(safe-area-inset-top,0px)+7rem)]"
                    data-testid="language-inventory-collection-overview"
                  >
                    <CollectionGroupOverview group={group} />
                  </div>
                </div>
                <div className="divide-y divide-white/10">
                  {group.items.map((item, index) => (
                    <CompactVideoRow key={item.id} item={item} index={index} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-white/10 bg-white/[0.04] px-5 py-8 text-stone-300">
            {empty}
          </div>
        )}
      </div>
    </section>
  )
}

function InventorySection({
  id,
  eyebrow,
  title,
  description,
  icon: Icon,
  items,
  testId,
  empty,
}: {
  id: string
  eyebrow: string
  title: string
  description: string
  icon: IconComponent
  items: WatchLanguageInventoryCard[]
  testId: string
  empty: string
}) {
  const t = useTranslations("LanguageInventory")
  return (
    <section
      id={id}
      className="scroll-mt-80 border-t border-white/10 py-14 xl:scroll-mt-44"
      data-testid={testId}
    >
      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        <div className="mb-7 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="max-w-3xl">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-white/[0.06] px-3 py-1 text-sm font-semibold text-amber-200">
              <Icon className="h-4 w-4" aria-hidden />
              {eyebrow}
            </div>
            <h2 className="text-3xl font-bold text-white md:text-4xl">
              <bdi>{title}</bdi>
            </h2>
            <p className="mt-3 max-w-2xl text-base leading-7 text-stone-300">
              {description}
            </p>
          </div>
          <div className="text-sm font-semibold text-stone-400">
            {t("itemCount", { count: items.length })}
          </div>
        </div>

        {items.length > 0 ? (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {items.map((item, index) => (
              <InventoryCard key={item.id} item={item} index={index} />
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-white/10 bg-white/[0.04] px-5 py-8 text-stone-300">
            {empty}
          </div>
        )}
      </div>
    </section>
  )
}

function LanguageHomeSections({
  sections,
}: {
  sections: WatchHomeSectionModel[]
}) {
  if (sections.length === 0) return null

  return (
    <div
      className="border-b border-white/10 bg-black"
      data-testid="language-inventory-home-sections"
    >
      {sections.map((section) => (
        <WatchHomeSection key={section.id} section={section} />
      ))}
    </div>
  )
}

export function LanguageInventoryPage({
  inventory,
  homeSections = [],
}: LanguageInventoryPageProps) {
  const t = useTranslations("LanguageInventory")
  const languageDisplayName =
    inventory.languageNativeName?.trim() || inventory.languageName
  const isolatedLanguageDisplayName =
    isolateBidiDisplayText(languageDisplayName)
  const videoBibleCollections = inventory.audioCollections.filter(
    (item) =>
      item.watchLanguageSlug === inventory.languageSlug &&
      isVideoBibleCollection(item),
  )
  const bibleProjectCollections = inventory.audioCollections.filter(
    (item) =>
      item.watchLanguageSlug === inventory.languageSlug &&
      isBibleProjectCollection(item),
  )
  const sportsCollections = inventory.audioCollections.filter(
    (item) =>
      item.watchLanguageSlug === inventory.languageSlug &&
      isSportsCollection(item),
  )
  const groupedAudioVideos = groupVideosByParent(
    inventory.audioVideos,
    inventory.audioCollections,
    t("standaloneVideos"),
  )
  const heroImage =
    inventory.promoted.find((item) => item.imageUrl)?.imageUrl ??
    inventory.audioCollections.find((item) => item.imageUrl)?.imageUrl ??
    inventory.audioVideos.find((item) => item.imageUrl)?.imageUrl ??
    inventory.subtitleOnlyVideos.find((item) => item.imageUrl)?.imageUrl ??
    null

  return (
    <main
      className="min-h-screen bg-stone-950 text-stone-100"
      data-testid="language-inventory-page"
    >
      <section className="relative isolate overflow-hidden border-b border-white/10 bg-stone-950">
        {heroImage ? (
          <Image
            src={heroImage}
            alt=""
            fill
            priority
            sizes="100vw"
            className="object-cover object-left-top opacity-35"
          />
        ) : null}
        <div
          className="absolute inset-0 bg-[linear-gradient(90deg,rgba(12,10,9,.98),rgba(12,10,9,.82)_48%,rgba(12,10,9,.56)),linear-gradient(0deg,rgba(12,10,9,1),rgba(12,10,9,.15)_46%,rgba(12,10,9,.92))]"
          aria-hidden
        />
        <div className="relative mx-auto grid min-h-[72vh] max-w-7xl items-end gap-8 px-5 pt-36 pb-10 sm:px-8 sm:pt-40 lg:grid-cols-[minmax(0,1fr)_minmax(320px,420px)] lg:gap-10 lg:pt-44">
          <div className="max-w-4xl">
            <h1 className="max-w-3xl text-4xl leading-[1.04] font-bold text-white sm:text-5xl lg:text-6xl">
              {t("heroTitle", { language: isolatedLanguageDisplayName })}
            </h1>
            <p className="mt-5 max-w-2xl text-lg leading-8 text-stone-200">
              {t("heroDescription", {
                language: isolatedLanguageDisplayName,
              })}
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

      <nav
        aria-label={t("sectionNavLabel")}
        className="border-b border-white/10 bg-stone-950/92 py-7 backdrop-blur"
        data-testid="language-inventory-section-carousel"
      >
        <div className="mx-auto max-w-7xl px-5 sm:px-8">
          <Carousel
            opts={{
              align: "start",
              containScroll: "trimSnaps",
              dragFree: true,
            }}
          >
            <CarouselContent className="-ms-5">
              <CarouselItem className="basis-auto ps-5">
                <SectionMetricAnchor
                  href="#new"
                  icon={Sparkles}
                  label={t("new")}
                  tone="blue"
                  value={inventory.promoted.length}
                />
              </CarouselItem>
              <CarouselItem className="basis-auto ps-5">
                <SectionMetricAnchor
                  href="#bible-gospels"
                  icon={BookOpen}
                  label={t("videoBible")}
                  tone="violet"
                  value={videoBibleCollections.length}
                />
              </CarouselItem>
              <CarouselItem className="basis-auto ps-5">
                <SectionMetricAnchor
                  href="#bible-project"
                  icon={BookOpen}
                  label={t("bibleProject")}
                  tone="indigo"
                  value={bibleProjectCollections.length}
                />
              </CarouselItem>
              <CarouselItem className="basis-auto ps-5">
                <SectionMetricAnchor
                  href="#sports"
                  icon={Trophy}
                  label={t("sports")}
                  tone="magenta"
                  value={sportsCollections.length}
                />
              </CarouselItem>
              <CarouselItem className="basis-auto ps-5">
                <SectionMetricAnchor
                  href="#audio-collections"
                  icon={Library}
                  label={t("collections")}
                  tone="amber"
                  value={groupedAudioVideos.length}
                />
              </CarouselItem>
              <CarouselItem className="basis-auto ps-5">
                <SectionMetricAnchor
                  href="#subtitles-only"
                  icon={Captions}
                  label={t("subtitlesOnly")}
                  tone="teal"
                  value={inventory.counts.subtitleOnlyVideos}
                />
              </CarouselItem>
            </CarouselContent>
          </Carousel>
        </div>
      </nav>

      <LanguageHomeSections sections={homeSections} />

      <section
        id="new"
        className="scroll-mt-80 py-12 xl:scroll-mt-44"
        data-testid="language-inventory-promoted"
      >
        <div className="mx-auto max-w-7xl px-5 sm:px-8">
          <div className="mb-6 flex items-end justify-between gap-4">
            <div>
              <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-teal-300/10 px-3 py-1 text-sm font-semibold text-teal-100">
                <Sparkles className="h-4 w-4" aria-hidden />
                {t("newlyAdded")}
              </div>
              <h2 className="text-3xl font-bold text-white md:text-4xl">
                {t("newVideosTitle", {
                  language: isolatedLanguageDisplayName,
                })}
              </h2>
            </div>
            <div className="hidden items-center gap-2 text-sm font-semibold text-stone-400 sm:flex">
              <Clock className="h-4 w-4" aria-hidden />
              {t("newestFirst")}
            </div>
          </div>

          {inventory.promoted.length > 0 ? (
            <div className="-mx-5 flex gap-5 overflow-x-auto px-5 pb-4 sm:-mx-8 sm:px-8">
              {inventory.promoted.map((item, index) => (
                <InventoryCard
                  key={item.id}
                  item={item}
                  index={index}
                  promoted
                />
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-white/10 bg-white/[0.04] px-5 py-8 text-stone-300">
              {t("noPublishedVideos")}
            </div>
          )}
        </div>
      </section>

      <InventorySection
        id="bible-gospels"
        eyebrow={t("bibleAndGospelFilms")}
        title={t("videoBibleCollectionsTitle", {
          language: isolatedLanguageDisplayName,
        })}
        description={t("videoBibleDescription", {
          language: isolatedLanguageDisplayName,
        })}
        icon={BookOpen}
        items={videoBibleCollections}
        testId="language-inventory-bible-gospels"
        empty={t("noVideoBibleCollections")}
      />

      <InventorySection
        id="bible-project"
        eyebrow={t("bibleProject")}
        title={t("bibleProjectCollectionsTitle", {
          language: isolatedLanguageDisplayName,
        })}
        description={t("bibleProjectDescription", {
          language: isolatedLanguageDisplayName,
        })}
        icon={BookOpen}
        items={bibleProjectCollections}
        testId="language-inventory-bible-project"
        empty={t("noBibleProjectCollections")}
      />

      <InventorySection
        id="sports"
        eyebrow={t("sportsStories")}
        title={t("sportsTitle", { language: isolatedLanguageDisplayName })}
        description={t("sportsDescription", {
          language: isolatedLanguageDisplayName,
        })}
        icon={Trophy}
        items={sportsCollections}
        testId="language-inventory-sports"
        empty={t("noSportsCollections")}
      />

      <GroupedVideoListSection
        id="audio-collections"
        eyebrow={t("fullyDubbed")}
        title={t("dubbedVideosTitle", {
          language: isolatedLanguageDisplayName,
        })}
        description={t("dubbedVideosDescription", {
          language: isolatedLanguageDisplayName,
        })}
        icon={Library}
        groups={groupedAudioVideos}
        totalItems={inventory.audioVideos.length}
        testId="language-inventory-audio-collections"
        empty={t("noDubbedVideos")}
      />

      <InventorySection
        id="subtitles-only"
        eyebrow={t("subtitlesAvailable")}
        title={t("subtitlesTitle", {
          language: isolatedLanguageDisplayName,
        })}
        description={t("subtitlesDescription", {
          language: isolatedLanguageDisplayName,
        })}
        icon={Captions}
        items={inventory.subtitleOnlyVideos}
        testId="language-inventory-subtitle-only"
        empty={t("noSubtitleVideos")}
      />
    </main>
  )
}
