"use client"

import Link from "next/link"
import type { Route } from "next"
import { useTranslations } from "next-intl"
import type { LucideIcon } from "lucide-react"
import {
  Anchor,
  BookOpen,
  CalendarDays,
  ChevronRight,
  CirclePlay,
  Clock,
  Compass,
  Download,
  Film,
  Flower2,
  Gift,
  Globe,
  GraduationCap,
  Heart,
  MapPin,
  Megaphone,
  MessageCircle,
  Music,
  Sparkles,
  Star,
  Sunrise,
  Trophy,
  Users,
} from "lucide-react"

import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel"
import {
  WATCH_MEDIA_SECTION_VERTICAL_PADDING_CLASS,
  WATCH_SECTION_EYEBROW_CLASS,
  WatchLibraryIcon,
} from "@/components/watch/watch-section-styles"
import {
  CONTENT_WIDTH_ALIGN_CLASSES,
  WATCH_PAGE_CONTENT_CLASSES,
} from "@/lib/content-width"
import { languageInventoryPath, tryAsLocaleSlug } from "@/lib/routes"
import { cn } from "@/lib/utils"
import { WATCH_HOME_CATEGORIES } from "@/lib/watch-home-categories"
import {
  resolveWatchHomeTiles,
  type WatchHomeRailTileInput,
} from "@/lib/watch-home-tiles"
import {
  DEFAULT_WATCH_HOME_TILE_ICON,
  type WatchHomeTileIconKey,
} from "@forge/watch-url-policy/watch-home-tiles"

type WatchHomeCategoryRailProps = {
  languageSlug: string
  categoryIds?: readonly string[] | null
  /**
   * Authored tiles. Authoritative when non-empty; `categoryIds` is the
   * pre-tile-authoring shape and the compatibility mirror admin keeps in sync.
   */
  tiles?: readonly WatchHomeRailTileInput[] | null
}

// Keyed by the SHARED icon vocabulary (not by category) since a tile can now
// override its glyph. Exhaustive over the literal union, so adding a key to
// the catalog without a glyph is a compile error — same contract as
// CATEGORY_ICON_BY_SEARCH_TERM in SearchCategoryIcons, and the admin editor
// maps the same keys so its preview cannot drift from this render.
const ICON_BY_KEY: Record<WatchHomeTileIconKey, LucideIcon> = {
  film: Film,
  book: BookOpen,
  clock: Clock,
  users: Users,
  heart: Heart,
  flower: Flower2,
  graduation: GraduationCap,
  trophy: Trophy,
  megaphone: Megaphone,
  anchor: Anchor,
  compass: Compass,
  sunrise: Sunrise,
  gift: Gift,
  play: CirclePlay,
  globe: Globe,
  music: Music,
  sparkles: Sparkles,
  star: Star,
  "map-pin": MapPin,
  calendar: CalendarDays,
  "message-circle": MessageCircle,
  download: Download,
}

// Outline icons, but the stroke must read as ONE solid line. A per-stroke
// alpha (`text-white/25`) composites each lucide path separately, so wherever
// two strokes cross the alpha doubles and the overlap shows through. Full-
// colour stroke + element-level `opacity` renders the icon to its own layer
// first, then fades it as a unit — crossings disappear.
const ICON_STROKE_CLASSES =
  "text-white opacity-25 transition duration-300 group-hover:opacity-40"

// The same noise texture the media-collection sections already load on this
// page, so the tiles get film grain without a second image request.
const TILE_GRAIN_CLASSES =
  "pointer-events-none absolute inset-0 bg-[url(/watch/images/overlay.svg)] bg-repeat opacity-60 mix-blend-multiply"

const DEFAULT_CATEGORY_IDS = WATCH_HOME_CATEGORIES.map(({ id }) => id)

