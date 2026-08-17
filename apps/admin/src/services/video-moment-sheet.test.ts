import { describe, expect, it } from "vitest"

import {
  BEAT_SHEET_VERSION,
  classifyDatabaseHost,
  renderBeatSheetMarkdown,
  validateBeatSheet,
  validateBibleReference,
  type BeatSheet,
} from "./video-moment-sheet"

function sheet(overrides: Partial<BeatSheet> = {}): BeatSheet {
  return {
    version: BEAT_SHEET_VERSION,
    videoSlug: "jesus",
    languageSlug: "en",
    sourceModel: "test-model",
    sourceTranscriptId: null,
    reviewedBy: "ekkasit",
    reviewedAt: "2026-08-17T00:00:00.000Z",
    beats: [
      {
        beatIndex: 0,
        startSeconds: 1.2,
        endSeconds: 201,
        summary: "An angel tells Mary she will bear the Son of God.",
        bibleVerses: ["Luke 1:26-38"],
        question: "What would it take to trust news that changes everything?",
      },
      {
        beatIndex: 1,
        startSeconds: 201,
        endSeconds: 350,
        summary: "Jesus is born in Bethlehem and shepherds come to see Him.",
        bibleVerses: ["Luke 2:1-20"],
        question: null,
      },
    ],
    ...overrides,
  }
}

describe("validateBibleReference", () => {
  // Positive fixtures copied from the TV parser's own suite
  // (apps/tv/src/lib/moments/parseBibleReference.test.ts) — the producer's
  // actual literals, per the producer-consumer contract law. If TV's grammar
  // moves, these must move with it.
  it.each([
    "John 3:16",
    "Matthew 5:3-12",
    "1 Corinthians 13",
    "Song of Solomon 2:1–3",
    "Luke 15",
  ])("accepts the TV-parseable canonical reference %s", (reference) => {
    expect(validateBibleReference(reference)).toBeNull()
  })

  // Rejection fixtures also copied from the TV suite: everything TV's parser
  // rejects must fail here too, or the loader ships invisible references.
  it.each([
    ["empty", ""],
    ["book only", "Matthew"],
    ["cross-chapter range", "Matthew 5:3-6:2"],
    ["reversed range", "Matthew 5:12-3"],
    ["zero chapter", "Matthew 0:3"],
    ["trailing prose", "Matthew 5:3 and following"],
    ["not a reference", "the sermon on the mount"],
    ["OSIS dots", "Luke.15.11"],
  ])("rejects %s as unparseable", (_label, reference) => {
    expect(validateBibleReference(reference)).toMatchObject({
      reason: expect.stringMatching(/unparseable|invalid-range/),
    })
  })

  it("rejects abbreviations and misspellings the TV parser would ACCEPT", () => {
    // Stricter than TV on purpose: 'Luk 15:11' parses on device but 404s on
    // the verse fetch; 'Lukes' could fetch a wrong-but-plausible passage.
    expect(validateBibleReference("Luk 15:11")).toMatchObject({
      reason: "unknown-book",
    })
    expect(validateBibleReference("Psalm 23")).toMatchObject({
      reason: "unknown-book", // canonical name is "Psalms"
    })
  })
})

describe("validateBeatSheet", () => {
  it("accepts a signed, well-formed sheet", () => {
    const result = validateBeatSheet(sheet(), { requireSigned: true })
    expect(result.ok).toBe(true)
  })

  it("refuses an UNSIGNED sheet when the loader posture is active", () => {
    const result = validateBeatSheet(sheet({ reviewedBy: "  " }), {
      requireSigned: true,
    })
    expect(result.ok).toBe(false)
    expect(result.issues).toContainEqual(
      expect.objectContaining({ kind: "unsigned" }),
    )
  })

  it("allows an unsigned sheet for the generator posture", () => {
    const result = validateBeatSheet(
      sheet({ reviewedBy: "", reviewedAt: null }),
      { requireSigned: false },
    )
    expect(result.ok).toBe(true)
  })

  it("flags every invalid reference with its beat index", () => {
    const bad = sheet()
    bad.beats[0]!.bibleVerses = ["Luke 1:26-38", "Luk 15:11"]
    bad.beats[1]!.bibleVerses = ["Matthew 5:3-6:2"]

    const result = validateBeatSheet(bad, { requireSigned: true })
    expect(result.ok).toBe(false)
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        kind: "reference",
        beatIndex: 0,
        issue: expect.objectContaining({ reason: "unknown-book" }),
      }),
    )
    expect(result.issues).toContainEqual(
      expect.objectContaining({ kind: "reference", beatIndex: 1 }),
    )
  })

  it("requires contiguous beatIndex values in file order", () => {
    const bad = sheet()
    bad.beats[1]!.beatIndex = 5
    const result = validateBeatSheet(bad, { requireSigned: true })
    expect(result.ok).toBe(false)
    expect(result.issues).toContainEqual(
      expect.objectContaining({ kind: "beat-order" }),
    )
  })

  it("requires strictly increasing startSeconds (TV timed-mode contract)", () => {
    const bad = sheet()
    bad.beats[1]!.startSeconds = 1.2
    const result = validateBeatSheet(bad, { requireSigned: true })
    expect(result.ok).toBe(false)
    expect(result.issues).toContainEqual(
      expect.objectContaining({ kind: "timing" }),
    )
  })

  it("rejects an end before its start", () => {
    const bad = sheet()
    bad.beats[0]!.endSeconds = 0.5
    const result = validateBeatSheet(bad, { requireSigned: true })
    expect(result.ok).toBe(false)
    expect(result.issues).toContainEqual(
      expect.objectContaining({ kind: "timing" }),
    )
  })

  it("reports schema violations with paths instead of throwing", () => {
    const result = validateBeatSheet({ version: 2 }, { requireSigned: true })
    expect(result.ok).toBe(false)
    expect(result.sheet).toBeNull()
    expect(result.issues[0]).toMatchObject({ kind: "schema" })
  })

  it("caps references per beat at the TV panel's render cap", () => {
    const bad = sheet()
    bad.beats[0]!.bibleVerses = [
      "Luke 1:1",
      "Luke 1:2",
      "Luke 1:3",
      "Luke 1:4",
      "Luke 1:5",
    ]
    const result = validateBeatSheet(bad, { requireSigned: true })
    expect(result.ok).toBe(false)
    expect(result.issues[0]).toMatchObject({ kind: "schema" })
  })
})

