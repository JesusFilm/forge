// The composition root of the Bible text repository (feat-551 U4), as
// rawExportRuntime.ts is for raw export. The getters build both singletons on
// first use, so an import does no file or network work.
import { File } from "expo-file-system"

import { loadBundledBook } from "../data/bundled"
import { createChapterCache } from "./chapterCache"
import { fetchChapter } from "./fetchChapter"
import {
  createChapterRepository,
  type ChapterRepository,
} from "./resolveChapter"
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

/** One store for the app, so one download at a time holds on every screen. */
export function getTranslationDownloads(): TranslationDownloads {
  downloads ??= createTranslationDownloads({ port: fileSystemDownloadPort })
  return downloads
}

export function getChapterRepository(): ChapterRepository {
  repository ??= createChapterRepository({
    loadBundledBook,
    downloads: getTranslationDownloads(),
    cache: createChapterCache(),
    fetchChapter: (address) => fetchChapter(address),
  })
  return repository
}

/** Test-only: drop both singletons so a suite builds fresh ones. */
export function resetBibleRepositoryForTests(): void {
  downloads = null
  repository = null
}
