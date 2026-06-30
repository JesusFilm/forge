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
  "left-10 md:left-16 xl:left-[max(6rem,calc((100vw-1920px)/2+6rem))]"
export const WATCH_PAGE_RIGHT_EDGE_CLASSES =
  "right-10 md:right-16 xl:right-[max(6rem,calc((100vw-1920px)/2+6rem))]"
export const SEARCH_OVERLAY_FIELD_WIDTH_CLASSES = "mx-auto w-full max-w-[810px]"
export const WATCH_PAGE_SEARCH_FIELD_CLASSES =
  "left-[6rem] right-[6rem] w-auto max-w-none translate-x-0 md:left-1/2 md:right-auto md:w-[calc(100%-3rem)] md:max-w-[810px] md:-translate-x-1/2"
export const WATCH_PAGE_CONTENT_CLASSES = `${CONTENT_WIDTH_ALIGN_CLASSES} ${WATCH_PAGE_RAIL_PADDING_CLASSES}`

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
