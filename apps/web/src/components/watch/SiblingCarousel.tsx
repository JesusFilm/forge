"use client"

import {
  type MouseEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react"
import Image from "next/image"
import Link from "next/link"
import { useTranslations } from "next-intl"
import { LoaderCircle, Play } from "lucide-react"

import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
  type CarouselApi,
} from "@/components/ui/carousel"
import {
  VIDEO_THUMBNAIL_FOCUS_TARGET_CLASS,
  VideoThumbnailInteractionFrame,
} from "@/components/ui/video-thumbnail-interaction-frame"
import {
  VideoThumbnailCaption,
  VideoThumbnailEyebrow,
  VideoThumbnailTitle,
} from "@/components/ui/video-thumbnail-caption"
import { WatchProgressBar } from "@/components/watch/WatchProgressBar"
import { CAROUSEL_END_SPACER } from "@/lib/content-width"
import { cn } from "@/lib/utils"
import type { WatchSiblingCarouselBlock } from "@/lib/content"
import {
  tryAsContentSlug,
  tryAsLocaleSlug,
  watchVideoPath,
  watchEpisodePath,
} from "@/lib/routes"
import {
  resolveMuxFrameThumbnailUrl,
  resolveMuxAnimatedPreviewUrl,
  resolveMuxHeroPosterUrl,
  resolvePosterUrl,
} from "@/lib/url"
import { MuxHoverPreview } from "@/components/watch/MuxHoverPreview"
import {
  WATCH_CHAPTER_CAROUSEL_PRESERVE_KEY,
  type WatchChapterCarouselPreserveState,
  type WatchChapterNavigationIntent,
} from "./chapter-navigation"

function getRoutableCarouselChildren(
  parent: WatchSiblingCarouselBlock["canonicalParent"],
) {
  return (parent.children ?? []).filter(
    (child): child is NonNullable<typeof child> & { slug: string } =>
      child != null && typeof child.slug === "string" && child.slug.length > 0,
  )
}

function consumePreservedCarouselIndex({
  children,
  currentVideoDocumentId,
  languageSlug,
}: {
  children: Array<{ documentId: string }>
  currentVideoDocumentId: string
  languageSlug: string
}): number | null {
  if (typeof window === "undefined") return null

  const raw = window.sessionStorage.getItem(WATCH_CHAPTER_CAROUSEL_PRESERVE_KEY)
  if (!raw) return null

  window.sessionStorage.removeItem(WATCH_CHAPTER_CAROUSEL_PRESERVE_KEY)

  let state: WatchChapterCarouselPreserveState
  try {
    state = JSON.parse(raw) as WatchChapterCarouselPreserveState
  } catch {
    return null
  }

  if (
    state.languageSlug !== languageSlug ||
    state.targetVideoDocumentId !== currentVideoDocumentId
  ) {
    return null
  }

  const sourceIndex = children.findIndex(
    (child) => child.documentId === state.sourceVideoDocumentId,
  )
  if (
    typeof state.sourceCarouselIndex === "number" &&
    Number.isInteger(state.sourceCarouselIndex) &&
    state.sourceCarouselIndex >= 0 &&
    state.sourceCarouselIndex < children.length
  ) {
    return state.sourceCarouselIndex
  }
  return sourceIndex >= 0 ? sourceIndex : null
}

