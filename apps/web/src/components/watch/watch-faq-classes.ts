// Shared Watch FAQ type scale (see `WatchFaqList`). Kept out of that client
// module so server components such as `RelatedQuestions` read the strings
// themselves rather than a client reference.

/** Section eyebrow type scale. Colour is the caller's. */
export const WATCH_FAQ_EYEBROW_CLASS =
  "text-xs font-semibold tracking-[0.3em] uppercase sm:text-sm"

/** Section heading type scale. Colour is the caller's. */
export const WATCH_FAQ_HEADING_CLASS =
  "text-3xl leading-[1.1] font-semibold tracking-[-0.025em] text-balance sm:text-4xl lg:text-5xl"
