"use client"

import Image from "next/image"
import type {
  FragmentOf,
  LegacyFragmentValue,
} from "@/lib/legacy-fragment-types"
import type { EnrichedMediaItem } from "@/lib/enrichment"
import { enrichMediaItem } from "@/lib/enrichment"
import { CONTENT_WIDTH_CLASSES } from "@/lib/content-width"
import type { RouteVideo } from "@/lib/content"
import { mediaCollectionFragment } from "@/lib/fragments/media-collection"
import {
  WATCH_BASE_PATH,
  asLocaleSlug,
  tryAsContentSlug,
  watchVideoPath,
} from "@/lib/routes"
import { WatchProgressBar } from "@/components/watch/WatchProgressBar"

// Collections carry no per-item language today, so card deep links default
// to the English variant and rely on the watch route to re-resolve locale.
// See todo: EnrichedMediaItem should carry a defaultLanguage (data-model gap).
// Hoisted so the throwing constructor runs once at module load, not per card.
const DEFAULT_COLLECTION_LOCALE = asLocaleSlug("english")
import {
  Carousel,
  CarouselContent,
  CarouselItem,
} from "@/components/ui/carousel"
import {
  CAROUSEL_CONTENT_PADDING,
  CAROUSEL_END_SPACER,
} from "@/lib/content-width"
import { useDynamicBackground } from "./DynamicBackground"
import { resolveMediaImageUrl } from "@/lib/media-image-url"

export { mediaCollectionFragment }

type MediaCollectionProps = {
  data: FragmentOf<typeof mediaCollectionFragment>
  routeVideo?: RouteVideo | null
}

export function MediaCollection({ data, routeVideo }: MediaCollectionProps) {
  const onBackgroundImageChange = useDynamicBackground()
  const {
    id,
    title,
    subtitle,
    mediaDescription: description,
    categoryLabel,
    mediaCtaLink: ctaLink,
    mediaCtaLabel: rawCtaLabel,
    showItemNumbers,
    mediaCollectionVariant: variant,
    itemsSource,
    footerText: rawFooterText,
    items,
  } = data

  const ctaLabel = typeof rawCtaLabel === "string" ? rawCtaLabel : null
  const footerText = typeof rawFooterText === "string" ? rawFooterText : null
  const selectedSource = itemsSource ?? "manual"
  const enrichedItems =
    selectedSource === "routeVideoChildren"
      ? (routeVideo?.relatedItems ?? [])
      : (items ?? [])
          .filter(
            (i: LegacyFragmentValue): i is NonNullable<typeof i> => i != null,
          )
          .map(enrichMediaItem)

  if (
    process.env.NODE_ENV === "development" &&
    selectedSource === "routeVideoChildren" &&
    routeVideo == null
  ) {
    console.warn(
      "[MediaCollection] routeVideoChildren source requires routeVideo context.",
    )
  }

  if (enrichedItems.length === 0) return null

  if (variant === "carousel") {
    return (
      <CarouselVariant
        id={id}
        title={title}
        subtitle={categoryLabel}
        ctaLink={ctaLink}
        ctaLabel={ctaLabel}
        footerText={footerText}
        items={enrichedItems}
        onBackgroundImageChange={onBackgroundImageChange ?? undefined}
      />
    )
  }

  const gridClass =
    variant === "hero"
      ? "grid grid-cols-1"
      : variant === "player"
        ? "grid grid-cols-1 max-w-2xl mx-auto"
        : variant === "grid"
          ? "grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4"
          : "grid grid-cols-1 md:grid-cols-2 gap-4"

  return (
    <section id={id} className="py-8">
      <div className="container mx-auto px-4">
        {title && <h2 className="mb-2 text-2xl font-bold">{title}</h2>}
        {subtitle && <p className="mb-2 text-gray-600">{subtitle}</p>}
        {description && <p className="mb-4">{description}</p>}
        {categoryLabel && (
          <span className="mb-4 inline-block rounded bg-gray-100 px-2 py-1 text-sm">
            {categoryLabel}
          </span>
        )}
        <div className={gridClass}>
          {enrichedItems.map((item: EnrichedMediaItem, i: number) => (
            <DefaultCard
              key={item.id}
              item={item}
              index={i}
              variant={variant}
              showItemNumbers={showItemNumbers}
            />
          ))}
        </div>
        {ctaLink && (
          <a
            href={ctaLink}
            className="mt-4 inline-block font-medium text-blue-600 hover:underline"
          >
            View all
          </a>
        )}
      </div>
    </section>
  )
}

function PlayIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      focusable="false"
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="currentColor"
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M5.493 1.607c.845-.395 1.799-.187 2.555.292l.03.02 11.017 8.111c.781.464 1.504 1.175 1.505 2.172.001.99-.715 1.734-1.496 2.246l-10.93 7.644-.046.025c-.788.437-1.762.706-2.63.242-.879-.47-1.193-1.442-1.25-2.387l-.001-.028L4.2 3.968c-.019-1.02.395-1.943 1.292-2.361Z"
      />
    </svg>
  )
}

function CarouselVariant({
  id,
  title,
  subtitle,
  ctaLink,
  ctaLabel,
  footerText,
  items,
  onBackgroundImageChange,
}: {
  id: string
  title: string | null
  subtitle: string | null
  ctaLink: string | null
  ctaLabel: string | null
  footerText: string | null
  items: EnrichedMediaItem[]
  onBackgroundImageChange?: (url: string | null) => void
}) {
  const handleHover = (imageUrl: string | null) => {
    onBackgroundImageChange?.(imageUrl)
  }

  return (
    <div id={id}>
      <div className={`${CONTENT_WIDTH_CLASSES} relative z-2 pb-6`}>
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-col gap-1">
            {subtitle && (
              <h4 className="text-sm font-semibold tracking-wider text-red-100/70 uppercase xl:text-base 2xl:text-lg">
                {subtitle}
              </h4>
            )}
            {title && (
              <h2 className="text-2xl font-bold text-white xl:text-3xl 2xl:text-4xl">
                {title}
              </h2>
            )}
          </div>
          {ctaLink && (
            <a href={ctaLink}>
              <button
                aria-label={ctaLabel ?? "Watch"}
                className="inline-flex cursor-pointer items-center gap-2 rounded-full bg-white px-4 py-2 text-xs font-bold tracking-wider text-black uppercase transition-colors duration-200 hover:bg-brand-red hover:text-white"
              >
                <PlayIcon />
                <span>{ctaLabel ?? "Watch"}</span>
              </button>
            </a>
          )}
        </div>
      </div>

      <div className="relative">
        <Carousel
          opts={{
            align: "start",
            dragFree: true,
            containScroll: "trimSnaps",
            watchDrag: (api) => api.scrollSnapList().length > 1,
          }}
          className="w-full"
        >
          <CarouselContent className={`-ml-5 ${CAROUSEL_CONTENT_PADDING}`}>
            {items.map((item: EnrichedMediaItem) => (
              <CarouselItem key={item.id} className="max-w-[200px] py-1 pl-5">
                <VideoCard
                  item={item}
                  onHover={() => handleHover(item.imageUrl)}
                />
              </CarouselItem>
            ))}
            <CarouselItem className="basis-auto pl-0" aria-hidden="true">
              <div className={CAROUSEL_END_SPACER} />
            </CarouselItem>
          </CarouselContent>
        </Carousel>
      </div>

      {footerText && (
        <div className={`${CONTENT_WIDTH_CLASSES} space-y-6`}>
          <p className="mt-8 text-lg leading-relaxed text-stone-200/80 xl:text-xl">
            {footerText}
          </p>
        </div>
      )}
    </div>
  )
}

