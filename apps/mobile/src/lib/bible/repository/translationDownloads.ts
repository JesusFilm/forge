// Whole-translation downloads (feat-551 KTD4, R29, R30) through an injected
// port. The file splits once into book files, and the manifest goes last.
// The button's state comes from the manifest and the files, never a flag.
import { Directory, File, Paths } from "expo-file-system"

import type { CatalogTranslation } from "../data/catalog"
import { isUsfmBookId, type UsfmBookId } from "../text/books"
import { normalizeTranslation, parseBookText } from "../text/normalize"
import { BIBLE_TEXT_FORMAT_VERSION, type BookText } from "../text/types"
import { BSB_TRANSLATION_ID } from "../versification/classify"
import { BibleDownloadError, type DownloadFailureReason } from "./errors"
import { completeTranslationUrl } from "./fetchChapter"
import {
  deleteQuietly,
  ensureDirectory,
  isSafeTranslationId,
  isSha256,
  stagingDirectory,
  translationsDirectory,
} from "./storage"

/** The largest catalog file is 19 MB (mya_ojv, 2026-09-25). */
export const MAX_DOWNLOAD_BYTES = 32 * 1024 * 1024

/** The raw file and the book files exist together until the raw one goes. */
export const DOWNLOAD_SPACE_FACTOR = 2

export const DOWNLOAD_MANIFEST_VERSION = 1

const MANIFEST_NAME = "manifest.json"
const BOOKS_DIRECTORY = "books"
const BOOK_MEMO_SIZE = 2

export type DownloadProgress = { bytesWritten: number; totalBytes: number }

export type DownloadRequest = {
  url: string
  destinationUri: string
  signal: AbortSignal
  /** `totalBytes` is -1 when the server sends no length. */
  onProgress: (progress: DownloadProgress) => void
}

/** Resolves when the file is complete; rejects on a failure or an abort. */
export type DownloadPort = (request: DownloadRequest) => Promise<void>

export type TranslationDownloadState =
  /** BSB ships inside the app, so it is always on the device (R30). */
  | { kind: "bundled" }
  /** The first check of the manifests has not ended. */
  | { kind: "checking" }
  | { kind: "not-downloaded" }
  | {
      kind: "downloading"
      /** `install` splits the file into books after the transfer. */
      phase: "transfer" | "install"
      /** 0 to 100, for the button (R29). */
      percent: number
      bytesWritten: number
      totalBytes: number
    }
  | {
      kind: "downloaded"
      /** The catalog `sha256` at download time; a new one means an update. */
      sha256: string
      /** From the manifest: the books this download holds (R25). */
      books: ReadonlySet<UsfmBookId>
      bytes: number
    }
  /** The button offers a retry (R29). */
  | { kind: "failed"; reason: DownloadFailureReason }

export type DownloadOutcome =
  | { status: "downloaded" }
  | { status: "cancelled" }
  | { status: "bundled" }
  /** Only one download runs at a time. */
  | { status: "busy"; runningId: string }
  | { status: "failed"; reason: DownloadFailureReason }

export type TranslationDownloads = {
  /** A stable snapshot for `useSyncExternalStore`. */
  getState(translationId: string): TranslationDownloadState
  subscribe(listener: () => void): () => void
  /** Reads the manifests and the files once per session. */
  check(): Promise<void>
  /** Resolves when the download ends. A running download ignores screens. */
  start(translation: CatalogTranslation): Promise<DownloadOutcome>
  cancel(translationId: string): void
  remove(translationId: string): Promise<void>
  /** A downloaded book, or null when the download does not hold it. */
  readBook(translationId: string, bookId: UsfmBookId): Promise<BookText | null>
  runningId(): string | null
}

export type TranslationDownloadsOptions = {
  port: DownloadPort
  availableBytes?: () => number
  directory?: () => Directory
  staging?: () => Directory
  maxBytes?: number
}

type ManifestBook = { bookId: UsfmBookId; bytes: number }

type Manifest = {
  formatVersion: typeof DOWNLOAD_MANIFEST_VERSION
  textFormatVersion: typeof BIBLE_TEXT_FORMAT_VERSION
  translationId: string
  sha256: string
  /** From U1's result, not the catalog: the source can change (R25). */
  books: ManifestBook[]
}

