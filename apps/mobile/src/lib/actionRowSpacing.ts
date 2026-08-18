// Spacing model for the watch-page action row's Download/Share group. The
// icons keep the roomy layout until a dub/subtitle name benefits from the
// width, then compress to the compact floor (user request, 2026-08-18).

/** Spacer widths (pt) around the two 34pt icon buttons, per mode. */
export const ACTION_ROW_SPACERS = {
  roomy: { dividerIcon: 21, betweenIcons: 16, iconEdge: 13 },
  compact: { dividerIcon: 8, betweenIcons: 0, iconEdge: 0 },
} as const

export type ActionRowSpacingMode = keyof typeof ACTION_ROW_SPACERS

/** Divider marginLeft (16) + divider width (1). */
export const ACTION_ROW_DIVIDER_BLOCK = 17
/** Two 34pt icon buttons. */
export const ACTION_ROW_ICONS_WIDTH = 68
/** The languages container's columnGap between the two pills. */
export const ACTION_ROW_PILL_GAP = 8

function clusterWidth(mode: ActionRowSpacingMode): number {
  const s = ACTION_ROW_SPACERS[mode]
  return (
    ACTION_ROW_DIVIDER_BLOCK +
    s.dividerIcon +
    ACTION_ROW_ICONS_WIDTH +
    s.betweenIcons +
    s.iconEdge
  )
}

/**
 * Decide the icon-group spacing from measured pill widths. Compact ONLY when
 * it buys the pills something: a clamped/ellipsized name gains characters, or
 * the two pills fit on one line where roomy spacing would wrap them. Two
 * short pills that wrap either way stay roomy — compression buys nothing.
 * Null measurements (pre-layout) default to roomy.
 */
export function actionRowSpacingMode(m: {
  /** Row width minus the row's own horizontal padding. */
  rowInnerWidth: number | null
  /** Natural (unclamped) width of the language pill. */
  langNatural: number | null
  /** Natural (unclamped) width of the subtitle pill. */
  subNatural: number | null
}): ActionRowSpacingMode {
  const { rowInnerWidth, langNatural, subNatural } = m
  if (rowInnerWidth == null || langNatural == null || subNatural == null) {
    return "roomy"
  }
  const roomyColumn = rowInnerWidth - clusterWidth("roomy")
  const compactColumn = rowInnerWidth - clusterWidth("compact")
  const maxPill = Math.max(langNatural, subNatural)
  const oneLine = langNatural + ACTION_ROW_PILL_GAP + subNatural
  if (maxPill > roomyColumn) return "compact"
  if (oneLine > roomyColumn && oneLine <= compactColumn) return "compact"
  return "roomy"
}
