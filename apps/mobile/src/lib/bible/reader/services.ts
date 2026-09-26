// What the reader reads and writes (feat-553). Production uses the app's
// singletons; a test passes fakes, so no suite needs a native module.
import { loadBundledCatalog, type BundledResult } from "../data/bundled"
import type { Catalog } from "../data/catalog"
import { readPhoneLanguageCode } from "../language/phoneLanguage"
import {
  getReadingPositionStore,
  type ReadingPositionStore,
} from "../position/store"
import {
  getChapterRepository,
  getTranslationDownloads,
} from "../repository/downloadRuntime"
import type { ChapterRepository } from "../repository/resolveChapter"
import type { TranslationDownloads } from "../repository/translationDownloads"
import {
  getReaderSettingsStore,
  type ReaderSettingsStore,
} from "../settings/store"

export type ReaderServices = {
  repository: Pick<
    ChapterRepository,
    "createView" | "prefetch" | "isOnDevice" | "translationHasBook"
  >
  downloads: Pick<TranslationDownloads, "getState" | "subscribe" | "check">
  /** Never rejects. */
  loadCatalog: () => Promise<BundledResult<Catalog>>
  positionStore: ReadingPositionStore
  settingsStore: ReaderSettingsStore
  readPhoneLanguage: () => string | null
}

let catalogFlight: Promise<BundledResult<Catalog>> | null = null

/** The bundled catalog, read once. A failed read clears, so a retry reads. */
export function loadReaderCatalog(
  load: () => Promise<BundledResult<Catalog>> = loadBundledCatalog,
): Promise<BundledResult<Catalog>> {
  if (catalogFlight) return catalogFlight
  const flight = load().catch(
    (): BundledResult<Catalog> => ({ status: "failed", reason: "read-failed" }),
  )
  catalogFlight = flight
  // Identity check: a retry that started later keeps its own flight.
  void flight.then((result) => {
    if (result.status !== "ok" && catalogFlight === flight) catalogFlight = null
  })
  return flight
}

let services: ReaderServices | null = null

export function getReaderServices(): ReaderServices {
  services ??= {
    repository: getChapterRepository(),
    downloads: getTranslationDownloads(),
    loadCatalog: () => loadReaderCatalog(),
    positionStore: getReadingPositionStore(),
    settingsStore: getReaderSettingsStore(),
    readPhoneLanguage: readPhoneLanguageCode,
  }
  return services
}

/** Test-only: drop the memoized catalog and the services. */
export function resetReaderServicesForTests(): void {
  catalogFlight = null
  services = null
}
