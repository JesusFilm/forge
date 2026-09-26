// One chapter from bible.helloao.org, with a time limit and a byte limit
// (feat-553 KTD3). The result is typed and never throws, and no body text
// ever reaches a log: a JSON SyntaxError can hold pieces of the body.
import type { UsfmBookId } from "../text/books"
import { normalizeChapterFile } from "../text/normalize"
import type { ChapterText } from "../text/types"
import { chapterFailure, type ChapterFailure } from "./errors"

export const BIBLE_API_BASE = "https://bible.helloao.org/api"

/** Hermes has no reliable `AbortSignal.timeout`, so a timer aborts instead. */
export const CHAPTER_FETCH_TIMEOUT_MS = 8_000

/** About 5x the largest real chapter: mya_ojv PSA 119, 104 KB (2026-09-25). */
export const CHAPTER_MAX_BYTES = 512 * 1024

/** One chapter, in the translation's own numbering. */
export type ChapterAddress = {
  translationId: string
  bookId: UsfmBookId
  chapter: number
}

export type FetchLike = (
  url: string,
  init: { signal: AbortSignal },
) => Promise<Response>

export type ChapterFetchResult =
  | { status: "ok"; text: ChapterText }
  | ChapterFailure

export type FetchChapterOptions = {
  fetchImpl?: FetchLike
  timeoutMs?: number
  maxBytes?: number
}

type BodyRead =
  | { status: "ok"; bytes: Uint8Array }
  | { status: "too-large" }
  | { status: "failed" }

export function chapterUrl(address: ChapterAddress): string {
  const id = encodeURIComponent(address.translationId)
  return `${BIBLE_API_BASE}/${id}/${address.bookId}/${address.chapter}.json`
}

/** A whole translation, as the catalog's download link names it (U3). */
export function completeTranslationUrl(translationId: string): string {
  return `${BIBLE_API_BASE}/${encodeURIComponent(translationId)}/complete.json`
}

const defaultFetch: FetchLike = (url, init) => fetch(url, init)

/** Holds the body reader, so the time limit can cancel a body that stalls. */
class ReaderSlot {
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null

  hold(reader: ReadableStreamDefaultReader<Uint8Array>): void {
    this.reader = reader
  }

  release(): void {
    this.reader = null
  }

  cancel(): void {
    const reader = this.reader
    this.reader = null
    if (reader) void cancelQuietly(reader)
  }
}

async function cancelQuietly(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<void> {
  try {
    await reader.cancel()
  } catch {
    // The stream is already closed or errored.
  }
}

function discardBody(response: Response): void {
  try {
    void response.body?.cancel().catch(() => {})
  } catch {
    // A locked body cannot be cancelled here; the abort still ends it.
  }
}

function concat(chunks: readonly Uint8Array[], total: number): Uint8Array {
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

// Fallback only: expo/fetch always gives a stream. RN's older fetch
// (EXPO_PUBLIC_USE_RN_FETCH) does not, so the declared length is the guard.
async function readWithoutStream(
  response: Response,
  maxBytes: number,
): Promise<BodyRead> {
  const declared = Number(response.headers?.get("content-length") ?? NaN)
  if (Number.isFinite(declared) && declared > maxBytes) {
    return { status: "too-large" }
  }
  try {
    const buffer = await response.arrayBuffer()
    return buffer.byteLength > maxBytes
      ? { status: "too-large" }
      : { status: "ok", bytes: new Uint8Array(buffer) }
  } catch {
    return { status: "failed" }
  }
}

/** Counts real bytes as they arrive, and cancels the stream past the cap. */
async function readCapped(
  response: Response,
  maxBytes: number,
  slot: ReaderSlot,
): Promise<BodyRead> {
  const stream = response.body
  if (!stream) return readWithoutStream(response, maxBytes)
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  try {
    reader = stream.getReader()
    slot.hold(reader)
    const chunks: Uint8Array[] = []
    let total = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        // Cancel, not break: a break leaves the socket filling memory.
        await cancelQuietly(reader)
        return { status: "too-large" }
      }
      chunks.push(value)
    }
    return { status: "ok", bytes: concat(chunks, total) }
  } catch {
    return { status: "failed" }
  } finally {
    slot.release()
    try {
      reader?.releaseLock()
    } catch {
      // A read that is still pending holds the lock.
    }
  }
}

/** True when the text is the chapter that the address names. */
export function isAddressOf(
  text: ChapterText,
  address: ChapterAddress,
): boolean {
  return (
    text.translationId === address.translationId &&
    text.bookId === address.bookId &&
    text.chapter.number === address.chapter
  )
}

async function request(
  address: ChapterAddress,
  fetchImpl: FetchLike,
  signal: AbortSignal,
  maxBytes: number,
  slot: ReaderSlot,
): Promise<ChapterFetchResult> {
  let response: Response
  try {
    response = await fetchImpl(chapterUrl(address), { signal })
  } catch {
    return chapterFailure("offline")
  }
  if (!response.ok) {
    discardBody(response)
    return response.status === 404
      ? chapterFailure("not-found", 404)
      : chapterFailure("http-status", response.status)
  }

  const body = await readCapped(response, maxBytes, slot)
  if (body.status === "too-large") return chapterFailure("too-large")
  if (body.status === "failed") return chapterFailure("offline")

  let raw: unknown
  try {
    raw = JSON.parse(new TextDecoder("utf-8").decode(body.bytes))
  } catch {
    return chapterFailure("malformed-text")
  }
  const chapter = normalizeChapterFile(raw)
  if (chapter.status !== "ok" || !isAddressOf(chapter.value, address)) {
    return chapterFailure("malformed-text")
  }
  return { status: "ok", text: chapter.value }
}

// The time limit covers the headers and the body. The race ends the call
// even when a request ignores its abort signal.
export async function fetchChapter(
  address: ChapterAddress,
  options: FetchChapterOptions = {},
): Promise<ChapterFetchResult> {
  const controller = new AbortController()
  const slot = new ReaderSlot()
  let timer: ReturnType<typeof setTimeout> | undefined
  const timedOut = new Promise<ChapterFetchResult>((resolve) => {
    timer = setTimeout(() => {
      // Settle first, so the abort's own rejection cannot win the race.
      resolve(chapterFailure("timeout"))
      controller.abort()
      slot.cancel()
    }, options.timeoutMs ?? CHAPTER_FETCH_TIMEOUT_MS)
  })
  try {
    return await Promise.race([
      request(
        address,
        options.fetchImpl ?? defaultFetch,
        controller.signal,
        options.maxBytes ?? CHAPTER_MAX_BYTES,
        slot,
      ),
      timedOut,
    ])
  } finally {
    clearTimeout(timer)
  }
}