type Run = {
  id: string
  controller: AbortController
  cancelled: boolean
  overCap: boolean
  phase: "transfer" | "install"
  percent: number
  bytesWritten: number
  totalBytes: number
}

const BUNDLED: TranslationDownloadState = { kind: "bundled" }
const CHECKING: TranslationDownloadState = { kind: "checking" }
const NOT_DOWNLOADED: TranslationDownloadState = { kind: "not-downloaded" }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function parseManifest(raw: unknown, translationId: string): Manifest | null {
  if (
    !isRecord(raw) ||
    raw.formatVersion !== DOWNLOAD_MANIFEST_VERSION ||
    raw.textFormatVersion !== BIBLE_TEXT_FORMAT_VERSION ||
    raw.translationId !== translationId ||
    typeof raw.sha256 !== "string" ||
    !isSha256(raw.sha256) ||
    !Array.isArray(raw.books) ||
    raw.books.length === 0
  ) {
    return null
  }
  const stored: readonly unknown[] = raw.books
  const books: ManifestBook[] = []
  const seen = new Set<string>()
  for (const item of stored) {
    if (!isRecord(item)) return null
    const { bookId, bytes } = item
    if (
      typeof bookId !== "string" ||
      !isUsfmBookId(bookId) ||
      seen.has(bookId) ||
      typeof bytes !== "number" ||
      !Number.isInteger(bytes) ||
      bytes <= 0
    ) {
      return null
    }
    seen.add(bookId)
    books.push({ bookId, bytes })
  }
  return {
    formatVersion: DOWNLOAD_MANIFEST_VERSION,
    textFormatVersion: BIBLE_TEXT_FORMAT_VERSION,
    translationId,
    sha256: raw.sha256,
    books,
  }
}

function bookFile(folder: Directory, bookId: UsfmBookId): File {
  return new File(folder, BOOKS_DIRECTORY, `${bookId}.json`)
}

/** A truncated or missing book file means the download is not complete. */
function filesMatch(folder: Directory, manifest: Manifest): boolean {
  return manifest.books.every(({ bookId, bytes }) => {
    const file = bookFile(folder, bookId)
    return file.exists && file.size === bytes
  })
}

