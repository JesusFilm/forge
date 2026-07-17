// Devotional visual styles — ported from the "Cards by Style" design.
//
// FILTER and LAYOUT are INDEPENDENT axes and are now stored separately:
//   • FILTER  = the look of the footage + palette: `mediaBase` grade, grain
//     amounts, vignette, accent colors, blobs. See DEVOTIONAL_FILTERS.
//   • LAYOUT  = where things sit + how the blur works: `header`, `cover`,
//     `scripture`, `textBottom`, `pullquote`, `panelFrost`. See
//     DEVOTIONAL_LAYOUTS.
// Any filter can pair with any layout. `resolveDevotionalStyle(filterId,
// layoutId)` composes the two into the single `DevotionalStyle` token object
// the components consume — so component code stays agnostic to the split.
// When `layoutId` is omitted, each filter falls back to its NATIVE_LAYOUT
// (the original 1:1 pairing) for backwards compatibility.

// ---- FILTER (color / grade / palette) ----
// The active set is grain · tealorange · splittone. `teal` and `sepia` are kept
// as back-compat aliases for older manifests that still reference them.
export const DEVOTIONAL_FILTER_IDS = [
  "grain",
  "tealorange",
  "splittone",
  "teal",
  "sepia",
] as const
export type DevotionalFilterId = (typeof DEVOTIONAL_FILTER_IDS)[number]

// ---- LAYOUT (arrangement) ----
export const DEVOTIONAL_LAYOUT_IDS = [
  "centered",
  "editorial",
  "classic",
  "grounded",
  "grounded-panel",
] as const
export type DevotionalLayoutId = (typeof DEVOTIONAL_LAYOUT_IDS)[number]

// Back-compat alias: the input prop is still called `style` and selects a FILTER.
export const DEVOTIONAL_STYLE_IDS = DEVOTIONAL_FILTER_IDS
export type DevotionalStyleId = DevotionalFilterId

export type HeaderLayout = "centered" | "row" | "brand"

export type DevotionalFilter = {
  id: DevotionalFilterId
  label: string
  /** Background for the four text cards. */
  textBg: string
  /** Fallback background behind media. */
  mediaBg: string
  body: string
  heading: string
  /** DEC 25 / secondary chrome color. */
  secondary: string
  /** Eyebrow + citation + highlight color. */
  eyebrow: string
  /** Rule/divider/quote-mark color. */
  rule: string
  /** Highlighted-word color. */
  highlight: string
  highlightItalic: boolean
  /** Emphasized closing reflection line color. */
  closing: string
  grainMedia: number
  grainText: number
  vignetteMedia: string
  vignetteText: string
  /** Base media filter (before per-card brightness). */
  mediaBase: string
  /** Apply the teal-orange split-tone blend layers (teal → shadows via screen,
   *  orange → highlights via multiply). Manufactures teal-orange on any footage. */
  splitTone?: boolean
  /** Also grade the video card's clip with `mediaBase` (+ split-tone). By default
   *  the video card stays natural color; the graded filters opt in. */
  gradeVideoCard?: boolean
  /** Blob gradient layers for the questions card [A, B]. */
  blobs: [string, string]
}

export type DevotionalLayout = {
  id: DevotionalLayoutId
  label: string
  header: HeaderLayout
  /** Bottom-align the four text cards vs top/center. */
  textBottom: boolean
  /** Cover treatment. */
  cover: "centered" | "bottom" | "frosted"
  /** Scripture treatment. */
  scripture: "ruleLeft" | "quoteCenter" | "frostedBottom"
  /** Pull-quote decoration. */
  pullquote: "glyph" | "bars" | "barLeft"
  /** Reflection cards sit in a frosted rounded rectangle (blur behind text only). */
  panelFrost: boolean
}

/** Composed token object the components read — a filter merged with a layout. */
export type DevotionalStyle = DevotionalFilter &
  Omit<DevotionalLayout, "id" | "label"> & {
    /** The layout that was composed in (for debugging / labels). */
    layoutId: DevotionalLayoutId
  }

const GRAIN_BLOB_A =
  "radial-gradient(circle at 30% 28%, rgba(242,196,107,0.20) 0%, transparent 40%), radial-gradient(circle at 72% 68%, rgba(90,110,150,0.16) 0%, transparent 42%)"
const GRAIN_BLOB_B =
  "radial-gradient(circle at 66% 26%, rgba(90,110,150,0.16) 0%, transparent 38%), radial-gradient(circle at 24% 74%, rgba(242,196,107,0.20) 0%, transparent 40%)"
