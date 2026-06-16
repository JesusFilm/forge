import type { ComponentType, ReactNode } from "react"
import type { Route } from "next"
import Image from "next/image"
import Link from "next/link"
import {
  Captions,
  Clock,
  Film,
  Headphones,
  Languages,
  Library,
  Play,
  Sparkles,
} from "lucide-react"

import { cn } from "@/lib/utils"
import {
  primaryLanguageNameForSeo,
  type WatchLanguageInventoryAvailability,
  type WatchLanguageInventoryCard,
  type WatchLanguageInventoryModel,
  watchLanguageSpeakingAudience,
} from "@/lib/watch-language-inventory"

type IconComponent = ComponentType<{ className?: string }>

type LanguageInventoryPageProps = {
  inventory: WatchLanguageInventoryModel
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en").format(value)
}

function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return `${formatNumber(count)} ${count === 1 ? singular : plural}`
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

function formatLabel(label: string | null): string {
  if (!label) return "Video"
  const spaced = label.replace(/([a-z])([A-Z])/g, "$1 $2")
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

function SectionAnchor({
  href,
  icon: Icon,
  children,
}: {
  href: string
  icon: IconComponent
  children: ReactNode
}) {
  return (
    <a
      href={href}
      className="inline-flex h-10 shrink-0 items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-4 text-sm font-semibold text-stone-100 transition hover:border-amber-300/50 hover:bg-amber-300/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
    >
      <Icon className="h-4 w-4" aria-hidden />
      {children}
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

function availabilityCopy(availability: WatchLanguageInventoryAvailability) {
  return availability === "AUDIO" ? "Audio" : "Subtitles"
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
  const runtime = formatRuntime(item.durationSeconds)
  const meta =
    item.childCount > 0
      ? pluralize(item.childCount, "video")
      : (runtime ?? formatLabel(item.label))
  const availability = availabilityCopy(item.availability)
  const frameClassName = cn(
    "group relative block h-full overflow-hidden rounded-lg bg-stone-900 text-left text-inherit shadow-xl shadow-black/35 ring-1 ring-white/10 transition duration-300 hover:-translate-y-1 hover:ring-amber-200/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300",
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
          <span>{formatLabel(item.label)}</span>
          {promoted ? (
            <>
              <span aria-hidden="true">/</span>
              <span>New</span>
            </>
          ) : null}
        </div>
        <h3 className="line-clamp-2 text-lg leading-tight font-bold text-white">
          {item.title}
        </h3>
        {item.description ? (
          <p className="line-clamp-2 text-sm leading-6 text-stone-300">
            {item.description}
          </p>
        ) : null}
        {item.parentTitle ? (
          <p className="line-clamp-1 text-xs font-semibold text-stone-400">
            From {item.parentTitle}
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
  return (
    <section
      id={id}
      className="scroll-mt-44 border-t border-white/10 py-14"
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
              {title}
            </h2>
            <p className="mt-3 max-w-2xl text-base leading-7 text-stone-300">
              {description}
            </p>
          </div>
          <div className="text-sm font-semibold text-stone-400">
            {pluralize(items.length, "item")}
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

export function LanguageInventoryPage({
  inventory,
}: LanguageInventoryPageProps) {
  const primaryLanguageName = primaryLanguageNameForSeo(inventory.languageName)
  const speakingAudience = watchLanguageSpeakingAudience(inventory.languageName)
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
        <div className="relative mx-auto flex min-h-[72vh] max-w-7xl flex-col justify-end px-5 pt-24 pb-10 sm:px-8">
          <div className="max-w-4xl">
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-amber-200/20 bg-amber-200/10 px-3 py-1 text-sm font-bold text-amber-100">
              <Languages className="h-4 w-4" aria-hidden />
              {inventory.languageSlug}
            </div>
            <h1 className="max-w-3xl text-5xl leading-none font-black text-white sm:text-6xl lg:text-7xl">
              Free Gospel video library for {speakingAudience}
            </h1>
            <p className="mt-5 max-w-2xl text-lg leading-8 text-stone-200">
              Browse free Gospel films, Bible stories, discipleship series, and
              outreach videos available in {inventory.languageName}. Audio-ready
              collections appear first, followed by subtitle-only resources.
            </p>
          </div>

          <dl className="mt-10 grid max-w-4xl gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg border border-white/10 bg-black/35 p-4 backdrop-blur">
              <dt className="text-sm font-semibold text-stone-300">Total</dt>
              <dd className="mt-1 text-3xl font-black text-white">
                {formatNumber(inventory.counts.total)}
              </dd>
            </div>
            <div className="rounded-lg border border-white/10 bg-black/35 p-4 backdrop-blur">
              <dt className="text-sm font-semibold text-stone-300">
                Collections
              </dt>
              <dd className="mt-1 text-3xl font-black text-white">
                {formatNumber(inventory.counts.audioCollections)}
              </dd>
            </div>
            <div className="rounded-lg border border-white/10 bg-black/35 p-4 backdrop-blur">
              <dt className="text-sm font-semibold text-stone-300">
                Audio videos
              </dt>
              <dd className="mt-1 text-3xl font-black text-white">
                {formatNumber(inventory.counts.audioVideos)}
              </dd>
            </div>
            <div className="rounded-lg border border-white/10 bg-black/35 p-4 backdrop-blur">
              <dt className="text-sm font-semibold text-stone-300">
                Subtitles only
              </dt>
              <dd className="mt-1 text-3xl font-black text-white">
                {formatNumber(inventory.counts.subtitleOnlyVideos)}
              </dd>
            </div>
          </dl>
        </div>
      </section>

      <nav className="sticky top-24 z-30 overflow-x-auto border-b border-white/10 bg-stone-950/92 px-5 py-3 backdrop-blur sm:px-8 lg:top-28">
        <div className="mx-auto flex max-w-7xl gap-2">
          <SectionAnchor href="#new" icon={Sparkles}>
            New
          </SectionAnchor>
          <SectionAnchor href="#audio-collections" icon={Library}>
            Audio collections
          </SectionAnchor>
          <SectionAnchor href="#audio-videos" icon={Headphones}>
            Audio videos
          </SectionAnchor>
          <SectionAnchor href="#subtitles-only" icon={Captions}>
            Subtitles only
          </SectionAnchor>
        </div>
      </nav>

      <section
        id="new"
        className="scroll-mt-44 py-12"
        data-testid="language-inventory-promoted"
      >
        <div className="mx-auto max-w-7xl px-5 sm:px-8">
          <div className="mb-6 flex items-end justify-between gap-4">
            <div>
              <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-teal-300/10 px-3 py-1 text-sm font-semibold text-teal-100">
                <Sparkles className="h-4 w-4" aria-hidden />
                Recently created
              </div>
              <h2 className="text-3xl font-bold text-white md:text-4xl">
                New Gospel videos in {primaryLanguageName}
              </h2>
            </div>
            <div className="hidden items-center gap-2 text-sm font-semibold text-stone-400 sm:flex">
              <Clock className="h-4 w-4" aria-hidden />
              Freshest first
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
              No published videos were found for this language yet.
            </div>
          )}
        </div>
      </section>

      <InventorySection
        id="audio-collections"
        eyebrow="With audio"
        title={`${primaryLanguageName} audio collections and series`}
        description={`Parent collections appear when at least one published child video has playable ${primaryLanguageName} audio.`}
        icon={Library}
        items={inventory.audioCollections}
        testId="language-inventory-audio-collections"
        empty="No audio-ready collections were found for this language."
      />

      <InventorySection
        id="audio-videos"
        eyebrow="With audio"
        title={`${primaryLanguageName} audio Gospel videos`}
        description={`Standalone titles and collection episodes with playable ${primaryLanguageName} audio.`}
        icon={Film}
        items={inventory.audioVideos}
        testId="language-inventory-audio-videos"
        empty="No audio-ready videos were found for this language."
      />

      <InventorySection
        id="subtitles-only"
        eyebrow="Text tracks"
        title={`${primaryLanguageName} subtitle-only Gospel videos`}
        description={`These titles have ${primaryLanguageName} subtitles and open with the nearest playable audio track.`}
        icon={Captions}
        items={inventory.subtitleOnlyVideos}
        testId="language-inventory-subtitle-only"
        empty="No subtitles-only videos were found for this language."
      />
    </main>
  )
}