describe("renderBeatSheetMarkdown", () => {
  it("renders one row per beat with clock times and escaped pipes", () => {
    const withPipe = sheet()
    withPipe.beats[0]!.summary = "Mary | the angel"
    const md = renderBeatSheetMarkdown(withPipe)
    expect(md).toContain("| 0 | 0:01–3:21 | Mary \\| the angel |")
    expect(md).toContain("Luke 2:1-20")
    expect(md).toContain("signed by ekkasit")
  })

  it("labels an unsigned sheet loudly", () => {
    const md = renderBeatSheetMarkdown(sheet({ reviewedBy: "" }))
    expect(md).toContain("UNSIGNED")
  })
})

describe("review-hardening rules (Tier-2 findings)", () => {
  it("rejects a non-ISO reviewedAt — free text must not survive to the transaction", () => {
    const result = validateBeatSheet(sheet({ reviewedAt: "last Tuesday" }), {
      requireSigned: true,
    })
    expect(result.ok).toBe(false)
    expect(result.issues[0]).toMatchObject({ kind: "schema" })
  })

  it("refuses a SIGNED sheet whose reviewedAt is null — no fabricated provenance", () => {
    const result = validateBeatSheet(sheet({ reviewedAt: null }), {
      requireSigned: true,
    })
    expect(result.ok).toBe(false)
    expect(result.issues).toContainEqual(
      expect.objectContaining({ kind: "unsigned" }),
    )
  })

  it.each(["EN", "en-US", "english", "En"])(
    "rejects languageSlug %s — only lowercase BCP-47 rows are ever served",
    (languageSlug) => {
      const result = validateBeatSheet(sheet({ languageSlug }), {
        requireSigned: true,
      })
      expect(result.ok).toBe(false)
    },
  )

  it("accepts lowercase region tags like pt-br", () => {
    expect(
      validateBeatSheet(sheet({ languageSlug: "pt-br" }), {
        requireSigned: true,
      }).ok,
    ).toBe(true)
  })

  it("rejects a 1-beat sheet (TV timed mode needs two distinct anchors)", () => {
    const one = sheet()
    one.beats = [one.beats[0]!]
    expect(validateBeatSheet(one, { requireSigned: true }).ok).toBe(false)
  })

  it("rejects a sheet larger than the server's default take (150)", () => {
    const big = sheet()
    big.beats = Array.from({ length: 151 }, (_, i) => ({
      beatIndex: i,
      startSeconds: i * 10,
      endSeconds: null,
      summary: `Beat ${i}`,
      bibleVerses: [],
      question: null,
    }))
    expect(validateBeatSheet(big, { requireSigned: true }).ok).toBe(false)
  })
})

describe("classifyDatabaseHost", () => {
  it.each([
    ["pg.railway.app", "known-production"],
    ["postgres.railway.internal", "known-production"],
    ["db.jesusfilm.org", "known-production"],
    ["monorail.proxy.rlwy.net", "known-production"],
    ["localhost", "local"],
    ["127.0.0.1", "local"],
    ["db", "local"],
    // FAIL CLOSED: anything unrecognized is treated as potentially prod.
    ["10.0.0.12", "unknown"],
    ["ep-cool-star.neon.tech", "unknown"],
    ["pooler.supabase.com", "unknown"],
  ])("classifies %s as %s", (host, expected) => {
    expect(classifyDatabaseHost(host)).toBe(expected)
  })
})
