import { z } from "zod"

/** Immutable render contract; labels, palettes, grades, and pairings are data. */
export const DEVOTIONAL_FILTER_IDS = [
  "grain",
  "tealorange",
  "splittone",
  "teal",
  "sepia",
] as const
export type DevotionalFilterId = (typeof DEVOTIONAL_FILTER_IDS)[number]

export const DEVOTIONAL_LAYOUT_IDS = [
  "centered",
  "editorial",
  "classic",
  "grounded",
  "grounded-panel",
] as const
export type DevotionalLayoutId = (typeof DEVOTIONAL_LAYOUT_IDS)[number]

export const DEVOTIONAL_STYLE_IDS = DEVOTIONAL_FILTER_IDS
export type DevotionalStyleId = DevotionalFilterId
export type HeaderLayout = "centered" | "row" | "brand"

export const devotionalFilterSchema = z
  .object({
    id: z.enum(DEVOTIONAL_FILTER_IDS),
    label: z.string().trim().min(1).max(160),
    textBg: z.string().trim().min(1).max(2_000),
    mediaBg: z.string().trim().min(1).max(2_000),
    body: z.string().trim().min(1).max(500),
    heading: z.string().trim().min(1).max(500),
    secondary: z.string().trim().min(1).max(500),
    eyebrow: z.string().trim().min(1).max(500),
    rule: z.string().trim().min(1).max(500),
    highlight: z.string().trim().min(1).max(500),
    highlightItalic: z.boolean(),
    closing: z.string().trim().min(1).max(500),
    grainMedia: z.number().min(0).max(1),
    grainText: z.number().min(0).max(1),
    vignetteMedia: z.string().max(2_000),
    vignetteText: z.string().max(2_000),
    mediaBase: z.string().max(2_000),
    splitTone: z.boolean().optional(),
    gradeVideoCard: z.boolean().optional(),
    blobs: z.tuple([
      z.string().trim().min(1).max(4_000),
      z.string().trim().min(1).max(4_000),
    ]),
  })
  .strict()

export const devotionalLayoutSchema = z
  .object({
    id: z.enum(DEVOTIONAL_LAYOUT_IDS),
    label: z.string().trim().min(1).max(160),
    header: z.enum(["centered", "row", "brand"]),
    textBottom: z.boolean(),
    cover: z.enum(["centered", "bottom", "frosted"]),
    scripture: z.enum(["ruleLeft", "quoteCenter", "frostedBottom"]),
    pullquote: z.enum(["glyph", "bars", "barLeft"]),
    panelFrost: z.boolean(),
  })
  .strict()

export const devotionalRenderConfigSchema = z
  .object({
    filters: z.record(z.enum(DEVOTIONAL_FILTER_IDS), devotionalFilterSchema),
    layouts: z.record(z.enum(DEVOTIONAL_LAYOUT_IDS), devotionalLayoutSchema),
    nativeLayouts: z.record(
      z.enum(DEVOTIONAL_FILTER_IDS),
      z.enum(DEVOTIONAL_LAYOUT_IDS),
    ),
  })
  .strict()
  .superRefine((config, context) => {
    for (const filterId of DEVOTIONAL_FILTER_IDS) {
      if (config.filters[filterId]?.id !== filterId) {
        context.addIssue({
          code: "custom",
          path: ["filters", filterId, "id"],
          message: "filter key must match filter id",
        })
      }
    }
    for (const layoutId of DEVOTIONAL_LAYOUT_IDS) {
      if (config.layouts[layoutId]?.id !== layoutId) {
        context.addIssue({
          code: "custom",
          path: ["layouts", layoutId, "id"],
          message: "layout key must match layout id",
        })
      }
    }
  })

export type DevotionalFilter = z.infer<typeof devotionalFilterSchema>
export type DevotionalLayout = z.infer<typeof devotionalLayoutSchema>
export type DevotionalRenderConfig = z.infer<
  typeof devotionalRenderConfigSchema
>

export type DevotionalStyle = DevotionalFilter &
  Omit<DevotionalLayout, "id" | "label"> & {
    layoutId: DevotionalLayoutId
  }

/** Resolve only from already validated Workspace render configuration. */
export function resolveDevotionalStyle(
  filterId: string | undefined,
  layoutId: string | undefined,
  renderConfig?: DevotionalRenderConfig,
): DevotionalStyle {
  if (!renderConfig) {
    throw new Error(
      "/inputs/render/styles.json: render configuration is required",
    )
  }
  const selectedFilter = filterId ?? "grain"
  const filterResult = z.enum(DEVOTIONAL_FILTER_IDS).safeParse(selectedFilter)
  if (!filterResult.success) {
    throw new Error(`unknown devotional filter: ${selectedFilter}`)
  }
  const filter = renderConfig.filters[filterResult.data]
  const selectedLayout = layoutId ?? renderConfig.nativeLayouts[filter.id]
  const layoutResult = z.enum(DEVOTIONAL_LAYOUT_IDS).safeParse(selectedLayout)
  if (!layoutResult.success) {
    throw new Error(`unknown devotional layout: ${selectedLayout}`)
  }
  const layout = renderConfig.layouts[layoutResult.data]
  const layoutFields: Omit<DevotionalLayout, "id" | "label"> = {
    header: layout.header,
    textBottom: layout.textBottom,
    cover: layout.cover,
    scripture: layout.scripture,
    pullquote: layout.pullquote,
    panelFrost: layout.panelFrost,
  }
  return { ...filter, ...layoutFields, layoutId: layout.id }
}