export function createTranslationDownloads(
  options: TranslationDownloadsOptions,
): TranslationDownloads {
  const { port } = options
  const directory = options.directory ?? translationsDirectory
  const staging = options.staging ?? stagingDirectory
  const maxBytes = options.maxBytes ?? MAX_DOWNLOAD_BYTES
  const availableBytes =
    options.availableBytes ?? (() => Paths.availableDiskSpace)

  const verified = new Map<string, Manifest>()
  const failures = new Map<string, DownloadFailureReason>()
  const states = new Map<string, TranslationDownloadState>()
  const listeners = new Set<() => void>()
  const memo = new Map<string, BookText>()
  let scanned = false
  let scanning: Promise<void> | null = null
  let running: Run | null = null

  function derive(id: string): TranslationDownloadState {
    if (id === BSB_TRANSLATION_ID) return BUNDLED
    if (running?.id === id) {
      const { phase, percent, bytesWritten, totalBytes } = running
      return { kind: "downloading", phase, percent, bytesWritten, totalBytes }
    }
    const manifest = verified.get(id)
    if (manifest) {
      return {
        kind: "downloaded",
        sha256: manifest.sha256,
        books: new Set(manifest.books.map((book) => book.bookId)),
        bytes: manifest.books.reduce((sum, book) => sum + book.bytes, 0),
      }
    }
    const failure = failures.get(id)
    if (failure) return { kind: "failed", reason: failure }
    return scanned ? NOT_DOWNLOADED : CHECKING
  }

  function getState(id: string): TranslationDownloadState {
    let state = states.get(id)
    if (!state) {
      state = derive(id)
      states.set(id, state)
    }
    return state
  }

  function publish(id?: string): void {
    if (id === undefined) states.clear()
    else states.delete(id)
    for (const listener of [...listeners]) listener()
  }

  function forgetBooks(id: string): void {
    for (const key of [...memo.keys()]) {
      if (key.startsWith(`${id}/`)) memo.delete(key)
    }
  }

  function remember(key: string, book: BookText): void {
    memo.delete(key)
    memo.set(key, book)
    for (const oldest of memo.keys()) {
      if (memo.size <= BOOK_MEMO_SIZE) break
      memo.delete(oldest)
    }
  }

  async function readManifest(folder: Directory, id: string) {
    const file = new File(folder, MANIFEST_NAME)
    try {
      return parseManifest(JSON.parse(await file.text()), id)
    } catch {
      return null
    }
  }

  async function scan(): Promise<void> {
    try {
      const root = directory()
      if (root.exists) {
        for (const child of root.list()) {
          if (child instanceof File) {
            deleteQuietly(child)
            continue
          }
          const id = child.name
          if (running?.id === id) continue
          const manifest = await readManifest(child, id)
          if (manifest && filesMatch(child, manifest)) {
            verified.set(id, manifest)
          } else {
            // Book files with no complete manifest never count (KTD2).
            deleteQuietly(child)
          }
        }
      }
      const stage = staging()
      if (stage.exists) {
        for (const item of stage.list()) {
          if (running && item.name === `${running.id}.json`) continue
          deleteQuietly(item)
        }
      }
    } catch {
      // An unreadable directory reads as nothing downloaded.
    }
    scanned = true
    publish()
  }

  function check(): Promise<void> {
    if (scanned) return Promise.resolve()
    scanning ??= scan()
    return scanning
  }

  function freeBytes(): number | null {
    try {
      const free = availableBytes()
      return Number.isFinite(free) ? free : null
    } catch {
      return null
    }
  }

  function refusalFor(
    translation: CatalogTranslation,
  ): DownloadFailureReason | null {
    if (!isSafeTranslationId(translation.id) || !isSha256(translation.sha256)) {
      return "invalid-data"
    }
    if (translation.downloadBytes > maxBytes) return "too-large"
    const free = freeBytes()
    // An unknown free space does not block; a full disk fails the write.
    if (
      free !== null &&
      free < translation.downloadBytes * DOWNLOAD_SPACE_FACTOR
    ) {
      return "no-space"
    }
    return null
  }

  function onProgress(
    run: Run,
    translation: CatalogTranslation,
    { bytesWritten, totalBytes }: DownloadProgress,
  ): void {
    if (running !== run || run.controller.signal.aborted) return
    if (bytesWritten > maxBytes || totalBytes > maxBytes) {
      run.overCap = true
      run.controller.abort()
      return
    }
    const total = totalBytes > 0 ? totalBytes : translation.downloadBytes
    const percent = Math.max(
      0,
      Math.min(100, Math.floor((bytesWritten / total) * 100)),
    )
    run.bytesWritten = bytesWritten
    run.totalBytes = total
    if (percent !== run.percent) {
      run.percent = percent
      publish(run.id)
    }
  }

  function stoppedReason(run: Run): DownloadFailureReason {
    return run.overCap ? "too-large" : "network"
  }

  async function transfer(
    run: Run,
    translation: CatalogTranslation,
    raw: File,
  ): Promise<void> {
    if (!ensureDirectory(staging())) {
      throw new BibleDownloadError("write-failed")
    }
    deleteQuietly(raw)
    try {
      await port({
        url: completeTranslationUrl(translation.id),
        destinationUri: raw.uri,
        signal: run.controller.signal,
        onProgress: (progress) => onProgress(run, translation, progress),
      })
    } catch {
      throw new BibleDownloadError(stoppedReason(run))
    }
    if (run.controller.signal.aborted) {
      throw new BibleDownloadError(stoppedReason(run))
    }
    if (!raw.exists) throw new BibleDownloadError("network")
    if (raw.size > maxBytes) throw new BibleDownloadError("too-large")
  }

  function writeBooks(
    id: string,
    sha256: string,
    books: readonly BookText[],
  ): Manifest {
    const folder = new Directory(directory(), id)
    // The old copy stops counting before any of its files change.
    verified.delete(id)
    forgetBooks(id)
    deleteQuietly(new File(folder, MANIFEST_NAME))
    deleteQuietly(folder)
    try {
      if (!ensureDirectory(new Directory(folder, BOOKS_DIRECTORY))) {
        throw new BibleDownloadError("write-failed")
      }
      const entries: ManifestBook[] = []
      for (const book of books) {
        const file = bookFile(folder, book.bookId)
        file.write(JSON.stringify(book))
        entries.push({ bookId: book.bookId, bytes: file.size })
      }
      const manifest: Manifest = {
        formatVersion: DOWNLOAD_MANIFEST_VERSION,
        textFormatVersion: BIBLE_TEXT_FORMAT_VERSION,
        translationId: id,
        sha256,
        books: entries,
      }
      // Last: until this file exists, the book files are not a download.
      new File(folder, MANIFEST_NAME).write(JSON.stringify(manifest))
      return manifest
    } catch {
      deleteQuietly(folder)
      throw new BibleDownloadError("write-failed")
    }
  }

  async function install(
    run: Run,
    translation: CatalogTranslation,
    raw: File,
  ): Promise<void> {
    run.phase = "install"
    run.percent = 100
    publish(run.id)
    let text: string
    try {
      text = await raw.text()
    } catch {
      throw new BibleDownloadError("write-failed")
    }
    if (run.controller.signal.aborted) {
      throw new BibleDownloadError("network")
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      throw new BibleDownloadError("invalid-data")
    }
    const normalized = normalizeTranslation(parsed)
    if (
      normalized.status !== "ok" ||
      normalized.value.translationId !== translation.id
    ) {
      throw new BibleDownloadError("invalid-data")
    }
    const manifest = writeBooks(
      translation.id,
      translation.sha256,
      normalized.value.books,
    )
    verified.set(translation.id, manifest)
  }

  async function start(
    translation: CatalogTranslation,
  ): Promise<DownloadOutcome> {
    const { id } = translation
    if (id === BSB_TRANSLATION_ID) return { status: "bundled" }
    await check()
    // No await from here to the claim, so two taps cannot both start.
    if (running) return { status: "busy", runningId: running.id }
    const refusal = refusalFor(translation)
    if (refusal) {
      failures.set(id, refusal)
      publish(id)
      return { status: "failed", reason: refusal }
    }
    const run: Run = {
      id,
      controller: new AbortController(),
      cancelled: false,
      overCap: false,
      phase: "transfer",
      percent: 0,
      bytesWritten: 0,
      totalBytes: translation.downloadBytes,
    }
    running = run
    failures.delete(id)
    publish(id)

    const raw = new File(staging(), `${id}.json`)
    let outcome: DownloadOutcome
    try {
      await transfer(run, translation, raw)
      await install(run, translation, raw)
      outcome = { status: "downloaded" }
    } catch (error) {
      if (run.cancelled) {
        outcome = { status: "cancelled" }
      } else {
        const reason =
          error instanceof BibleDownloadError
            ? error.reason
            : stoppedReason(run)
        failures.set(id, reason)
        outcome = { status: "failed", reason }
      }
    } finally {
      // A stopped transfer can leave a partial file (Android).
      deleteQuietly(raw)
      running = null
      publish(id)
    }
    return outcome
  }

  function cancel(id: string): void {
    if (running?.id !== id) return
    running.cancelled = true
    running.controller.abort()
  }

  async function remove(id: string): Promise<void> {
    if (running?.id === id) {
      cancel(id)
      return
    }
    await check()
    if (!isSafeTranslationId(id)) return
    const folder = new Directory(directory(), id)
    // The manifest goes first, so a partial delete never reads as downloaded.
    deleteQuietly(new File(folder, MANIFEST_NAME))
    deleteQuietly(folder)
    verified.delete(id)
    failures.delete(id)
    forgetBooks(id)
    publish(id)
  }

  async function readBook(
    id: string,
    bookId: UsfmBookId,
  ): Promise<BookText | null> {
    if (!isSafeTranslationId(id)) return null
    await check()
    const manifest = verified.get(id)
    if (!manifest?.books.some((book) => book.bookId === bookId)) return null
    const key = `${id}/${bookId}`
    const known = memo.get(key)
    if (known) {
      remember(key, known)
      return known
    }
    try {
      const file = bookFile(new Directory(directory(), id), bookId)
      const parsed = parseBookText(JSON.parse(await file.text()))
      // A remove or a new download during the read makes this copy old.
      if (
        verified.get(id) !== manifest ||
        parsed.status !== "ok" ||
        parsed.value.translationId !== id ||
        parsed.value.bookId !== bookId
      ) {
        return null
      }
      remember(key, parsed.value)
      return parsed.value
    } catch {
      return null
    }
  }

  return {
    getState,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    check,
    start,
    cancel,
    remove,
    readBook,
    runningId: () => running?.id ?? null,
  }
}
