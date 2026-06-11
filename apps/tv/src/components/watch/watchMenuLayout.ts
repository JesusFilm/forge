// React-free layout tokens for the watch menus' virtualized lists. These
// numbers are LOAD-BEARING: getItemLayout in LanguagePanel/InPlayerMenu
// computes scroll offsets from them, so any drift between the constants and
// the rendered row/heading styles silently mispositions initialScrollIndex
// over a 2,259-dub list. Kept in a React-free .ts so the arithmetic is
// unit-testable (jest-expo can't load React-importing modules) and so the
// style module (watchMenuStyles) and component (WatchOptionRow) both depend
// on tokens rather than on each other.

import { scale } from "../../lib/scale"

/** WatchOptionRow vertical padding (each side). */
export const ROW_VERTICAL_PADDING = scale(16)

/** Pinned lineHeight for every text child of a WatchOptionRow (single-line). */
export const ROW_LINE_HEIGHT = Math.round(scale(32))

/** Exact rendered height of one WatchOptionRow (fixed `height` style). */
export const WATCH_OPTION_ROW_HEIGHT =
  ROW_VERTICAL_PADDING * 2 + ROW_LINE_HEIGHT

/**
 * Fixed height of a heading block rendered INSIDE a menu FlatList
 * (ListHeader/ListFooter headings in InPlayerMenu). Must equal the
 * headingBox style height exactly — getItemLayout adds it to row offsets.
 */
export const MENU_HEADING_HEIGHT = scale(64)

/** Rows visible in a menu list viewport (list maxHeight = rows * height). */
export const MENU_LIST_VISIBLE_ROWS = 9
