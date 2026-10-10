"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import type { Route } from "next"
import { useTranslations } from "next-intl"
import type { LucideIcon } from "lucide-react"
import {
  Anchor,
  BookOpen,
  CalendarDays,
  ChevronLeft,
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

import { Button } from "@/components/ui/button"
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
  eyebrow?: string | null
  title?: string | null
  description?: string | null
  ctaLabel?: string | null
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

// Wide-desktop breakpoint where the rail stops scrolling and becomes a grid.
// A sub-pixel tolerance keeps fractional scroll positions from leaving an
// arrow enabled on a rail that has nothing left to reveal.
const SCROLL_EDGE_TOLERANCE_PX = 1

// Same face as the Watch carousel arrows (`CAROUSEL_EDGE_CONTROL_CLASSES` in
// ui/carousel.tsx): a light disc with a dark chevron. The section is
// `text-white`, and the outline Button variant paints a white background, so
// without an explicit pair the chevron computes white-on-white (measured at
// PR head: stroke rgb(255,255,255) on bg lab(100 0 0)).
const ARROW_CLASSES =
  "absolute top-1/2 z-20 hidden size-11 -translate-y-1/2 touch-manipulation rounded-full border-white/30 bg-white/95 text-stone-900 opacity-80 shadow-xl transition-[opacity,background-color,color,scale] duration-200 hover:scale-105 hover:bg-white hover:text-stone-950 hover:opacity-100 focus-visible:opacity-100 md:pointer-fine:flex"

const PREVIOUS_ARROW_TEST_ID = "watch-home-category-previous"
const NEXT_ARROW_TEST_ID = "watch-home-category-next"
const ARROW_TEST_ID = {
  previous: PREVIOUS_ARROW_TEST_ID,
  next: NEXT_ARROW_TEST_ID,
} as const

type RailScrollState = {
  // False until the scroller is measured; the arrows are a hydrated-only
  // enhancement and must not exist as dead controls in the server HTML.
  measured: boolean
  canScrollBackward: boolean
  canScrollForward: boolean
}

// Server and first client render agree on this. Forward is assumed so the
// end-edge fade cue is present in the server HTML (the rail has 13 tiles and
// overflows everywhere below the grid breakpoint); the measured value takes
// over on mount.
const INITIAL_RAIL_SCROLL_STATE: RailScrollState = {
  measured: false,
  canScrollBackward: false,
  canScrollForward: true,
}

function measureRailScroll(scroller: HTMLElement): RailScrollState {
  // `scrollLeft` is 0 at the inline-start edge and negative toward the end in
  // right-to-left, so the absolute value is the distance travelled either way.
  const travelled = Math.abs(scroller.scrollLeft)
  const maxTravel = scroller.scrollWidth - scroller.clientWidth
  return {
    measured: true,
    canScrollBackward: travelled > SCROLL_EDGE_TOLERANCE_PX,
    canScrollForward: maxTravel - travelled > SCROLL_EDGE_TOLERANCE_PX,
  }
}

function sameRailScrollState(a: RailScrollState, b: RailScrollState) {
  return (
    a.measured === b.measured &&
    a.canScrollBackward === b.canScrollBackward &&
    a.canScrollForward === b.canScrollForward
  )
}

export function WatchHomeCategoryRail({
  languageSlug,
  eyebrow,
  title,
  description,
  ctaLabel,
  categoryIds = DEFAULT_CATEGORY_IDS,
  tiles,
}: WatchHomeCategoryRailProps) {
  const t = useTranslations("WatchHomeCategories")
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const regionRef = useRef<HTMLDivElement | null>(null)
  // Set at the moment a scroll update would unmount the arrow that HAS focus,
  // naming the opposite arrow to hand focus to. Capturing it from the live
  // focused element (not from a past click) means focus the visitor has since
  // moved elsewhere is never taken back.
  const focusHandoffRef = useRef<"previous" | "next" | null>(null)
  const [railScroll, setRailScroll] = useState(INITIAL_RAIL_SCROLL_STATE)
  // Ref callback so the listeners follow the element itself: the scroller is
  // not mounted when the slug is unusable, and re-attaches if it remounts.
  const attachScroller = useCallback((scroller: HTMLDivElement | null) => {
    scrollerRef.current = scroller
    if (scroller === null) return
    const sync = () => {
      const next = measureRailScroll(scroller)
      const focused = document.activeElement?.getAttribute("data-testid")
      if (focused === NEXT_ARROW_TEST_ID && !next.canScrollForward) {
        focusHandoffRef.current = next.canScrollBackward ? "previous" : null
      } else if (
        focused === PREVIOUS_ARROW_TEST_ID &&
        !next.canScrollBackward
      ) {
        focusHandoffRef.current = next.canScrollForward ? "next" : null
      }
      setRailScroll((previous) =>
        sameRailScrollState(previous, next) ? previous : next,
      )
    }
    sync()
    scroller.addEventListener("scroll", sync, { passive: true })
    // The scroller's own box does not change when authored tiles are added,
    // removed, or resized at the same viewport width (short list -> long list
    // would keep a stale "nothing to scroll" state), so the list items are
    // observed too, and re-observed whenever the child set changes.
    const resizeObserver =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(sync)
    const observeBoxes = () => {
      resizeObserver?.disconnect()
      resizeObserver?.observe(scroller)
      for (const child of scroller.children) resizeObserver?.observe(child)
    }
    observeBoxes()
    const mutationObserver =
      typeof MutationObserver === "undefined"
        ? null
        : new MutationObserver(() => {
            observeBoxes()
            sync()
          })
    mutationObserver?.observe(scroller, { childList: true })
    return () => {
      scroller.removeEventListener("scroll", sync)
      resizeObserver?.disconnect()
      mutationObserver?.disconnect()
    }
  }, [])
  const scrollRail = useCallback((towardEnd: boolean) => {
    const scroller = scrollerRef.current
    if (!scroller) return
    // Physical `left` sign depends on writing direction: the logical end of an
    // RTL rail is its visual left.
    const rtl = getComputedStyle(scroller).direction === "rtl"
    const sign = towardEnd === rtl ? -1 : 1
    const behavior = window.matchMedia("(prefers-reduced-motion: reduce)")
      .matches
      ? "auto"
      : "smooth"
    scroller.scrollBy({ left: sign * scroller.clientWidth * 0.8, behavior })
  }, [])
  useEffect(() => {
    const target = focusHandoffRef.current
    if (target === null) return
    focusHandoffRef.current = null
    regionRef.current
      ?.querySelector<HTMLElement>(`[data-testid="${ARROW_TEST_ID[target]}"]`)
      ?.focus()
  }, [railScroll])
  // A slug that fails the LocaleSlug shape can only arrive through a
  // malformed route param, and every href here needs it — including the
  // heading CTA. No rail beats a rail of broken links.
  const locale = tryAsLocaleSlug(languageSlug)
  if (locale === null) return null

  // Resolution (defaults, overrides, dropping unrenderable tiles) lives in
  // `resolveWatchHomeTiles` so the rules are testable without a renderer.
  const cards = resolveWatchHomeTiles({ tiles, categoryIds, locale })

  if (cards.length === 0) return null

  const resolvedEyebrow = eyebrow?.trim() || t("eyebrow")
  const resolvedTitle = title?.trim() || t("title")
  const resolvedDescription = description?.trim() || t("description")
  const resolvedCtaLabel = ctaLabel?.trim() || t("seeAll")

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
            {resolvedEyebrow}
          </p>
          <h2
            id="watch-home-category-rail-title"
            className="col-start-1 row-start-2 max-w-4xl text-2xl leading-tight font-bold tracking-normal text-white xl:text-3xl 2xl:text-4xl"
          >
            {resolvedTitle}
          </h2>
          <p className="col-start-1 row-start-3 max-w-3xl pt-1 text-base leading-snug font-normal text-stone-100/80 xl:text-lg">
            {resolvedDescription}
          </p>
          <Link
            href={languageInventoryPath(locale)}
            data-testid="watch-home-category-see-all"
            className="col-start-1 row-start-4 mt-4 inline-flex w-fit max-w-full shrink-0 items-center gap-2 self-start rounded-full bg-white px-5 py-3 text-center text-base sm:text-sm font-bold tracking-wider text-black uppercase transition-colors hover:bg-red-500 hover:text-white focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none md:col-start-2 md:row-start-1 md:row-end-3 md:mt-0 md:self-center md:px-6 md:py-3.5"
          >
            <WatchLibraryIcon aria-hidden className="size-5 shrink-0" />
            <span>{resolvedCtaLabel}</span>
            <ChevronRight aria-hidden className="size-5 shrink-0" />
          </Link>
        </div>
      </div>

      {/* Native overflow keeps the rail swipeable before hydration. At wide
          desktop widths the cards become a two-row grid so every category is
          visible without horizontal scrolling. */}
      <div className={cn("relative z-[3]", CONTENT_WIDTH_ALIGN_CLASSES)}>
        <div
          aria-label={resolvedTitle}
          ref={regionRef}
          role="region"
          className="relative w-full"
          data-testid="watch-home-category-carousel"
        >
          {/* No tabIndex: every card is a link, and focusing a link scrolls it
              into view, so the scroller would only add a redundant stop.
              scroll-px-* mirrors px-*: without it, mandatory snapping aligns
              the first card's snap-start edge to the bare scrollport on load,
              pulling scrollLeft past the padding so the first card sits flush
              with the viewport edge (same trap MediaCollection documents). */}
          <div
            ref={attachScroller}
            role="list"
            className="flex snap-x snap-mandatory scroll-px-5 gap-4 overflow-x-auto overscroll-x-contain px-5 py-1 md:scroll-px-16 md:px-16 xl:scroll-px-24 xl:px-24 min-[1440px]:grid min-[1440px]:w-full min-[1440px]:snap-none min-[1440px]:grid-cols-7 min-[1440px]:overflow-visible"
            data-testid="watch-home-category-scroller"
          >
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
                "beveled group relative flex h-[130px] w-full flex-col justify-end overflow-hidden rounded-lg p-4 transition duration-300 hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-white/70"
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
                      "absolute end-3 top-3 size-10",
                      ICON_STROKE_CLASSES,
                    )}
                  />
                  <span className="relative min-w-0 line-clamp-3 text-lg leading-tight font-bold break-words text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.45)]">
                    {label}
                  </span>
                </>
              )

              return (
                <div
                  key={card.key}
                  role="listitem"
                  // The wrapper, not the link, is the flex item and owns the
                  // card's width. Without `shrink-0` the wrapper collapses to
                  // its content-less width while the fixed-width link
                  // overflows it, so every card paints on top of its
                  // neighbour and the scroller's scrollable width collapses.
                  className="w-[190px] shrink-0 snap-start min-[1440px]:w-auto min-[1440px]:min-w-0"
                  data-testid={`watch-home-category-slide-${card.key}`}
                >
                  {/* An external destination leaves the app entirely, so it
                      gets a plain anchor with `noopener noreferrer` rather
                      than a client-routed `next/link`. */}
                  {card.kind === "external" ? (
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
                      // shape guarantee comes from `classifyWatchHomeTileHref`
                      // instead — same trade `WatchHomeHero` makes for its
                      // authored slide hrefs. That classifier also strips a
                      // stored `/watch` prefix, so Link's own base-path
                      // prepend cannot produce `/watch/watch/...`.
                      href={card.href as Route}
                      data-testid={`watch-home-category-card-${card.key}`}
                      className={cardClassName}
                      style={{ backgroundImage: card.gradient }}
                    >
                      {cardChildren}
                    </Link>
                  )}
                </div>
              )
            })}
          </div>
          {/* Edge fades are state-aware cues, never hit targets. */}
          {railScroll.canScrollBackward ? (
            <div
              aria-hidden
              data-testid="watch-home-category-fade-start"
              className="pointer-events-none absolute inset-y-0 start-0 z-10 w-12 bg-gradient-to-r from-black/80 to-transparent min-[1440px]:hidden rtl:bg-gradient-to-l"
            />
          ) : null}
          {railScroll.canScrollForward ? (
            <div
              aria-hidden
              data-testid="watch-home-category-fade-end"
              className="pointer-events-none absolute inset-y-0 end-0 z-10 w-12 bg-gradient-to-l from-black/80 to-transparent min-[1440px]:hidden rtl:bg-gradient-to-r"
            />
          ) : null}
          {/* Arrows are real, tabbable buttons, but only for a fine pointer
              from md up (touch swipes natively), where the 64px+ gutter keeps
              them clear of the first and last card at rest. Each renders only
              in a direction that can still scroll, so a spent arrow is never
              a dead control. */}
          {railScroll.measured && railScroll.canScrollBackward ? (
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              aria-label={t("previous")}
              data-testid={PREVIOUS_ARROW_TEST_ID}
              className={cn(ARROW_CLASSES, "start-2")}
              onClick={() => scrollRail(false)}
            >
              <ChevronLeft aria-hidden className="size-5 rtl:rotate-180" />
            </Button>
          ) : null}
          {railScroll.measured && railScroll.canScrollForward ? (
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              aria-label={t("next")}
              data-testid={NEXT_ARROW_TEST_ID}
              className={cn(ARROW_CLASSES, "end-2")}
              onClick={() => scrollRail(true)}
            >
              <ChevronRight aria-hidden className="size-5 rtl:rotate-180" />
            </Button>
          ) : null}
        </div>
      </div>
    </section>
  )
}
