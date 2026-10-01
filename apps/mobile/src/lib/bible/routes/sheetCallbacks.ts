// The reader controls that open a sheet (feat-553 U10, U11). Both reader hosts
// pass these to BibleReader, so the Bible tab and the pushed reader open the
// same sheets with the same params. The download prompt opens from the
// translation sheet's Current card (owner, 2026-10-01).
import type { Href } from "expo-router"

import type { CatalogTranslation } from "../data/catalog"
import { presentReaderDownloadPrompt } from "../sheets/downloadPrompt"
import { readerSheetHref, type ReaderSheetContext } from "../sheets/routes"

/** What a reader control sends (BibleReader's `ReaderRouteContext`). */
export type ReaderControlContext = ReaderSheetContext & {
  translation: CatalogTranslation | null
}

export type ReaderSheetCallbacks = {
  onOpenPassagePicker: (context: ReaderControlContext) => void
  onOpenTranslationPicker: (context: ReaderControlContext) => void
  onOpenSettings: (context: ReaderControlContext) => void
}

export function readerSheetCallbacks(router: {
  push: (href: Href) => void
}): ReaderSheetCallbacks {
  return {
    onOpenPassagePicker: (context) =>
      router.push(readerSheetHref("passage", context)),
    onOpenTranslationPicker: (context) =>
      router.push(readerSheetHref("translation", context)),
    onOpenSettings: (context) =>
      router.push(readerSheetHref("settings", context)),
  }
}

export type TranslationDownloadDeps = {
  presentDownload?: (context: {
    translation: CatalogTranslation
  }) => Promise<void>
}

/** The Current card's download button (R29, R30): the prompt for its
 *  translation. A tap handler has no caller to take a rejection. */
export function openTranslationDownload(
  translation: CatalogTranslation,
  deps: TranslationDownloadDeps = {},
): void {
  const present = deps.presentDownload ?? presentReaderDownloadPrompt
  void present({ translation }).catch(() => undefined)
}
