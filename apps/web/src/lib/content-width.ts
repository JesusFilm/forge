/**
 * Shared content width for experience sections. Use so VideoHero, Section blur,
 * and other blocks align horizontally. Change here to adjust all sections.
 */
export const CONTENT_MAX_WIDTH = "max-w-[1920px]"

/** Full-bleed alignment (e.g. video player): same width, no horizontal padding. */
export const CONTENT_WIDTH_ALIGN_CLASSES = `mx-auto w-full ${CONTENT_MAX_WIDTH}`

/** Content area: same width + horizontal padding for inner content. */
export const CONTENT_WIDTH_CLASSES = `${CONTENT_WIDTH_ALIGN_CLASSES} px-4 sm:px-8 lg:px-10`

/**
 * Carousel bleed: lets a carousel inside a Section break out of the content
 * padding so cards can scroll edge-to-edge, while the first card still starts
 * aligned with the padded content area.
 *
 * Apply CAROUSEL_BLEED_CLASSES to the carousel's outer wrapper (negative margins
 * pull it past the Section padding). Apply CAROUSEL_CONTENT_PADDING to
 * CarouselContent so the first slide starts at the content edge.
 */
export const CAROUSEL_BLEED_CLASSES = "-mx-4 sm:-mx-8 lg:-mx-10"
export const CAROUSEL_CONTENT_PADDING = "pl-4 sm:pl-8 lg:pl-10"

/**
 * Width classes for the trailing spacer slide in a carousel.
 * Embla's containScroll trims CSS padding-right, so we add a real
 * CarouselItem as the last slide to mirror the left content padding.
 */
export const CAROUSEL_END_SPACER = "w-4 sm:w-8 lg:w-10"
