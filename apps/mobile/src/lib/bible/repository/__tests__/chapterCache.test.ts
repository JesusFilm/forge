// Runs on jest-expo's in-memory expo-file-system. Its modification time is a
// logical clock that rises with each write, as a device clock does.
import { Directory, File, Paths } from "expo-file-system"

import { normalizeChapterFile } from "../../text/normalize"
import type { ChapterText } from "../../text/types"
import {
  CHAPTER_CACHE_MAX_BYTES,
  chapterCacheDirectory,
  createChapterCache,
  type ChapterCacheKey,
} from "../chapterCache"

declare const __dirname: string
const fs = jest.requireActual<{
  readFileSync(path: string, encoding: "utf8"): string
}>("fs")

const SHA_A = "a".repeat(64)
const SHA_B = "b".repeat(64)

function realJohn3(): ChapterText {
  const raw: unknown = JSON.parse(
    fs.readFileSync(`${__dirname}/fixtures/gue_wbt-JHN-3.json`, "utf8"),
  )
  const result = normalizeChapterFile(raw)
  if (result.status !== "ok") throw new Error(result.reason)
  return result.value
}

const JOHN_3 = realJohn3()

/** The real chapter under another number, optionally with a long verse. */
function chapterText(
  number: number,
  options: { translationId?: string; verseText?: string } = {},
): ChapterText {
  const verses = options.verseText
    ? [{ number: 1, lines: [{ text: options.verseText }] }]
    : JOHN_3.chapter.verses
  return {
    ...JOHN_3,
    translationId: options.translationId ?? JOHN_3.translationId,
    chapter: { number, lastVerse: JOHN_3.chapter.lastVerse, verses },
  }
}

function key(
  chapter: number,
  sha256 = SHA_A,
  translationId = "gue_wbt",
): ChapterCacheKey {
  return { translationId, bookId: "JHN", chapter, sha256 }
}

function keptFile(translationId: string, name: string): File {
  return new File(chapterCacheDirectory(), translationId, name)
}

beforeEach(() => {
  const bible = new Directory(Paths.cache, "bible")
  if (bible.exists) bible.delete()
})

