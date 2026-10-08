// The quote card's services are the reader's own singletons (KTD10), so a
// card read shares the reader's flights and fills its kept-chapter cache.
import { readPhoneLanguageCode } from "../language/phoneLanguage"
import { getReadingPositionStore } from "../position/store"
import {
  getChapterRepository,
  getTranslationDownloads,
} from "../repository/downloadRuntime"
import { loadReaderCatalog } from "../reader/services"
import type { CardQuoteServices } from "./cardQuote"

let services: CardQuoteServices | null = null

export function getCardQuoteServices(): CardQuoteServices {
  services ??= {
    repository: getChapterRepository(),
    downloads: getTranslationDownloads(),
    loadCatalog: () => loadReaderCatalog(),
    positionStore: getReadingPositionStore(),
    readPhoneLanguage: readPhoneLanguageCode,
  }
  return services
}
