// The reader controls that open a sheet or the download prompt (feat-551 U10,
// U11). Both reader hosts pass these to BibleReader, so the Bible tab and the
// pushed reader open the same sheets with the same params.
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
  onOpenDownload: (context: ReaderControlContext) => void
}

export type ReaderSheetCallbackDeps = {
  presentDownload?: (context: ReaderControlContext) => Promise<void>
}

export function readerSheetCallbacks(
  router: { push: (href: Href) => void },
  deps: ReaderSheetCallbackDeps = {},
): ReaderSheetCallbacks {
  const presentDownload = deps.presentDownload ?? presentReaderDownloadPrompt
  return {
    onOpenPassagePicker: (context) =>
      router.push(readerSheetHref("passage", context)),
    onOpenTranslationPicker: (context) =>
      router.push(readerSheetHref("translation", context)),
    onOpenSettings: (context) =>
      router.push(readerSheetHref("settings", context)),
    // A tap handler has no caller to take a rejection.
    onOpenDownload: (context) => {
      void presentDownload(context).catch(() => undefined)
    },
  }
}