export function SiblingCarousel({
  block,
  languageSlug,
  pendingNavigation,
  onChapterNavigateIntent,
}: {
  block: WatchSiblingCarouselBlock
  languageSlug: string
  pendingNavigation?: WatchChapterNavigationIntent | null
  onChapterNavigateIntent?: (intent: WatchChapterNavigationIntent) => void
}) {
  const t = useTranslations("SiblingCarousel")
  const videoLabels = useTranslations("VideoLabels")
  const { canonicalParent, currentVideoDocumentId } = block
  const selectableParents =
    block.selectableParents != null && block.selectableParents.length > 0
      ? block.selectableParents
      : null
  const defaultParent = selectableParents?.[0] ?? canonicalParent
  const [parentSelection, setParentSelection] = useState<{
    sourceVideoDocumentId: string
    parentDocumentId: string
  } | null>(null)
  const selectedParentDocumentId =
    parentSelection?.sourceVideoDocumentId === currentVideoDocumentId
      ? parentSelection.parentDocumentId
      : defaultParent.documentId
  const selectedParent =
    selectableParents?.find(
      (parent) => parent.documentId === selectedParentDocumentId,
    ) ?? canonicalParent
  const hasExplicitParentSelection =
    parentSelection?.sourceVideoDocumentId === currentVideoDocumentId

  // Drop nulls AND items missing a slug — without a slug we can't build a
  // routable href, and rendering an unclickable card is worse than
  // omitting it entirely. Content-slug and public language-slug validity are
  // re-checked per child via the route builders below (a malformed slug still
  // renders, just not as a <Link>).
  const children = getRoutableCarouselChildren(selectedParent)

  const activeIndex = children.findIndex(
    (child) => child.documentId === currentVideoDocumentId,
  )
  const clipTotal = children.length
  const parentTitle = selectedParent.title ?? videoLabels("collection")
  const parentSlug =
    typeof selectedParent.slug === "string"
      ? tryAsContentSlug(selectedParent.slug)
      : null
  const parentHref =
    parentSlug != null && tryAsLocaleSlug(languageSlug) != null
      ? watchVideoPath(parentSlug, tryAsLocaleSlug(languageSlug)!)
      : null

  // All carousel thumbnails ship with `loading="lazy"`. Native browser
  // lazy-loading still fetches above-fold images immediately — it only
  // defers fetches for images far below the viewport. Cards peeking
  // through the 300 px gap under the sticky hero load on the same paint
  // cycle. We don't emit `<link rel="preload">` in head (next/image emits
  // those for both `priority` and `loading="eager"`) because they
  // compete with the LCP poster fetch on the critical chain.

  const [api, setApi] = useState<CarouselApi | null>(null)
  const [localPendingNavigation, setLocalPendingNavigation] =
    useState<WatchChapterNavigationIntent | null>(null)
  const effectivePendingNavigation =
    pendingNavigation === undefined ? localPendingNavigation : pendingNavigation

  const handleCardClick = useCallback(
    (
      event: MouseEvent<HTMLAnchorElement>,
      intent: WatchChapterNavigationIntent,
      isActive: boolean,
    ) => {
      if (event.defaultPrevented) return
      if (event.button !== 0) return
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return
      }
      if (isActive) {
        event.preventDefault()
        return
      }

      if (onChapterNavigateIntent != null) {
        event.preventDefault()
      }
      if (pendingNavigation === undefined) {
        setLocalPendingNavigation(intent)
      }
      onChapterNavigateIntent?.(intent)
    },
    [onChapterNavigateIntent, pendingNavigation],
  )

  const validPendingNavigation =
    effectivePendingNavigation != null &&
    effectivePendingNavigation.languageSlug === languageSlug &&
    effectivePendingNavigation.sourceVideoDocumentId === currentVideoDocumentId
      ? effectivePendingNavigation
      : null
  const pendingActiveIndex =
    validPendingNavigation != null
      ? children.findIndex(
          (child) =>
            child.documentId === validPendingNavigation.targetVideoDocumentId,
        )
      : -1
  const visualActiveIndex =
    pendingActiveIndex >= 0 ? pendingActiveIndex : activeIndex
  const isParentMode = visualActiveIndex < 0
  const clipIndex = visualActiveIndex >= 0 ? visualActiveIndex + 1 : 1
  const [initialCarouselState] = useState(() => {
    const preservedIndex = consumePreservedCarouselIndex({
      children,
      currentVideoDocumentId,
      languageSlug,
    })
    return {
      index: preservedIndex ?? (activeIndex >= 0 ? activeIndex : 0),
      deferInitialAutoScroll: preservedIndex != null,
    }
  })
  const carouselStartIndex = hasExplicitParentSelection
    ? visualActiveIndex >= 0
      ? visualActiveIndex
      : 0
    : initialCarouselState.index
  const deferInitialAutoScrollRef = useRef(
    initialCarouselState.deferInitialAutoScroll,
  )

  // Snap to the visually active item whenever it changes (or when `api`
  // first becomes available). Pending navigation can temporarily move the
  // active treatment to the clicked chapter before the route data catches up.
  // The early-return guard handles parent-page mode (no card to snap to).
  useEffect(() => {
    if (!api) return
    if (visualActiveIndex < 0) return
    if (pendingActiveIndex >= 0) return
    if (deferInitialAutoScrollRef.current) {
      deferInitialAutoScrollRef.current = false
      let secondFrame = 0
      // The target route mounts at the source chapter's carousel position.
      // Wait until after that commit paints, then animate the clicked chapter
      // into the lead position so it reads as one post-transition movement.
      const firstFrame = window.requestAnimationFrame(() => {
        secondFrame = window.requestAnimationFrame(() => {
          api.scrollTo(visualActiveIndex)
        })
      })
      return () => {
        window.cancelAnimationFrame(firstFrame)
        if (secondFrame !== 0) window.cancelAnimationFrame(secondFrame)
      }
    }
    // Let Embla animate the active-card change. Passing `jump: true` made
    // chapter clicks teleport the rail so the clicked item snapped into the
    // first position, which felt like a page reload.
    api.scrollTo(visualActiveIndex)
  }, [api, pendingActiveIndex, visualActiveIndex])

  if (children.length < 2) return null

  // Parent-page mode (current video IS the parent / collection): suppress
  // the "Clip N of M" position counter. There's no active position to
  // count from, and rendering "Clip 1 of N" would be misleading. Show a
  // simple "{N} chapters" total instead, mirroring the change in
  // aria-label below.
  const ariaLabel = isParentMode
    ? t("chaptersAriaLabel", { title: parentTitle, count: clipTotal })
    : t("clipAriaLabel", {
        title: parentTitle,
        current: clipIndex,
        total: clipTotal,
      })
  const positionLabel = isParentMode ? (
    t("chapterCount", { count: clipTotal })
  ) : (
    <>
      <span className="md:hidden">
        {t("position", { current: clipIndex, total: clipTotal })}
      </span>
      <span className="hidden md:inline">
        {t("clipPosition", {
          current: clipIndex,
          total: clipTotal,
        })}
      </span>
    </>
  )

  return (
    <section
      data-block-type="SiblingCarousel"
      data-mode={isParentMode ? "parent" : "chapter"}
      className="relative -mx-5 w-[calc(100%+2.5rem)] pt-2 pb-2 md:mx-0 md:w-full"
      aria-label={ariaLabel}
    >
      <header className="mb-4 px-5 md:px-0">
        {selectableParents != null ? (
          <div className="flex min-w-0 flex-col gap-2 md:flex-row md:items-center md:gap-3">
            <select
              aria-label={videoLabels("collection")}
              aria-busy={validPendingNavigation != null ? "true" : undefined}
              data-testid="sibling-carousel-parent-selector"
              value={selectedParent.documentId}
              disabled={validPendingNavigation != null}
              className="min-h-11 w-full min-w-0 max-w-full truncate rounded-md border border-stone-600 bg-stone-800 px-3 py-2 text-sm font-medium text-stone-100 outline-none focus-visible:border-stone-300 focus-visible:ring-2 focus-visible:ring-white/80 disabled:cursor-wait disabled:opacity-60 md:w-auto md:max-w-xs md:flex-1"
              onChange={(event) => {
                setApi(null)
                deferInitialAutoScrollRef.current = false
                setParentSelection({
                  sourceVideoDocumentId: currentVideoDocumentId,
                  parentDocumentId: event.currentTarget.value,
                })
              }}
            >
              {selectableParents.map((parent) => (
                <option key={parent.documentId} value={parent.documentId}>
                  {parent.title ?? videoLabels("collection")}
                </option>
              ))}
            </select>
            <span
              data-testid="sibling-carousel-label"
              className="shrink-0 text-sm font-normal text-stone-300"
            >
              {positionLabel}
            </span>
            <span
              aria-live="polite"
              aria-atomic="true"
              data-testid="sibling-carousel-selection-announcement"
              className="sr-only"
            >
              {parentTitle} · {t("chapterCount", { count: clipTotal })}
            </span>
          </div>
        ) : (
          <p className="text-sm font-normal text-stone-300">
            {parentHref != null ? (
              <Link
                href={parentHref}
                className="text-stone-100 hover:underline"
              >
                <span className="font-medium">{parentTitle}</span>
              </Link>
            ) : (
              <span className="font-medium text-stone-100">{parentTitle}</span>
            )}
            <span className="px-2 text-stone-500">·</span>
            <span data-testid="sibling-carousel-label">{positionLabel}</span>
          </p>
        )}
      </header>

      <Carousel
        key={selectedParent.documentId}
        opts={{
          align: "start",
          containScroll: "trimSnaps",
          startIndex: carouselStartIndex,
        }}
        setApi={setApi}
        className="w-full ps-5 md:ps-0"
      >
        <CarouselContent>
          {children.map((child, index) => {
            const isActive = index === visualActiveIndex
            // Prefer a Mux frame from the current watch language when admin
            // supplied one; fall back to the curated editorial image chain.
            // The raw `images[].url` value is excluded from that chain
            // entirely: it's a misshaped Cloudflare Images URL (missing the
            // variant path segment) that returns 400, so a "last resort"
            // fallback to it only ever produces broken images.
            const muxThumb = resolveMuxFrameThumbnailUrl(child.muxPlaybackId)
            const muxPreview = resolveMuxAnimatedPreviewUrl(child.muxPlaybackId)
            const thumb = muxThumb ?? resolvePosterUrl(child.images?.[0])
            const heroPoster = resolveMuxHeroPosterUrl(child.muxPlaybackId)
            const blurDataURL =
              muxThumb != null ? child.muxThumbnailBlurDataUrl : null
            const heroBlurDataURL =
              heroPoster != null ? child.muxHeroPosterBlurDataUrl : null
            const slug = tryAsContentSlug(child.slug)
            const lang = tryAsLocaleSlug(languageSlug)
            const href =
              parentSlug && slug && lang
                ? watchEpisodePath(parentSlug, slug, lang)
                : undefined
            const isPending =
              validPendingNavigation != null &&
              validPendingNavigation.href === href &&
              validPendingNavigation.targetVideoDocumentId === child.documentId
            const thumbnailAlt = child.title
              ? t("thumbnailAlt", { title: child.title })
              : t("relatedVideoThumbnail")

            const cardClassName = cn(
              "relative block aspect-video overflow-hidden rounded-lg bg-stone-900 transition shadow-[0_2px_6px_rgba(0,0,0,0.35),0_14px_32px_-12px_rgba(0,0,0,0.6)]",
              href && "group cursor-pointer",
              href && VIDEO_THUMBNAIL_FOCUS_TARGET_CLASS,
              isActive
                ? "opacity-100"
                : cn(
                    "opacity-70",
                    href &&
                      "hover:opacity-100 focus-visible:opacity-100 hover:shadow-[0_4px_10px_rgba(0,0,0,0.4),0_22px_44px_-14px_rgba(0,0,0,0.7)]",
                  ),
              isPending &&
                !isActive &&
                "opacity-100 shadow-[0_4px_10px_rgba(0,0,0,0.4),0_22px_44px_-14px_rgba(0,0,0,0.7)]",
            )

            // Card contents are identical whether the card is a routable
            // <Link> or (for a rare malformed slug) a non-clickable <div>.
            const cardInner = (
              <>
                {thumb ? (
                  <Image
                    src={thumb}
                    alt={thumbnailAlt}
                    fill
                    sizes="(max-width: 640px) 48vw, (max-width: 768px) 36vw, (max-width: 1024px) 33vw, (max-width: 1280px) 25vw, (max-width: 1536px) 20vw, 16vw"
                    className="object-cover transition-transform duration-300 group-hover:scale-105"
                    {...(blurDataURL
                      ? {
                          placeholder: "blur" as const,
                          blurDataURL,
                        }
                      : {})}
                    // Native lazy-loading. Browser still fetches
                    // above-fold cards immediately (lazy only defers
                    // far-from-viewport). Avoids the head-preload
                    // entries next/image emits for `priority` /
                    // `loading="eager"` that compete with the LCP
                    // poster fetch.
                    loading="lazy"
                  />
                ) : (
                  <div
                    data-testid="sibling-carousel-thumb-placeholder"
                    className="flex h-full w-full items-center justify-center bg-stone-900 text-xs text-stone-600"
                  >
                    {t("noImage")}
                  </div>
                )}
                <MuxHoverPreview
                  previewUrl={href ? muxPreview : null}
                  sizes="(max-width: 640px) 48vw, (max-width: 768px) 36vw, (max-width: 1024px) 33vw, (max-width: 1280px) 25vw, (max-width: 1536px) 20vw, 16vw"
                />

                {/* Soften the image into the lower caption zone. */}
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-full bg-black/35 backdrop-blur-[14px] [mask-image:linear-gradient(to_top,black_0%,rgba(0,0,0,0.9)_35%,rgba(0,0,0,0.35)_62%,transparent_100%)] [-webkit-mask-image:linear-gradient(to_top,black_0%,rgba(0,0,0,0.9)_35%,rgba(0,0,0,0.35)_62%,transparent_100%)]"
                />

                {/* Hover-only play overlay on inactive cards. A pending
                    active card swaps the play glyph for a loader so the
                    current-looking tile still communicates navigation work. */}
                {!isActive || isPending ? (
                  <div
                    aria-hidden="true"
                    data-testid="sibling-carousel-play-overlay"
                    data-pending={isPending ? "true" : "false"}
                    className={cn(
                      "pointer-events-none absolute inset-0 z-30 flex items-center justify-center opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100",
                      isPending && "opacity-100",
                    )}
                  >
                    <span className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-red text-white shadow-lg ring-1 ring-black/20">
                      {isPending ? (
                        <LoaderCircle
                          aria-hidden="true"
                          data-testid="sibling-carousel-loading-icon"
                          size={22}
                          className="animate-spin"
                        />
                      ) : (
                        <Play size={20} fill="currentColor" stroke="none" />
                      )}
                    </span>
                  </div>
                ) : null}

                {/* Caption block — a lower frosted panel like the modern
                    episode rails, keeping text readable inside the
                    landscape tile. */}
                <VideoThumbnailCaption
                  data-testid="sibling-carousel-caption"
                  inset="compact"
                  className="z-20 bg-gradient-to-t from-black/68 via-black/35 to-transparent"
                >
                  <VideoThumbnailEyebrow size="compact-sm">
                    {t("chapter")}
                  </VideoThumbnailEyebrow>
                  {/* Card title rendered as <span>, not <h3>: the cards are
                      sibling-navigation Link items and don't anchor their
                      own section. Emitting an <h3> with no parent <h2>
                      skipped the heading order (WCAG 1.3.1) and would
                      require an artificial sr-only section header. The
                      Link's accessible name covers the card's title. */}
                  <VideoThumbnailTitle as="span" size="compact-sm">
                    {child.title ?? ""}
                  </VideoThumbnailTitle>
                </VideoThumbnailCaption>

                <div
                  aria-hidden="true"
                  data-testid="sibling-carousel-bevel"
                  className="pointer-events-none absolute inset-0 z-40 rounded-lg border border-white opacity-40 mix-blend-soft-light"
                />
                <WatchProgressBar videoId={child.documentId} />

                {href ? (
                  <VideoThumbnailInteractionFrame
                    data-testid="sibling-carousel-hover-outline"
                    interactive={!isActive}
                    visible={isPending}
                  />
                ) : null}

                <div
                  aria-hidden="true"
                  data-testid="sibling-carousel-active-outline"
                  className={cn(
                    "pointer-events-none absolute inset-0 z-[70] rounded-lg border-4 border-white transition-[opacity,transform] duration-300 ease-out",
                    isActive
                      ? "scale-100 opacity-100 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.45)]"
                      : "scale-[0.985] opacity-0",
                  )}
                />

                {/* Visually-hidden active marker — preserves the existing
                    `sibling-carousel-playing-now` testid and gives screen
                    readers a labeled "Playing now" affordance even though
                    the visual cue is a border, not a pill. */}
                {isActive ? (
                  <span
                    data-testid="sibling-carousel-playing-now"
                    className="sr-only"
                  >
                    {t("playingNow")}
                  </span>
                ) : null}
              </>
            )

            return (
              <CarouselItem
                key={child.documentId}
                className="basis-[48%] sm:basis-[36%] md:basis-1/3 lg:basis-1/4 xl:basis-1/5 2xl:basis-1/6"
                aria-current={isActive ? "true" : undefined}
              >
                {/* Active cards use a real inside border. Inactive cards keep
                    no transparent border; the bevel is drawn by a content
                    overlay so it stays visible around the whole picture. A
                    malformed slug (no routable href) renders a non-clickable
                    <div> with identical markup minus the href/data-href. */}
                {href ? (
                  <Link
                    href={href}
                    prefetch={false}
                    data-testid="sibling-carousel-item"
                    data-active={isActive ? "true" : "false"}
                    data-pending={isPending ? "true" : "false"}
                    data-href={href}
                    aria-busy={isPending ? "true" : undefined}
                    className={cardClassName}
                    onNavigate={(event) => {
                      if (isActive) return
                      if (onChapterNavigateIntent == null) return

                      event.preventDefault()
                    }}
                    onClick={(event) => {
                      handleCardClick(
                        event,
                        {
                          href,
                          languageSlug,
                          sourceVideoDocumentId: currentVideoDocumentId,
                          targetVideoDocumentId: child.documentId,
                          title: child.title ?? null,
                          slug: child.slug,
                          label: child.label ?? null,
                          posterUrl: heroPoster ?? thumb,
                          posterBlurDataUrl: heroBlurDataURL,
                          sourceCarouselIndex:
                            api?.selectedScrollSnap() ?? null,
                        },
                        isActive,
                      )
                    }}
                  >
                    {cardInner}
                  </Link>
                ) : (
                  <div
                    data-testid="sibling-carousel-item"
                    data-active={isActive ? "true" : "false"}
                    className={cardClassName}
                  >
                    {cardInner}
                  </div>
                )}
              </CarouselItem>
            )
          })}
          <CarouselItem
            aria-hidden="true"
            data-testid="sibling-carousel-end-spacer"
            tabIndex={-1}
            className="basis-auto ps-0"
          >
            <div className={CAROUSEL_END_SPACER} />
          </CarouselItem>
        </CarouselContent>

        {/* The shared `outline` Button variant only sets text color on
            hover (via `hover:text-foreground`); against this dark-themed
            page the chevrons inherit white from the parent until hover.
            Force the chevrons to a near-black at all times so the arrow
            stays legible against the light circular background. */}
        <CarouselPrevious
          className="hidden text-stone-900 hover:text-stone-900 md:inline-flex"
          label={t("previousChapter")}
        />
        <CarouselNext
          className="hidden text-stone-900 hover:text-stone-900 md:inline-flex"
          label={t("nextChapter")}
        />
      </Carousel>
    </section>
  )
}