const BW_BLOB_A =
  "radial-gradient(circle at 30% 28%, rgba(255,255,255,0.12) 0%, transparent 40%), radial-gradient(circle at 72% 68%, rgba(170,175,190,0.10) 0%, transparent 42%)"
const BW_BLOB_B =
  "radial-gradient(circle at 66% 26%, rgba(170,175,190,0.10) 0%, transparent 38%), radial-gradient(circle at 24% 74%, rgba(255,255,255,0.12) 0%, transparent 40%)"
const SEPIA_BLOB_A =
  "radial-gradient(circle at 30% 28%, rgba(217,168,106,0.22) 0%, transparent 40%), radial-gradient(circle at 72% 68%, rgba(150,90,45,0.16) 0%, transparent 42%)"
const SEPIA_BLOB_B =
  "radial-gradient(circle at 66% 26%, rgba(150,90,45,0.16) 0%, transparent 38%), radial-gradient(circle at 24% 74%, rgba(217,168,106,0.22) 0%, transparent 40%)"

export const DEVOTIONAL_FILTERS: Record<DevotionalFilterId, DevotionalFilter> =
  {
    grain: {
      id: "grain",
      label: "Grain",
      textBg: "#14110c",
      mediaBg: "#14110c",
      body: "#ece9e4",
      heading: "#ffffff",
      secondary: "rgba(255,255,255,0.82)",
      eyebrow: "#f2c46b",
      rule: "#f2c46b",
      highlight: "#f2c46b",
      highlightItalic: true,
      closing: "#f2c46b",
      grainMedia: 0.72,
      grainText: 0.5,
      vignetteMedia: "inset 0 0 80px 18px rgba(0,0,0,0.5)",
      vignetteText: "inset 0 0 90px 24px rgba(0,0,0,0.4)",
      mediaBase: "",
      blobs: [GRAIN_BLOB_A, GRAIN_BLOB_B],
    },
    teal: {
      id: "teal",
      label: "Teal & orange",
      textBg: "#0b1013",
      mediaBg: "#0b1013",
      body: "#eae6df",
      heading: "#ffffff",
      secondary: "rgba(255,255,255,0.72)",
      eyebrow: "#e6a35c",
      rule: "#e6a35c",
      highlight: "#e6a35c",
      highlightItalic: false,
      closing: "#e6a35c",
      grainMedia: 0.22,
      grainText: 0.12,
      vignetteMedia: "inset 0 0 80px 18px rgba(0,0,0,0.5)",
      vignetteText: "inset 0 0 90px 24px rgba(0,0,0,0.55)",
      // Cinematic teal grade on the footage; warm orange accents contrast it.
      mediaBase: "saturate(1.3) contrast(1.12) hue-rotate(-6deg)",
      blobs: [BW_BLOB_A, BW_BLOB_B],
    },
    // True teal-orange split-tone, WARM base — oranges/skin stay lively over teal
    // shadows. The most colorful of the teal-orange pair.
    tealorange: {
      id: "tealorange",
      label: "Teal & orange (warm)",
      textBg: "#0b1013",
      mediaBg: "#0b1013",
      body: "#eae6df",
      heading: "#ffffff",
      secondary: "rgba(255,255,255,0.72)",
      eyebrow: "#e6a35c",
      rule: "#e6a35c",
      highlight: "#e6a35c",
      highlightItalic: false,
      closing: "#e6a35c",
      grainMedia: 0.22,
      grainText: 0.12,
      vignetteMedia: "inset 0 0 80px 18px rgba(0,0,0,0.5)",
      vignetteText: "inset 0 0 90px 24px rgba(0,0,0,0.55)",
      mediaBase: "saturate(0.82) contrast(1.15) brightness(1.1)",
      splitTone: true,
      gradeVideoCard: true,
      blobs: [BW_BLOB_A, BW_BLOB_B],
    },
    // True teal-orange split-tone, DESATURATED base — cleaner/cooler, more
    // restrained than `tealorange`.
    splittone: {
      id: "splittone",
      label: "Split-tone (clean)",
      textBg: "#0b1013",
      mediaBg: "#0b1013",
      body: "#eae6df",
      heading: "#ffffff",
      secondary: "rgba(255,255,255,0.72)",
      eyebrow: "#e6a35c",
      rule: "#e6a35c",
      highlight: "#e6a35c",
      highlightItalic: false,
      closing: "#e6a35c",
      grainMedia: 0.22,
      grainText: 0.12,
      vignetteMedia: "inset 0 0 80px 18px rgba(0,0,0,0.5)",
      vignetteText: "inset 0 0 90px 24px rgba(0,0,0,0.55)",
      mediaBase: "saturate(0.5) contrast(1.12) brightness(1.03)",
      splitTone: true,
      gradeVideoCard: true,
      blobs: [BW_BLOB_A, BW_BLOB_B],
    },
    sepia: {
      id: "sepia",
      label: "Sepia",
      textBg:
        "radial-gradient(circle at 50% 22%, #241a0e 0%, #120c06 60%, #0c0805 100%)",
      mediaBg: "#14110c",
      body: "#efe6d8",
      heading: "#ffffff",
      secondary: "rgba(255,255,255,0.82)",
      eyebrow: "#d9a86a",
      rule: "#d9a86a",
      highlight: "#d9a86a",
      highlightItalic: false,
      closing: "#d9a86a",
      grainMedia: 0.4,
      grainText: 0.32,
      vignetteMedia: "inset 0 0 80px 18px rgba(0,0,0,0.45)",
      vignetteText: "inset 0 0 90px 24px rgba(0,0,0,0.4)",
      mediaBase: "sepia(0.7) saturate(1.55) hue-rotate(-18deg) contrast(1.02)",
      blobs: [SEPIA_BLOB_A, SEPIA_BLOB_B],
    },
  }

