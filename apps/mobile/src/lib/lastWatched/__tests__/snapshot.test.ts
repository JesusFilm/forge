/**
 * Pure parse and serialize for the last-watched record (KTD5). Nothing is
 * mocked — the whole module is a string in and a record out.
 */

import {
  LAST_WATCHED_MAX_AGE_MS,
  LAST_WATCHED_MAX_SLUG_LENGTH,
  LAST_WATCHED_MAX_TITLE_LENGTH,
  LAST_WATCHED_STORAGE_KEY,
  LAST_WATCHED_VERSION,
  parseStoredLastWatched,
  sanitizeLastWatchedTitle,
  serializeLastWatched,
} from "../snapshot"

const NOW = new Date("2026-09-16T10:00:00.000Z")

function storedBlob(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    version: LAST_WATCHED_VERSION,
    videoSlug: "the-birth-of-jesus",
    videoTitle: null,
    recordedAt: NOW.getTime(),
    ...overrides,
  })
}

describe("the module's own storage key", () => {
  it("is distinct from the watch-progress keys", () => {
    expect(LAST_WATCHED_STORAGE_KEY).toBe("last-watched-video")
  })
})

describe("serializeLastWatched", () => {
  it("round-trips a record through parse with slug and recorded time", () => {
    const blob = serializeLastWatched({
      videoSlug: "the-birth-of-jesus",
      videoTitle: null,
      recordedAt: NOW.getTime(),
    })

    expect(blob).not.toBeNull()
    expect(parseStoredLastWatched(blob, NOW)).toEqual({
      videoSlug: "the-birth-of-jesus",
      videoTitle: null,
      recordedAt: NOW.getTime(),
    })
  })

  it("refuses a record the parser would reject, so storage never holds junk", () => {
    expect(
      serializeLastWatched({
        videoSlug: "",
        videoTitle: null,
        recordedAt: NOW.getTime(),
      }),
    ).toBeNull()
    expect(
      serializeLastWatched({
        videoSlug: "a".repeat(LAST_WATCHED_MAX_SLUG_LENGTH + 1),
        videoTitle: null,
        recordedAt: NOW.getTime(),
      }),
    ).toBeNull()
  })

  it("stores a slug exactly at the length cap", () => {
    const videoSlug = "a".repeat(LAST_WATCHED_MAX_SLUG_LENGTH)
    const blob = serializeLastWatched({
      videoSlug,
      videoTitle: null,
      recordedAt: NOW.getTime(),
    })

    expect(parseStoredLastWatched(blob, NOW)?.videoSlug).toBe(videoSlug)
  })
})

