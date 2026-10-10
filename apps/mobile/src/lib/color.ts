// ── Semantic color tokens ──────────────────────────────────────────────────
// Warm stone palette (stone-900 → stone-50).

/** App base background color (warm dark). */
export const BG_COLOR = "#1c1917"

/** Elevated surface (cards, fallback backgrounds). */
export const SURFACE_COLOR = "#292524"

/** Player / true-black background. */
export const BLACK = "#000000"

/** Primary text (stone-100). */
export const TEXT_PRIMARY = "#f5f5f4"

/** Secondary / muted text (stone-400). */
export const TEXT_SECONDARY = "#a8a29e"

/** Body text (stone-300). */
export const TEXT_BODY = "#d6d3d1"

/** Brand accent (JFP red). For fills, large text, and non-text UI (3:1 bar). */
export const ACCENT = "#CB333B"

/**
 * Brand accent for legible TEXT/links on dark. ACCENT (#CB333B) is only ~3.4:1
 * on BG — below WCAG AA 4.5:1 for normal text; this lighter red clears 4.5:1 on
 * both dark surfaces. Use for accent text/links; keep ACCENT for fills/large text.
 */
export const ACCENT_ON_DARK = "#E96067"

/** Completed-download status (semantic-status grouping, KTD10). */
export const STATUS_DONE_COLOR = "#34d399"

/** Failed-download status. */
export const STATUS_FAILED_COLOR = "#fb7185"

/** Inline warning cards and non-fatal error notices. */
export const WARNING_COLOR = "#fbbf24"

/** Text rendered on image/gradient overlays. */
export const TEXT_ON_OVERLAY = "#ffffff"

/** Quiz button gradient (orange → red, left to right). */
export const QUIZ_GRADIENT: readonly [string, string] = ["#E8891C", "#CB333B"]

/**
 * Convert a hex color to an rgba string. Use instead of "transparent" in
 * LinearGradient: "transparent" is rgba(0,0,0,0), so interpolating from it to
 * non-black colors passes through dark intermediate tones (banding).
 */
export function hexToRgba(hex: string, alpha: number): string {
  const cleaned = hex.replace("#", "")
  const r = parseInt(cleaned.substring(0, 2), 16)
  const g = parseInt(cleaned.substring(2, 4), 16)
  const b = parseInt(cleaned.substring(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}
