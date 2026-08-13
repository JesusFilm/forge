/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest"

import type { SearchResult } from "./search"
import {
  WATCH_UNAVAILABLE_RECOVERY_STORAGE_KEY,
  readWatchUnavailableRecoveryContext,
  writeWatchUnavailableRecoveryContext,
} from "./watch-unavailable-recovery-context"

function result(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    type: "video",
    id: "video-1",
    slug: "good-friday-live",
    title: "Good Friday: Live",
    imageUrl: "https://example.com/poster.jpg",
    imageBlurDataUrl: "data:image/jpeg;base64,private-blur",
    muxThumbnailBlurDataUrl: null,
    snippet: "private query evidence",
    startSeconds: null,
    playbackId: "private-playback-id",
    score: 1,
    label: "SHORT_FILM",
    durationSeconds: 120,
    childCount: 0,
    availabilityKind: "unavailable",
    languageSlug: null,
    evidenceLabel: "Title match",
    evidenceLanguageSlug: "chinese-simplified",
    ...overrides,
  }
}

describe("watch unavailable recovery context", () => {
  it("writes a target-only query-free snapshot that remains readable within its TTL", () => {
    const target = result()

    expect(
      writeWatchUnavailableRecoveryContext({
        target,
        requestedLanguageSlug: "chinese-simplified",
        requestedLanguageName: "简体中文",
        now: 1_000,
      }),
    ).toBe(true)

    const serialized = sessionStorage.getItem(
      WATCH_UNAVAILABLE_RECOVERY_STORAGE_KEY,
    )
    expect(serialized).not.toBeNull()
    expect(serialized).not.toContain("耶稣")
    expect(serialized).not.toContain("private query evidence")
    expect(serialized).not.toContain("private-playback-id")
    expect(serialized).not.toContain("Title match")
    expect(serialized).not.toContain("href")
    expect(serialized).not.toContain("requestId")
    expect(serialized).not.toContain("candidates")

    const firstRead = readWatchUnavailableRecoveryContext({
      contentSlug: "good-friday-live",
      requestedLanguageSlug: "chinese-simplified",
      now: 1_001,
    })
    expect(firstRead?.target.title).toBe("Good Friday: Live")
    expect(
      sessionStorage.getItem(WATCH_UNAVAILABLE_RECOVERY_STORAGE_KEY),
    ).not.toBeNull()

    const secondRead = readWatchUnavailableRecoveryContext({
      contentSlug: "good-friday-live",
      requestedLanguageSlug: "chinese-simplified",
      now: 1_002,
    })
    expect(secondRead).toEqual(firstRead)
    expect(
      sessionStorage.getItem(WATCH_UNAVAILABLE_RECOVERY_STORAGE_KEY),
    ).not.toBeNull()
  })

  it("rejects stale and target-mismatched snapshots", () => {
    expect(
      writeWatchUnavailableRecoveryContext({
        target: result(),
        requestedLanguageSlug: "chinese-simplified",
        now: 1_000,
      }),
    ).toBe(true)

    expect(
      readWatchUnavailableRecoveryContext({
        contentSlug: "different-video",
        requestedLanguageSlug: "chinese-simplified",
        now: 1_001,
      }),
    ).toBeNull()
    expect(
      sessionStorage.getItem(WATCH_UNAVAILABLE_RECOVERY_STORAGE_KEY),
    ).toBeNull()

    expect(
      writeWatchUnavailableRecoveryContext({
        target: result(),
        requestedLanguageSlug: "chinese-simplified",
        now: 1_000,
      }),
    ).toBe(true)
    expect(
      readWatchUnavailableRecoveryContext({
        contentSlug: "good-friday-live",
        requestedLanguageSlug: "chinese-simplified",
        now: 301_001,
      }),
    ).toBeNull()
    expect(
      sessionStorage.getItem(WATCH_UNAVAILABLE_RECOVERY_STORAGE_KEY),
    ).toBeNull()
  })

  it("fails safely when storage is unavailable", () => {
    const deniedStorage: Storage = {
      get length(): number {
        throw new Error("denied")
      },
      clear() {
        throw new Error("denied")
      },
      getItem() {
        throw new Error("denied")
      },
      key() {
        throw new Error("denied")
      },
      removeItem() {
        throw new Error("denied")
      },
      setItem() {
        throw new Error("denied")
      },
    }

    expect(
      writeWatchUnavailableRecoveryContext({
        target: result(),
        requestedLanguageSlug: "chinese-simplified",
        storage: deniedStorage,
      }),
    ).toBe(false)
    expect(
      readWatchUnavailableRecoveryContext({
        contentSlug: "good-friday-live",
        requestedLanguageSlug: "chinese-simplified",
        storage: deniedStorage,
      }),
    ).toBeNull()
  })

  it("rejects snapshots written with the superseded candidate schema", () => {
    sessionStorage.setItem(
      WATCH_UNAVAILABLE_RECOVERY_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        createdAt: 1_000,
        target: {
          slug: "good-friday-live",
          title: "Good Friday: Live",
          imageUrl: null,
          requestedLanguageSlug: "chinese-simplified",
          requestedLanguageName: "简体中文",
        },
        candidates: [],
      }),
    )

    expect(
      readWatchUnavailableRecoveryContext({
        contentSlug: "good-friday-live",
        requestedLanguageSlug: "chinese-simplified",
        now: 1_001,
      }),
    ).toBeNull()
  })
})
