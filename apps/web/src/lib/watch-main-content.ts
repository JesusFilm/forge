// Target of the root layout's skip link. Exactly one element per rendered page
// owns it: the FloatingSearchProvider content wrapper on shell pages, or the
// page's own <main> on the two fallbacks that render outside the shell (root
// not-found and root error boundary, which replace the segment's shell).
export const WATCH_MAIN_CONTENT_ID = "watch-main-content"

// Spread onto the <main> of a fallback that owns the skip-link target.
export const watchMainContentTargetProps = {
  id: WATCH_MAIN_CONTENT_ID,
  tabIndex: -1,
} as const
