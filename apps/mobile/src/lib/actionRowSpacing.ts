// Spacing model for the watch-page action row's Download/Share group. The
// icons keep the roomy layout and compress SCALARLY — in proportion to how
// far the dub/subtitle names outgrow the roomy column — down to a compact
// floor (user request, 2026-08-18).

/** Spacer widths (pt) around the two 34pt icon buttons at the two extremes. */
export const ACTION_ROW_SPACERS = {
  roomy: { dividerIcon: 21, betweenIcons: 16, iconEdge: 13 },
  compact: { dividerIcon: 8, betweenIcons: 0, iconEdge: 0 },
} as const

export type ActionRowSpacerWidths = {
  dividerIcon: number
  betweenIcons: number
  iconEdge: number
}

/** Divider marginLeft (16) + divider width (1). */
export const ACTION_ROW_DIVIDER_BLOCK = 17
/** Two 34pt icon buttons. */
export const ACTION_ROW_ICONS_WIDTH = 68
/** The languages container's columnGap between the two pills. */
export const ACTION_ROW_PILL_GAP = 8

function clusterWidth(s: ActionRowSpacerWidths): number {
  return (
    ACTION_ROW_DIVIDER_BLOCK +
    s.dividerIcon +
    ACTION_ROW_ICONS_WIDTH +
    s.betweenIcons +
    s.iconEdge
  )
}

// Total whitespace the cluster can release (42pt with the shipped extremes).
const MAX_RELEASE =
  clusterWidth(ACTION_ROW_SPACERS.roomy) -
  clusterWidth(ACTION_ROW_SPACERS.compact)

/**
 * Continuous spacer widths from measured pill widths. The deficit is how many
 * points the pills can actually USE beyond the roomy column: a clamped name
 * uses up to its natural width; the two pills use exactly the width that lets
 * them share one line (only when full compression could achieve it). The
 * cluster releases whitespace equal to the deficit — each gap interpolating
 * linearly toward the compact floor — and saturates at the floor. Two short
 * pills that wrap either way have no deficit and keep the roomy layout.
 * Null measurements (pre-layout) default to roomy.
 */
export function actionRowSpacerWidths(m: {
  /** Row width minus the row's own horizontal padding. */
  rowInnerWidth: number | null
  /** Natural (unclamped) width of the language pill. */
  langNatural: number | null
  /** Natural (unclamped) width of the subtitle pill. */
  subNatural: number | null
}): ActionRowSpacerWidths {
  const roomy = ACTION_ROW_SPACERS.roomy
  const compact = ACTION_ROW_SPACERS.compact
  const { rowInnerWidth, langNatural, subNatural } = m
  if (rowInnerWidth == null || langNatural == null || subNatural == null) {
    return { ...roomy }
  }
  const roomyColumn = rowInnerWidth - clusterWidth(roomy)
  const compactColumn = rowInnerWidth - clusterWidth(compact)
  const maxPill = Math.max(langNatural, subNatural)
  const oneLine = langNatural + ACTION_ROW_PILL_GAP + subNatural
  const clampDeficit = maxPill - roomyColumn
  const unwrapDeficit =
    oneLine > roomyColumn && oneLine <= compactColumn
      ? oneLine - roomyColumn
      : 0
  const deficit = Math.max(0, clampDeficit, unwrapDeficit)
  const t = Math.min(1, deficit / MAX_RELEASE)
  return {
    dividerIcon:
      roomy.dividerIcon - t * (roomy.dividerIcon - compact.dividerIcon),
    betweenIcons:
      roomy.betweenIcons - t * (roomy.betweenIcons - compact.betweenIcons),
    iconEdge: roomy.iconEdge - t * (roomy.iconEdge - compact.iconEdge),
  }
}
