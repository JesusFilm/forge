// LOAD-BEARING layout tokens for the watch menus' lists: getItemLayout computes
// scroll offsets from them, so drift vs the rendered row/heading styles silently
// mispositions initialScrollIndex over a 2,259-dub list. React-free so the
// arithmetic is unit-testable and styles/component depend on tokens, not each other.

import { scale } from "../../lib/scale"

/** WatchOptionRow vertical padding (each side). */
export const ROW_VERTICAL_PADDING = scale(16)

/** Pinned lineHeight for every text child of a WatchOptionRow (single-line). */
export const ROW_LINE_HEIGHT = Math.round(scale(32))

/** Exact rendered height of one WatchOptionRow (fixed `height` style). */
export const WATCH_OPTION_ROW_HEIGHT =
  ROW_VERTICAL_PADDING * 2 + ROW_LINE_HEIGHT

/**
 * Fixed height of a heading block rendered INSIDE a menu FlatList. Must equal the
 * headingBox style height exactly — getItemLayout adds it to row offsets.
 */
export const MENU_HEADING_HEIGHT = scale(64)

/** Rows visible in a menu list viewport (list maxHeight = rows * height). */
export const MENU_LIST_VISIBLE_ROWS = 9
