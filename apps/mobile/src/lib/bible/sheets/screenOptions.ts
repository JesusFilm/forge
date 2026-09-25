// The native options of the reader's three sheet routes (feat-551 KTD9).
// They match the watch group's list sheets, because each sheet sizes its
// content from LIST_SHEET_DETENTS (useSheetListHeight).
import { LIST_SHEET_DETENTS } from "../../../styles/shared"

const SHEET_BASE_OPTIONS = {
  headerShown: false,
  presentation: "formSheet",
  sheetInitialDetentIndex: 0,
  sheetGrabberVisible: true,
  sheetCornerRadius: 16,
} as const

// Off: the first scroll at the small detent must scroll, not grow the sheet.
export const READER_SHEET_SCREEN_OPTIONS = {
  ...SHEET_BASE_OPTIONS,
  sheetAllowedDetents: [...LIST_SHEET_DETENTS],
  sheetExpandsWhenScrolledToEdge: false,
}