export const DEVOTIONAL_LAYOUTS: Record<DevotionalLayoutId, DevotionalLayout> =
  {
    // Grain's original arrangement: centered title over a fully-blurred cover.
    centered: {
      id: "centered",
      label: "Centered",
      header: "centered",
      textBottom: false,
      cover: "centered",
      scripture: "ruleLeft",
      pullquote: "glyph",
      panelFrost: false,
    },
    // Teal's original arrangement: sharp image up top, text anchored to the
    // bottom, frosted reflection panels.
    editorial: {
      id: "editorial",
      label: "Editorial",
      header: "row",
      textBottom: false,
      cover: "bottom",
      scripture: "quoteCenter",
      pullquote: "bars",
      panelFrost: true,
    },
    // Editorial cover (sharp image up top) but the reflection/conclusion/questions
    // text is anchored BOTTOM-LEFT with no frost panel — a clean, grounded, docu
    // lower-block feel. Text sits over a bottom blur band for legibility.
    grounded: {
      id: "grounded",
      label: "Grounded",
      header: "row",
      textBottom: true,
      cover: "bottom",
      scripture: "quoteCenter",
      pullquote: "barLeft",
      panelFrost: false,
    },
    // Like `grounded` (editorial cover, bottom-anchored text) but the reflection
    // text sits INSIDE a frosted panel at the bottom — "bottom, on panel".
    "grounded-panel": {
      id: "grounded-panel",
      label: "Grounded (panel)",
      header: "row",
      textBottom: true,
      cover: "bottom",
      scripture: "quoteCenter",
      pullquote: "bars",
      panelFrost: true,
    },
    // Sepia's original arrangement: brand header, bottom-anchored text, frosted
    // cover.
    classic: {
      id: "classic",
      label: "Classic",
      header: "brand",
      textBottom: true,
      cover: "frosted",
      scripture: "quoteCenter",
      pullquote: "barLeft",
      panelFrost: false,
    },
  }

/** The layout each filter paired with before the split — used when no explicit
 *  layout is requested, so existing devotionals render unchanged. */
const NATIVE_LAYOUT: Record<DevotionalFilterId, DevotionalLayoutId> = {
  grain: "centered",
  tealorange: "editorial",
  splittone: "editorial",
  teal: "editorial",
  sepia: "classic",
}

/**
 * Compose a filter (color/grade) with a layout (arrangement) into the single
 * token object the components consume. `filterId` defaults to grain; `layoutId`
 * defaults to the filter's native pairing so old callers behave as before.
 */
export function resolveDevotionalStyle(
  filterId: string | undefined,
  layoutId?: string | undefined,
): DevotionalStyle {
  const filter =
    DEVOTIONAL_FILTERS[(filterId as DevotionalFilterId) ?? "grain"] ??
    DEVOTIONAL_FILTERS.grain
  const layout =
    DEVOTIONAL_LAYOUTS[layoutId as DevotionalLayoutId] ??
    DEVOTIONAL_LAYOUTS[NATIVE_LAYOUT[filter.id]]
  // Strip id + label via rest; the two bindings are intentionally unused.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { id: _lid, label: _llabel, ...layoutFields } = layout
  return { ...filter, ...layoutFields, layoutId: layout.id }
}