export function WatchHomeCategoryRail({
  languageSlug,
  categoryIds = DEFAULT_CATEGORY_IDS,
  tiles,
}: WatchHomeCategoryRailProps) {
  const t = useTranslations("WatchHomeCategories")
  // A slug that fails the LocaleSlug shape can only arrive through a
  // malformed route param, and every href here needs it — including the
  // heading CTA. No rail beats a rail of broken links.
  const locale = tryAsLocaleSlug(languageSlug)
  if (locale === null) return null

  // Resolution (defaults, overrides, dropping unrenderable tiles) lives in
  // `resolveWatchHomeTiles` so the rules are testable without a renderer.
  const cards = resolveWatchHomeTiles({ tiles, categoryIds, locale })

  if (cards.length === 0) return null

  return (
    <section
      data-testid="watch-home-category-rail"
      aria-labelledby="watch-home-category-rail-title"
      className={cn(
        "relative overflow-hidden text-white",
        WATCH_MEDIA_SECTION_VERTICAL_PADDING_CLASS,
      )}
    >
      <div className={cn("relative z-[3] pb-6", WATCH_PAGE_CONTENT_CLASSES)}>
        <div className="grid grid-cols-1 items-start gap-x-4 gap-y-1 md:grid-cols-[minmax(0,1fr)_auto]">
          <p
            className={cn(
              "col-start-1 row-start-1",
              WATCH_SECTION_EYEBROW_CLASS,
            )}
          >
            {t("eyebrow")}
          </p>
          <h2
            id="watch-home-category-rail-title"
            className="col-start-1 row-start-2 max-w-4xl text-2xl leading-tight font-bold tracking-normal text-white xl:text-3xl 2xl:text-4xl"
          >
            {t("title")}
          </h2>
          <p className="col-start-1 row-start-3 max-w-3xl pt-1 text-base leading-snug font-normal text-stone-100/80 xl:text-lg">
            {t("description")}
          </p>
          <Link
            href={languageInventoryPath(locale)}
            prefetch={false}
            data-testid="watch-home-category-see-all"
            className="col-start-1 row-start-4 mt-4 inline-flex w-fit max-w-full shrink-0 items-center gap-2 self-start rounded-full bg-white px-5 py-3 text-center text-sm font-bold tracking-wider text-black uppercase transition-colors hover:bg-red-500 hover:text-white focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none md:col-start-2 md:row-start-1 md:row-end-3 md:mt-0 md:self-center md:px-6 md:py-3.5"
          >
            <WatchLibraryIcon aria-hidden className="size-5 shrink-0" />
            <span>{t("seeAll")}</span>
            <ChevronRight aria-hidden className="size-5 shrink-0" />
          </Link>
        </div>
      </div>

      {/* Rail geometry mirrors MediaCollection: the content column sets the
          max width, and the slide list carries the same left padding as the
          heading so the first card lines up with it while later cards still
          scroll to the viewport edge. */}
      <div className={cn("relative z-[3]", CONTENT_WIDTH_ALIGN_CLASSES)}>
        <Carousel
          aria-label={t("title")}
          opts={{
            dragFree: true,
            containScroll: "trimSnaps",
            align: "start",
          }}
          className="w-full"
          data-testid="watch-home-category-carousel"
        >
          <CarouselContent className="-ml-4 pl-5 md:pl-16 xl:pl-24">
            {cards.map((card) => {
              const Icon =
                ICON_BY_KEY[card.iconKey] ??
                ICON_BY_KEY[DEFAULT_WATCH_HOME_TILE_ICON]
              // An authored title is a literal and renders as-is in every
              // locale; only a tile that kept its catalog default is
              // translated.
              const label =
                card.titleKey != null
                  ? t(`categories.${card.titleKey}`)
                  : (card.title ?? "")
              const cardClassName =
                "beveled group relative flex h-[130px] w-[190px] flex-col justify-end overflow-hidden rounded-lg p-4 transition duration-300 hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-white/70"
              const cardChildren = (
                <>
                  <span
                    aria-hidden
                    data-testid="watch-home-category-grain"
                    className={TILE_GRAIN_CLASSES}
                  />
                  <Icon
                    aria-hidden
                    className={cn(
                      "absolute top-3 right-3 size-10",
                      ICON_STROKE_CLASSES,
                    )}
                  />
                  <span className="relative text-lg leading-tight font-bold text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.45)]">
                    {label}
                  </span>
                </>
              )

              return (
                <CarouselItem
                  key={card.key}
                  className="basis-auto py-1 pl-4"
                  data-testid={`watch-home-category-slide-${card.key}`}
                >
                  {/* An external destination leaves the app entirely, so it
                      gets a plain anchor with `noopener noreferrer` rather
                      than a client-routed `next/link`. */}
                  {card.external ? (
                    <a
                      href={card.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      data-testid={`watch-home-category-card-${card.key}`}
                      className={cardClassName}
                      style={{ backgroundImage: card.gradient }}
                    >
                      {cardChildren}
                    </a>
                  ) : (
                    <Link
                      // Authored destinations are typed by admins at runtime,
                      // so they cannot satisfy typedRoutes statically. The
                      // shape guarantee comes from `isSafeWatchHomeTileHref`
                      // instead — same trade `WatchHomeHero` makes for its
                      // authored slide hrefs.
                      href={card.href as Route}
                      prefetch={false}
                      data-testid={`watch-home-category-card-${card.key}`}
                      className={cardClassName}
                      style={{ backgroundImage: card.gradient }}
                    >
                      {cardChildren}
                    </Link>
                  )}
                </CarouselItem>
              )
            })}
            {/* Embla's containScroll trims trailing CSS padding, so the
                right-edge breathing room has to be a real slide. */}
            <CarouselItem
              aria-hidden="true"
              tabIndex={-1}
              className="basis-auto pl-0"
              data-testid="watch-home-category-end-spacer"
            >
              <div className="w-5 md:w-16 xl:w-24" />
            </CarouselItem>
          </CarouselContent>
          <CarouselPrevious />
          <CarouselNext />
        </Carousel>
      </div>
    </section>
  )
}