function VideoCard({
  item,
  onHover,
}: {
  item: EnrichedMediaItem
  onHover?: () => void
}) {
  // Raw <a href> (not next/link), so the `/watch` basePath must be prefixed
  // manually. EnrichedMediaItem carries no language field, so the locale
  // segment defaults to `english` (see DEFAULT_COLLECTION_LOCALE).
  const slug = item.videoSlug ? tryAsContentSlug(item.videoSlug) : null
  const href = slug
    ? `${WATCH_BASE_PATH}${watchVideoPath(slug, DEFAULT_COLLECTION_LOCALE)}`
    : undefined
  const Wrapper = href ? "a" : "div"
  const imageSrc = resolveMediaImageUrl(item.imageUrl)

  return (
    <Wrapper
      href={href}
      className={`block text-inherit no-underline ${
        href ? "pointer-events-auto cursor-pointer" : "pointer-events-none"
      }`}
      aria-label="VideoCard"
    >
      <div className="flex flex-col gap-6">
        <button
          type="button"
          className="group relative aspect-2/3 cursor-pointer overflow-hidden rounded-lg transition-transform duration-300 hover:scale-[1.02] focus-visible:scale-[1.02] disabled:cursor-default"
          onMouseEnter={onHover}
        >
          <div className="absolute inset-0 overflow-hidden rounded-lg bg-black/50 transition-transform duration-300">
            {imageSrc ? (
              <Image
                src={imageSrc}
                alt={item.title}
                fill
                unoptimized
                sizes="(max-width: 768px) 50vw, 200px"
                className="transition-transform duration-300 group-hover:scale-105"
                style={{
                  // `center` keeps the subject in frame regardless of the
                  // source image's aspect ratio. Portrait poster artwork
                  // (the original cms data) stays centered; landscape
                  // `mobileCinematicHigh` variants (post-data-layer-flip,
                  // when admin only carries banner-aspect rows) show the
                  // middle of the scene instead of the left edge.
                  objectFit: "cover",
                  objectPosition: "center",
                  color: "transparent",
                  maskImage:
                    "linear-gradient(to top, transparent 0%, rgba(0,0,0,0.4) 30%, black 42%)",
                  WebkitMaskImage:
                    "linear-gradient(to top, transparent 0%, rgba(0,0,0,0.4) 30%, black 42%)",
                }}
              />
            ) : (
              <div className="absolute inset-0 rounded-lg bg-stone-800" />
            )}
          </div>

          <div className="absolute inset-0 rounded-lg opacity-15 shadow-[inset_0px_0px_0px_1px_rgba(255,255,255,0.12)] transition-opacity duration-300 hover:opacity-50" />
          <WatchProgressBar videoId={item.id} className="rounded-b-lg" />

          {item.collectionSize && (
            <div className="absolute top-2 right-2 z-10 flex shrink-0 flex-row items-center gap-1 rounded bg-black/30 px-2 py-1 text-white">
              <span className="text-sm font-semibold">
                {item.collectionSize}
              </span>
            </div>
          )}

          <div className="absolute inset-0 flex flex-col justify-end gap-0 px-4 pt-4 pb-5">
            {item.label && (
              <div className="flex min-w-0 flex-row items-end justify-between gap-[90px]">
                <div className="truncate text-xs font-semibold leading-8 tracking-wider text-stone-300/70 uppercase mix-blend-screen">
                  {formatLabel(item.label)}
                </div>
              </div>
            )}
            <h3 className="-mt-1 text-left text-xl font-bold leading-tight text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.4)]">
              {item.title}
            </h3>
          </div>
        </button>
      </div>
    </Wrapper>
  )
}

function DefaultCard({
  item,
  index,
  variant,
  showItemNumbers,
}: {
  item: EnrichedMediaItem
  index: number
  variant: string | null
  showItemNumbers: boolean | null
}) {
  return (
    <article className="rounded-lg border bg-white p-4 shadow-sm">
      {resolveMediaImageUrl(item.imageUrl) && (
        <div className="relative mb-2 aspect-video w-full overflow-hidden rounded">
          <Image
            src={resolveMediaImageUrl(item.imageUrl) ?? ""}
            alt={item.title}
            fill
            className="object-cover"
            sizes={
              variant === "hero"
                ? "100vw"
                : variant === "player"
                  ? "(max-width: 768px) 100vw, 33vw"
                  : "(max-width: 768px) 100vw, 25vw"
            }
          />
        </div>
      )}
      <h3 className="font-semibold">{item.title}</h3>
      {item.subtitle && (
        <p className="text-sm text-gray-600">{item.subtitle}</p>
      )}
      {showItemNumbers && (
        <span className="text-xs text-gray-400">{index + 1}</span>
      )}
    </article>
  )
}

function formatLabel(label: string): string {
  return label.replace(/([a-z0-9])([A-Z])/g, "$1 $2").trim()
}