describe("parseStoredLastWatched", () => {
  it("degrades to null for an unwritten key and for bad JSON", () => {
    expect(parseStoredLastWatched(null, NOW)).toBeNull()
    expect(parseStoredLastWatched("not json", NOW)).toBeNull()
    expect(parseStoredLastWatched("null", NOW)).toBeNull()
    expect(parseStoredLastWatched("[]", NOW)).toBeNull()
  })

  it("degrades to null for a higher version", () => {
    expect(
      parseStoredLastWatched(
        storedBlob({ version: LAST_WATCHED_VERSION + 1 }),
        NOW,
      ),
    ).toBeNull()
  })

  it("degrades to null for a missing or empty slug", () => {
    expect(
      parseStoredLastWatched(storedBlob({ videoSlug: undefined }), NOW),
    ).toBeNull()
    expect(
      parseStoredLastWatched(storedBlob({ videoSlug: "" }), NOW),
    ).toBeNull()
    expect(parseStoredLastWatched(storedBlob({ videoSlug: 7 }), NOW)).toBeNull()
  })

  it("degrades to null for a slug over the length cap", () => {
    expect(
      parseStoredLastWatched(
        storedBlob({ videoSlug: "a".repeat(LAST_WATCHED_MAX_SLUG_LENGTH + 1) }),
        NOW,
      ),
    ).toBeNull()
  })

  it("degrades to null for a missing or non-numeric recorded time", () => {
    expect(
      parseStoredLastWatched(storedBlob({ recordedAt: undefined }), NOW),
    ).toBeNull()
    expect(
      parseStoredLastWatched(storedBlob({ recordedAt: "yesterday" }), NOW),
    ).toBeNull()
    expect(
      parseStoredLastWatched(storedBlob({ recordedAt: Number.NaN }), NOW),
    ).toBeNull()
  })

  it("counts a record older than 30 days as absent (R19)", () => {
    const stale = NOW.getTime() - LAST_WATCHED_MAX_AGE_MS - 1

    expect(
      parseStoredLastWatched(storedBlob({ recordedAt: stale }), NOW),
    ).toBeNull()
  })

  it("keeps a record exactly at the 30-day boundary", () => {
    const edge = NOW.getTime() - LAST_WATCHED_MAX_AGE_MS

    expect(
      parseStoredLastWatched(storedBlob({ recordedAt: edge }), NOW),
    ).toEqual({
      videoSlug: "the-birth-of-jesus",
      videoTitle: null,
      recordedAt: edge,
    })
  })

  it("keeps a record recorded in the future (a clock that moved backwards)", () => {
    const future = NOW.getTime() + 60_000

    expect(
      parseStoredLastWatched(storedBlob({ recordedAt: future }), NOW)
        ?.videoSlug,
    ).toBe("the-birth-of-jesus")
  })
})

describe("the video title", () => {
  it("round-trips a title through serialize and parse", () => {
    const blob = serializeLastWatched({
      videoSlug: "the-birth-of-jesus",
      videoTitle: "The Birth of Jesus",
      recordedAt: NOW.getTime(),
    })

    expect(parseStoredLastWatched(blob, NOW)?.videoTitle).toBe(
      "The Birth of Jesus",
    )
  })

  it("reads a record written before titles as having none, not as invalid", () => {
    // A v1 record on an upgrading device must still parse, or the next
    // reminder falls back to Home. The literal 1 is load-bearing: as the
    // constant it would move with a bump and hide exactly that case.
    const legacy = JSON.stringify({
      version: 1,
      videoSlug: "the-birth-of-jesus",
      recordedAt: NOW.getTime(),
    })

    expect(parseStoredLastWatched(legacy, NOW)).toEqual({
      videoSlug: "the-birth-of-jesus",
      videoTitle: null,
      recordedAt: NOW.getTime(),
    })
  })

  it("keeps the record when the title is unusable, and drops only the title", () => {
    for (const videoTitle of [123, null, "", "   ", {}, []]) {
      const record = parseStoredLastWatched(storedBlob({ videoTitle }), NOW)
      expect(record?.videoSlug).toBe("the-birth-of-jesus")
      expect(record?.videoTitle).toBeNull()
    }
  })

  it("strips control characters and line breaks before storage", () => {
    const blob = serializeLastWatched({
      videoSlug: "the-birth-of-jesus",
      videoTitle: "The Birth\nof\tJesus",
      recordedAt: NOW.getTime(),
    })

    expect(parseStoredLastWatched(blob, NOW)?.videoTitle).toBe(
      "The Birth of Jesus",
    )
  })

  it("caps a long title at the limit", () => {
    const blob = serializeLastWatched({
      videoSlug: "the-birth-of-jesus",
      videoTitle: "a".repeat(LAST_WATCHED_MAX_TITLE_LENGTH + 50),
      recordedAt: NOW.getTime(),
    })

    expect(parseStoredLastWatched(blob, NOW)?.videoTitle).toHaveLength(
      LAST_WATCHED_MAX_TITLE_LENGTH,
    )
  })

  it("caps a long title read back from storage too", () => {
    // The parser must not trust the stored value: an older or hand-edited
    // record can hold a title the serializer would never have written.
    const record = parseStoredLastWatched(
      storedBlob({
        videoTitle: "b".repeat(LAST_WATCHED_MAX_TITLE_LENGTH + 50),
      }),
      NOW,
    )

    expect(record?.videoTitle).toHaveLength(LAST_WATCHED_MAX_TITLE_LENGTH)
  })
})

