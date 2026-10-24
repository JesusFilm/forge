// The native options of the reader's three sheet routes (feat-553 KTD9).
// They match the watch group's list sheets, because each sheet sizes its
// content from LIST_SHEET_DETENTS (useSheetListHeight).
import { LIST_SHEET_DETENTS } from "../../../styles/shared"
import { formSheetBaseOptions } from "../../sheetOptions"

// Off: the first scroll at the small detent must scroll, not grow the sheet.
export const READER_SHEET_SCREEN_OPTIONS = {
  ...formSheetBaseOptions(),
  sheetAllowedDetents: [...LIST_SHEET_DETENTS],
  sheetExpandsWhenScrolledToEdge: false,
}
