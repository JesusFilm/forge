/**
 * Shared content width for experience sections. Use so VideoHero, Section blur,
 * and other blocks align horizontally. Change here to adjust all sections.
 */
export const CONTENT_MAX_WIDTH = "max-w-[1920px]"

/** Full-bleed alignment (e.g. video player): same width, no horizontal padding. */
export const CONTENT_WIDTH_ALIGN_CLASSES = `mx-auto w-full ${CONTENT_MAX_WIDTH}`

/** Content area: same width + horizontal padding for inner content. */
export const CONTENT_WIDTH_CLASSES = `${CONTENT_WIDTH_ALIGN_CLASSES} px-4 sm:px-6 lg:px-8 xl:px-10 2xl:px-12`

/**
 * Watch-page rail: aligns floating chrome, hero overlay text, carousel, and
 * body content on the same left edge.
 */
export const WATCH_PAGE_RAIL_PADDING_CLASSES = "px-5 md:px-16 xl:px-24"
export const WATCH_PAGE_LEFT_RAIL_CLASSES = "left-5 md:left-16 xl:left-24"
export const WATCH_PAGE_LEFT_EDGE_CLASSES =
  "left-5 md:left-16 xl:left-[max(6rem,calc((100vw-1920px)/2+6rem))] compact-landscape:left-[max(1.25rem,env(safe-area-inset-left,0px))]"
export const WATCH_PAGE_RIGHT_EDGE_CLASSES =
  "right-5 md:right-16 xl:right-[max(6rem,calc((100vw-1920px)/2+6rem))] compact-landscape:right-[max(1.25rem,env(safe-area-inset-right,0px))]"
export const FLOATING_HEADER_HEIGHT_CLASS = "h-[52px]"
export const FLOATING_HEADER_MOBILE_BOUNDARY_HEIGHT_CLASS =
  "h-[calc(env(safe-area-inset-top,0px)+0.75rem+52px+0.75rem)]"
export const FLOATING_HEADER_GAP_CLASS = "gap-3 md:gap-5"
export const FLOATING_HEADER_TOP_CLASS =
  "top-[calc(env(safe-area-inset-top,0px)+0.75rem)] md:top-[calc(env(safe-area-inset-top,0px)+3rem)] compact-landscape:top-[calc(env(safe-area-inset-top,0px)+0.5rem)]"
export const FLOATING_HEADER_PINNED_TOP_CLASS =
  "top-[calc(env(safe-area-inset-top,0px)+0.75rem)] md:top-[calc(env(safe-area-inset-top,0px)+1rem)] compact-landscape:top-[calc(env(safe-area-inset-top,0px)+0.5rem)]"
export const FLOATING_HEADER_LOGO_SLOT_CLASS =
  "h-11 w-11 shrink-0 md:h-[52px] md:w-12"
export const FLOATING_HEADER_HOME_LOGO_SLOT_CLASS =
  "h-11 w-20 shrink-0 sm:w-28 md:h-[52px] md:w-[139px]"
export const FLOATING_HEADER_TRAILING_SLOT_CLASS =
  "h-11 w-11 shrink-0 md:h-[52px] md:w-12"
export const FLOATING_HEADER_TRAILING_GROUP_CLASS =
  "flex h-11 shrink-0 items-center justify-end gap-1 md:h-[52px] md:gap-2"
export const FLOATING_HEADER_LANGUAGE_SLOT_CLASS =
  "h-11 w-11 md:h-[52px] md:w-12"
/**
 * Open search uses two compact rows on mobile: logo/close, then field/language.
 * At the desktop breakpoint it returns to the standard single-row header.
 */
export const FLOATING_MODAL_HEADER_LAYOUT_CLASS =
  "grid h-[108px] grid-cols-[minmax(0,1fr)_auto] grid-rows-[44px_52px] items-start gap-3 md:flex md:h-[52px] md:gap-5"
export const FLOATING_MODAL_HEADER_LOGO_POSITION_CLASS =
  "col-start-1 row-start-1"
export const FLOATING_MODAL_HEADER_FIELD_POSITION_CLASS =
  "col-start-1 row-start-2"
export const FLOATING_MODAL_HEADER_TRAILING_GROUP_CLASS =
  "pointer-events-none col-start-2 row-span-2 row-start-1 grid h-[108px] grid-rows-[44px_52px] justify-items-end gap-3 md:flex md:h-[52px] md:shrink-0 md:items-center md:justify-end md:gap-2"
export const FLOATING_MODAL_HEADER_LANGUAGE_POSITION_CLASS =
  "row-start-2 self-center md:self-auto"
export const FLOATING_MODAL_HEADER_CLOSE_POSITION_CLASS =
  "row-start-1 justify-self-end md:self-auto"
export const WATCH_PAGE_CONTENT_CLASSES = `${CONTENT_WIDTH_ALIGN_CLASSES} ${WATCH_PAGE_RAIL_PADDING_CLASSES}`

/**
 * Watch carousel layout contract. The viewport cancels the padded Watch rail
 * out to the centered 1920px frame, then the track restores the same leading
 * space so an unscrolled first card stays aligned with surrounding content.
 */
export const WATCH_CAROUSEL_RAIL_VIEWPORT_CLASSES =
  "-mx-5 w-[calc(100%+2.5rem)] md:-mx-16 md:w-[calc(100%+8rem)] xl:-mx-24 xl:w-[calc(100%+12rem)]"
export const WATCH_CAROUSEL_RAIL_CONTENT_PADDING = "pl-5 md:pl-16 xl:pl-24"
export const WATCH_CAROUSEL_RAIL_END_SPACER = "w-5 md:w-16 xl:w-24"
export const WATCH_CAROUSEL_RAIL_ALIGN = (viewSize: number) => {
  if (viewSize >= 1280) return 96
  if (viewSize >= 768) return 64
  return 20
}

/**
 * Language inventory carousels browse across the Watch frame while card zero
 * remains aligned with their centered max-w-7xl / px-5 sm:px-8 content.
 */
export const WATCH_CAROUSEL_INVENTORY_CONTENT_PADDING =
  "pl-5 sm:pl-[max(2rem,calc(50%_-_38rem))]"
export const WATCH_CAROUSEL_INVENTORY_END_SPACER =
  "w-5 sm:w-[max(2rem,calc(50%_-_38rem))]"
export const WATCH_CAROUSEL_INVENTORY_ALIGN = (viewSize: number) =>
  viewSize >= 640 ? Math.max(32, viewSize / 2 - 608) : 20

/**
 * Carousel bleed: lets a carousel inside a Section break out of the content
 * padding so cards can scroll edge-to-edge, while the first card still starts
 * aligned with the padded content area.
 *
 * Apply CAROUSEL_BLEED_CLASSES to the carousel's outer wrapper (negative margins
 * pull it past the Section padding). Apply CAROUSEL_CONTENT_PADDING to
 * CarouselContent so the first slide starts at the content edge.
 */
export const CAROUSEL_BLEED_CLASSES =
  "-mx-4 sm:-mx-6 lg:-mx-8 xl:-mx-10 2xl:-mx-12"
export const CAROUSEL_CONTENT_PADDING =
  "pl-4 sm:pl-6 lg:pl-8 xl:pl-10 2xl:pl-12"

/**
 * Width classes for the trailing spacer slide in a carousel.
 * Embla's containScroll trims CSS padding-right, so we add a real
 * CarouselItem as the last slide to mirror the left content padding.
 */
export const CAROUSEL_END_SPACER = "w-4 sm:w-6 lg:w-8 xl:w-10 2xl:w-12"
