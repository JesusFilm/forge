"use client"

import Link from "next/link"
import { useTranslations } from "next-intl"
import type { LucideIcon } from "lucide-react"
import {
  Anchor,
  BookOpen,
  ChevronRight,
  Compass,
  Film,
  Flower2,
  Gift,
  GraduationCap,
  Heart,
  Megaphone,
  Sunrise,
  Timer,
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
} from "@/components/watch/watch-section-styles"
import {
  CONTENT_WIDTH_ALIGN_CLASSES,
  WATCH_PAGE_CONTENT_CLASSES,
} from "@/lib/content-width"
import {
  languageInventoryPath,
  tryAsContentSlug,
  tryAsLocaleSlug,
  watchVideoPath,
} from "@/lib/routes"
import { cn } from "@/lib/utils"
import {
  WATCH_HOME_CATEGORIES,
  type WatchHomeCategoryId,
} from "@/lib/watch-home-categories"

type WatchHomeCategoryRailProps = {
  languageSlug: string
}

// Keyed by category `id` and constrained to the literal union so adding a
// category to WATCH_HOME_CATEGORIES without an icon is a compile error —
// same contract as CATEGORY_ICON_BY_SEARCH_TERM in SearchCategoryIcons.
const CATEGORY_ICON_BY_ID: Record<WatchHomeCategoryId, LucideIcon> = {
  jesus: Film,
  gospels: BookOpen,
  "short-videos": Timer,
  family: Users,
  relationships: Heart,
  women: Flower2,
  students: GraduationCap,
  sports: Trophy,
  "good-news": Megaphone,
  hope: Anchor,
  training: Compass,
  easter: Sunrise,
  christmas: Gift,
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

export function WatchHomeCategoryRail({
  languageSlug,
}: WatchHomeCategoryRailProps) {
  const t = useTranslations("WatchHomeCategories")
  // A slug that fails the LocaleSlug shape can only arrive through a
  // malformed route param, and every href here needs it — including the
  // heading CTA. No rail beats a rail of broken links.
  const locale = tryAsLocaleSlug(languageSlug)
  if (locale === null) return null

  // Every configured slug is a constant that passes the content-slug shape,
  // so this only drops entries if the config is edited to an invalid value.
  const cards = WATCH_HOME_CATEGORIES.flatMap((category) => {
    const slug = tryAsContentSlug(category.slug)
    return slug ? [{ ...category, href: watchVideoPath(slug, locale) }] : []
  })

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
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 gap-y-1">
          <p className={cn("col-start-1", WATCH_SECTION_EYEBROW_CLASS)}>
            {t("eyebrow")}
          </p>
          <h2
            id="watch-home-category-rail-title"
            className="col-start-1 row-start-2 max-w-4xl text-2xl leading-tight font-bold tracking-normal text-white xl:text-3xl 2xl:text-4xl"
          >
            {t("title")}
          </h2>
          <Link
            href={languageInventoryPath(locale)}
            prefetch={false}
            data-testid="watch-home-category-see-all"
            className="col-start-2 row-start-1 row-end-3 inline-flex w-fit shrink-0 items-center gap-1 self-center rounded-full bg-white px-4 py-2 text-xs font-bold tracking-wider text-black uppercase transition-colors hover:bg-red-500 hover:text-white focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none"
          >
            {t("seeAll")}
            <ChevronRight aria-hidden className="size-4" />
          </Link>
          <p className="col-start-1 row-start-3 max-w-3xl pt-1 text-base leading-snug font-normal text-stone-100/80 xl:text-lg">
            {t("description")}
          </p>
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
            {cards.map((category) => {
              const Icon = CATEGORY_ICON_BY_ID[category.id]
              return (
                <CarouselItem
                  key={category.id}
                  className="basis-auto py-1 pl-4"
                  data-testid={`watch-home-category-slide-${category.id}`}
                >
                  <Link
                    href={category.href}
                    prefetch={false}
                    data-testid={`watch-home-category-card-${category.id}`}
                    className="beveled group relative flex h-[130px] w-[190px] flex-col justify-end overflow-hidden rounded-lg p-4 transition duration-300 hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-white/70"
                    style={{ backgroundImage: category.gradient }}
                  >
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
                      {t(`categories.${category.titleKey}`)}
                    </span>
                  </Link>
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