describe("chapter cache", () => {
  it("keeps a chapter under the cache directory and reads it back", async () => {
    const cache = createChapterCache()

    expect(cache.write(key(3), JOHN_3)).toBe(true)

    expect(keptFile("gue_wbt", `JHN.3.${SHA_A}.json`).exists).toBe(true)
    await expect(cache.read(key(3))).resolves.toEqual({
      text: JOHN_3,
      stale: false,
    })
  })

  it("keeps two translations apart", async () => {
    const cache = createChapterCache()
    const other = chapterText(3, { translationId: "rus_syn" })

    cache.write(key(3), JOHN_3)
    cache.write(key(3, SHA_A, "rus_syn"), other)

    expect((await cache.read(key(3)))?.text.translationId).toBe("gue_wbt")
    expect(
      (await cache.read(key(3, SHA_A, "rus_syn")))?.text.translationId,
    ).toBe("rus_syn")
  })

  it("reads a chapter kept under another sha256 as stale", async () => {
    const cache = createChapterCache()
    cache.write(key(3, SHA_A), JOHN_3)

    await expect(cache.read(key(3, SHA_B))).resolves.toEqual({
      text: JOHN_3,
      stale: true,
    })
  })

  it("replaces the stale version when the new one is kept", async () => {
    const cache = createChapterCache()
    cache.write(key(3, SHA_A), JOHN_3)

    cache.write(key(3, SHA_B), JOHN_3)

    expect(keptFile("gue_wbt", `JHN.3.${SHA_A}.json`).exists).toBe(false)
    expect(keptFile("gue_wbt", `JHN.3.${SHA_B}.json`).exists).toBe(true)
    await expect(cache.read(key(3, SHA_B))).resolves.toEqual({
      text: JOHN_3,
      stale: false,
    })
  })

  it("says whether any version of a chapter is kept", () => {
    const cache = createChapterCache()
    cache.write(key(3, SHA_A), JOHN_3)

    expect(cache.has(key(3, SHA_B))).toBe(true)
    expect(cache.has(key(4))).toBe(false)
    expect(cache.has({ ...key(3), translationId: "rus_syn" })).toBe(false)
  })

  it("removes the oldest chapters when it passes the cap", async () => {
    const one = new TextEncoder().encode(JSON.stringify(chapterText(1)))
    // Room for three chapters, not four.
    const cache = createChapterCache({ maxBytes: one.byteLength * 3 + 10 })

    for (const number of [1, 2, 3, 4, 5]) {
      cache.write(key(number), chapterText(number))
    }

    expect(cache.has(key(1))).toBe(false)
    expect(cache.has(key(2))).toBe(false)
    for (const number of [3, 4, 5]) expect(cache.has(key(number))).toBe(true)
    expect(keptFile("gue_wbt", `JHN.1.${SHA_A}.json`).exists).toBe(false)
    expect(cache.usedBytes()).toBeLessThanOrEqual(one.byteLength * 3 + 10)
    await expect(cache.read(key(5))).resolves.not.toBeNull()
  })

  it("holds at most 30 MB by default", () => {
    expect(CHAPTER_CACHE_MAX_BYTES).toBe(30 * 1024 * 1024)
    const cache = createChapterCache()
    const mebibyte = "x".repeat(1024 * 1024)

    for (let number = 1; number <= 31; number += 1) {
      cache.write(key(number), chapterText(number, { verseText: mebibyte }))
    }

    expect(cache.usedBytes()).toBeLessThanOrEqual(CHAPTER_CACHE_MAX_BYTES)
    expect(cache.has(key(1))).toBe(false)
    expect(cache.has(key(31))).toBe(true)
  })

  it("counts chapters kept in an earlier session", () => {
    const one = new TextEncoder().encode(JSON.stringify(chapterText(1)))
    const maxBytes = one.byteLength * 2 + 10
    const earlier = createChapterCache({ maxBytes })
    earlier.write(key(1), chapterText(1))
    earlier.write(key(2), chapterText(2))

    // A new instance reads the directory, as the app does after a restart.
    const later = createChapterCache({ maxBytes })
    later.write(key(3), chapterText(3))

    expect(later.has(key(1))).toBe(false)
    expect(later.has(key(2))).toBe(true)
    expect(later.has(key(3))).toBe(true)
  })

  it("reads a damaged file as a miss and removes it", async () => {
    const cache = createChapterCache()
    cache.write(key(3), JOHN_3)
    keptFile("gue_wbt", `JHN.3.${SHA_A}.json`).write("{not json")

    await expect(cache.read(key(3))).resolves.toBeNull()
    expect(keptFile("gue_wbt", `JHN.3.${SHA_A}.json`).exists).toBe(false)
  })

  it("reads a file that holds another chapter as a miss", async () => {
    const cache = createChapterCache()
    cache.write(key(3), JOHN_3)
    keptFile("gue_wbt", `JHN.3.${SHA_A}.json`).write(
      JSON.stringify(chapterText(4)),
    )

    await expect(cache.read(key(3))).resolves.toBeNull()
  })

  it("refuses an unsafe translation id or a bad sha256", () => {
    const cache = createChapterCache()

    expect(cache.write(key(3, SHA_A, "../escape"), JOHN_3)).toBe(false)
    expect(cache.write(key(3, "not-a-hash"), JOHN_3)).toBe(false)
    expect(cache.usedBytes()).toBe(0)
  })

  it("survives a cache directory that the system removed", async () => {
    const cache = createChapterCache()
    cache.write(key(3), JOHN_3)
    new Directory(Paths.cache, "bible").delete()

    expect(cache.has(key(3))).toBe(false)
    await expect(cache.read(key(3))).resolves.toBeNull()
    expect(cache.write(key(4), chapterText(4))).toBe(true)
  })
})
