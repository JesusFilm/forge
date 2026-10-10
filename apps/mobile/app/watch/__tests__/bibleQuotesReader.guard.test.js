// Plain JS (like the other guard suites): the RN tsconfig has no Node types,
// and this guard needs fs/path to read the route file.
/* eslint-disable @typescript-eslint/no-require-imports */
/* global describe, expect, it, require */
const fs = require("fs")
const path = require("path")

// feat-553 U12 (KTD17, KD3). "Read full passage" on a quote card pushes the
// native reader, and the video keeps playing. The route has no render suite,
// so this pins its half of the tap: a one-line revert here compiles and
// leaves the carousel suite green. The carousel suite pins the other half.
const ROUTE = path.join(__dirname, "..", "[slug].tsx")
const CAROUSEL = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "src",
  "components",
  "sections",
  "BibleQuotesCarouselRenderer.tsx",
)
const BIBLE = path.join(__dirname, "..", "..", "..", "src", "lib", "bible")
const CARD_QUOTE = path.join(BIBLE, "quotes", "cardQuote.ts")
const READER_CHAPTER = path.join(BIBLE, "reader", "useReaderChapter.ts")

describe("video details page Bible quotes carousel opens the reader", () => {
  it("passes the reader handler to the carousel", () => {
    const source = fs.readFileSync(ROUTE, "utf8")
    const elements = source.match(/<BibleQuotesCarouselRenderer\b[\s\S]*?\/>/g)

    expect(elements).toHaveLength(1)
    expect(elements[0]).toMatch(/\bonOpenReader=\{openBibleReader\}/)
  })

  it("pushes the reader route as a quote, at the card's start", () => {
    const source = fs.readFileSync(ROUTE, "utf8")
    const handler = source.match(
      /const openBibleReader = useCallback\(([\s\S]*?)\n {2}\)/,
    )

    // Anti-vacuous: the handler is really there to inspect.
    expect(handler).not.toBeNull()
    expect(handler[1]).toMatch(
      /router\.push\(\s*readerHref\(\s*start\s*,\s*"quote"\s*\)\s*\)/,
    )
    // KD3: the video keeps playing under the reader.
    expect(handler[1]).not.toMatch(/pause|Interruption|openPassageSheet/)
  })

  // Plan 2026-10-08 (KTD3, KTD11): the cards take the reader's inputs from
  // here, and the hook's suite cannot see what the route passes.
  it("passes the dub preference and the focus to the quote hook", () => {
    const source = fs.readFileSync(ROUTE, "utf8")
    const call = source.match(/useBibleVerses\(([\s\S]*?)\n {2}\)/)

    // Anti-vacuous: the call is really there to inspect.
    expect(call).not.toBeNull()
    expect(call[1]).toMatch(/audioLanguage:\s*audioLanguageIso3\b/)
    expect(call[1]).toMatch(/audioReady:\s*preferencesReady\b/)
    expect(call[1]).toMatch(/focused:\s*quotesFocused\b/)
    expect(source).toMatch(/const quotesFocused = useIsFocused\(\)/)
    expect(source).toMatch(
      /\{\s*audioLanguageIso3,\s*isReady:\s*preferencesReady\s*\}\s*=\s*useWatchPreferences\(\)/,
    )
  })

  // KTD12: "Read full passage" carries no translation, so the card and the
  // reader agree only because both ask the same resolver.
  it("resolves a card's translation with the reader's own resolver", () => {
    for (const file of [CARD_QUOTE, READER_CHAPTER]) {
      const source = fs.readFileSync(file, "utf8")
      expect(source).toMatch(
        /import \{[^}]*\bresolveShownTranslation\b[^}]*\} from "\.\.\/language\/defaultTranslation"/,
      )
      expect(source).toMatch(/\bresolveShownTranslation\(\{/)
    }
  })

  it("leaves the Bible.com sheet and the playback interruption behind", () => {
    for (const file of [ROUTE, CAROUSEL]) {
      const source = fs.readFileSync(file, "utf8")
      // Anti-vacuous: the file is the one this guard means.
      expect(source).toMatch(/BibleQuotesCarouselRenderer/)
      expect(source).not.toMatch(/openPassageSheet|expo-web-browser/)
      expect(source).not.toMatch(/beginPlaybackInterruption/)
    }
  })
})
