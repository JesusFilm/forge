// The composition root of the Bible text repository (feat-553 U4), as
// rawExportRuntime.ts is for raw export. The getters build both singletons on
// first use, so an import does no file or network work.
import { File } from "expo-file-system"

import { loadBundledBook } from "../data/bundled"
import { withFetchFailureReport } from "../telemetry"
import {
  bookNamesFromBooks,
  createBookNamesStore,
  fetchBookNames,
  type BookNamesStore,
} from "./bookNames"
import { createChapterCache } from "./chapterCache"
import { fetchChapter } from "./fetchChapter"
import {
  createChapterRepository,
  type ChapterRepository,
} from "./resolveChapter"
import {
  bookNamesDirectory,
  ensureDirectory,
  isSafeTranslationId,
} from "./storage"
import {
  createTranslationDownloads,
  type DownloadPort,
  type TranslationDownloads,
} from "./translationDownloads"

/** The one binding to File.downloadFileAsync. The store deletes partial files. */
export const fileSystemDownloadPort: DownloadPort = async ({
  url,
  destinationUri,
  signal,
  onProgress,
}) => {
  await File.downloadFileAsync(url, new File(destinationUri), {
    idempotent: true,
    signal,
    onProgress,
  })
}

let downloads: TranslationDownloads | null = null
let repository: ChapterRepository | null = null
let bookNames: BookNamesStore | null = null

function bookNamesFile(translationId: string): File | null {
  return isSafeTranslationId(translationId)
    ? new File(bookNamesDirectory(), `${translationId}.json`)
    : null
}

/** One store for the app, so the reader's read serves the picker too. */
export function getBookNamesStore(): BookNamesStore {
  bookNames ??= createBookNamesStore({
    fetchNames: (id) => fetchBookNames(id),
    async readStored(id) {
      const file = bookNamesFile(id)
      try {
        return file?.exists ? JSON.parse(await file.text()) : null
      } catch {
        return null
      }
    },
    writeStored(id, text) {
      const file = bookNamesFile(id)
      if (file && ensureDirectory(bookNamesDirectory())) file.write(text)
    },
  })
  return bookNames
}

/** One store for the app, so one download at a time holds on every screen. */
export function getTranslationDownloads(): TranslationDownloads {
  downloads ??= createTranslationDownloads({
    port: fileSystemDownloadPort,
    // A download names its own books, so the picker needs no network for it.
    onInstalled(translation, books) {
      const names = bookNamesFromBooks(books)
      if (names) getBookNamesStore().keep(translation, names)
    },
  })
  return downloads
}

export function getChapterRepository(): ChapterRepository {
  repository ??= createChapterRepository({
    loadBundledBook,
    downloads: getTranslationDownloads(),
    cache: createChapterCache(),
    // R37: each failed network fetch logs once; both hosts share one fetch.
    fetchChapter: withFetchFailureReport((address) => fetchChapter(address)),
  })
  return repository
}

/** Test-only: drop the singletons so a suite builds fresh ones. */
export function resetBibleRepositoryForTests(): void {
  downloads = null
  repository = null
  bookNames = null
}