describe("what the title sanitizer must remove", () => {
  // The body renders on a locked device with no title field, so the fixed app
  // copy and the title share one line. Anything that can hide or reorder text
  // lets the title restyle the app's own sentence around it.
  const REORDERING = [
    ["a bidi override", "Jesus\u202EEVIL"],
    ["a bidi embedding", "Jesus\u202AEVIL"],
    ["a bidi isolate", "Jesus\u2066EVIL"],
    ["the Arabic letter mark", "Jesus\u061CEVIL"],
  ] as const

  const INVISIBLE = [
    ["a zero-width space", "Jesus\u200BEVIL"],
    ["a zero-width joiner", "Jesus\u200DEVIL"],
    ["a byte order mark", "Jesus\uFEFFEVIL"],
    ["a soft hyphen", "Jesus\u00ADEVIL"],
    ["a word joiner", "Jesus\u2060EVIL"],
  ] as const

  const LINE_BREAKS = [
    ["a line separator", "Jesus\u2028EVIL"],
    ["a paragraph separator", "Jesus\u2029EVIL"],
    ["a C1 next-line", "Jesus\u0085EVIL"],
    ["an ASCII newline", "Jesus\nEVIL"],
  ] as const

  it.each([...REORDERING, ...INVISIBLE, ...LINE_BREAKS])(
    "strips %s",
    (_label, title) => {
      expect(sanitizeLastWatchedTitle(title)).toBe("Jesus EVIL")
    },
  )

  it("keeps ordinary text, including non-Latin scripts, untouched", () => {
    // Anti-vacuous: without this a sanitizer that returned a constant, or one
    // that stripped everything, would satisfy every case above.
    expect(sanitizeLastWatchedTitle("The Birth of Jesus")).toBe(
      "The Birth of Jesus",
    )
    expect(
      sanitizeLastWatchedTitle("\u30A4\u30A8\u30B9\u306E\u8A95\u751F"),
    ).toBe("\u30A4\u30A8\u30B9\u306E\u8A95\u751F")
    expect(sanitizeLastWatchedTitle("Jes\u00FAs: el Hijo de Dios")).toBe(
      "Jes\u00FAs: el Hijo de Dios",
    )
  })

  it("keeps the character just outside the stripped control range", () => {
    // 0x20 is the boundary the class must NOT cross; an off-by-one that ate
    // spaces would leave every multi-word title as one run.
    expect(sanitizeLastWatchedTitle("The Birth")).toBe("The Birth")
  })

  it("collapses a run of stripped characters into one space", () => {
    expect(sanitizeLastWatchedTitle("Jesus\u202E\u200B\n\tEVIL")).toBe(
      "Jesus EVIL",
    )
  })
})

describe("the title cap counts code points", () => {
  it("never leaves a lone surrogate at the cap", () => {
    // A UTF-16 slice cuts an astral character in half. The lone surrogate is
    // not representable in UTF-8, so it reaches the native bridge malformed.
    const title = "\u{1F389}".repeat(LAST_WATCHED_MAX_TITLE_LENGTH)
    const cleaned = sanitizeLastWatchedTitle(title) as string

    expect(cleaned).not.toBeNull()
    for (const char of cleaned) {
      const code = char.codePointAt(0) as number
      expect(code >= 0xd800 && code <= 0xdfff).toBe(false)
    }
    expect(Array.from(cleaned)).toHaveLength(LAST_WATCHED_MAX_TITLE_LENGTH)
  })

  it("caps by code point, not by code unit", () => {
    const title = "\u{1F389}".repeat(LAST_WATCHED_MAX_TITLE_LENGTH + 20)
    const cleaned = sanitizeLastWatchedTitle(title) as string

    expect(Array.from(cleaned)).toHaveLength(LAST_WATCHED_MAX_TITLE_LENGTH)
  })
})
