// The quote card's services are the reader's own singletons (KTD10), so a
// card read shares the reader's flights and fills its kept-chapter cache.
import { readPhoneLanguageCode } from "../language/phoneLanguage"
import {
  getReadingPositionStore,
  type ReadingPositionStore,
} from "../position/store"
import {
  getChapterRepository,
  getTranslationDownloads,
} from "../repository/downloadRuntime"
import { loadReaderCatalog } from "../reader/services"
import type { CardQuoteServices } from "./cardQuote"

/** The module's services, plus the pick subscription the hook reads (KTD11). */
export type CardQuoteRuntime = CardQuoteServices & {
  positionStore: Pick<ReadingPositionStore, "subscribe">
}

let services: CardQuoteRuntime | null = null

export function getCardQuoteServices(): CardQuoteRuntime {
  services ??= {
    repository: getChapterRepository(),
    downloads: getTranslationDownloads(),
    loadCatalog: () => loadReaderCatalog(),
    positionStore: getReadingPositionStore(),
    readPhoneLanguage: readPhoneLanguageCode,
  }
  return services
}
