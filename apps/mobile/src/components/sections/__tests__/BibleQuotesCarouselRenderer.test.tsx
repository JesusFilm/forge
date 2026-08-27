/**
 * Card presentation for the Bible Quotes carousel.
 *
 * The renderer serves THREE surfaces — the watch page's passage cards, the
 * Experience carousel, and the SDUI content path — and only the first carries
 * passage data. The Experience case here is what pins that adding the passage
 * regions left the other two byte-identical.
 */

const mockOpenPassageSheet = jest.fn()
jest.mock("../../../lib/openPassageSheet", () => ({
  openPassageSheet: (...args: unknown[]) => mockOpenPassageSheet(...args),
}))

import { act } from "react"
import type React from "react"

import {
  COPYRIGHT_MAX_LINES,
  VERSE_MAX_LINES,
  composeCardLabel,
  fitPassageCardRegions,
} from "../../../lib/bibleCardFit"
import { computeTypographyScale } from "../../../hooks/useTypography"
import { BibleQuotesCarouselRenderer } from "../BibleQuotesCarouselRenderer"
import {
  TestRenderer,
  press,
  type RenderedNode,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"
import type { AdminBlock } from "../../../lib/queries"

type Quote = Record<string, unknown>

const PASSAGE_QUOTE: Quote = {
  reference: "Genesis 1:26-27",
  text: "God said, “Let’s make man in our image, after our likeness.”",
  attribution: null,
  imageUrl: null,
  backgroundColor: null,
  ctaLabel: null,
  ctaLink: null,
  translation: "World English Bible British Edition",
  copyright: "Public Domain",
  passageUrl: "https://www.bible.com/bible/206/GEN.1.26-GEN.1.27.WEBBE",
  loading: false,
}

// Exactly the shape admin's Experience quote type produces: authored text, and
// none of the passage fields.
const EXPERIENCE_QUOTE: Quote = {
  reference: "John 3:16",
  text: "For God so loved the world…",
  attribution: "Scripture",
  imageUrl: null,
  backgroundColor: "#123456",
  ctaLabel: null,
  ctaLink: null,
}

function render(quotes: Quote[]): TestInstance {
  const section = {
    __typename: "BibleQuotesCarouselBlock",
    heading: "Bible Quotes",
    quotes,
  } as unknown as AdminBlock

  let renderer!: TestInstance
  act(() => {
    renderer = TestRenderer.create(
      (<BibleQuotesCarouselRenderer section={section} />) as React.ReactElement,
    )
  })
  return renderer
}

function textNodes(renderer: TestInstance): RenderedNode[] {
  return renderer.root.findAll(
    (node) => typeof node.props.children === "string",
  )
}

function findText(renderer: TestInstance, needle: string) {
  return textNodes(renderer).find((node) =>
    String(node.props.children).includes(needle),
  )
}

function cardLabels(renderer: TestInstance): string[] {
  return renderer.root
    .findAll(
      (node) =>
        node.props.accessible === true &&
        typeof node.props.accessibilityLabel === "string",
    )
    .map((node) => String(node.props.accessibilityLabel))
}

function passageLinks(renderer: TestInstance): RenderedNode[] {
  return renderer.root.findAll(
    (node) =>
      node.props.accessibilityRole === "link" &&
      node.props.accessibilityLabel === "Read full passage" &&
      typeof node.props.onPress === "function",
  )
}

describe("BibleQuotesCarouselRenderer — passage cards", () => {
  it("renders the verse, the translation, the copyright and the link", () => {
    const renderer = render([PASSAGE_QUOTE])

    expect(findText(renderer, "GENESIS 1:26-27")).toBeDefined()
    expect(findText(renderer, "Let’s make man in our image")).toBeDefined()
    expect(
      findText(renderer, "World English Bible British Edition"),
    ).toBeDefined()
    expect(findText(renderer, "Public Domain")).toBeDefined()
    expect(findText(renderer, "Read full passage")).toBeDefined()
  })

  // Covers AE2. Genesis 22:1-18 is about 2,400 characters.
  it("keeps the reference, attribution and link present for a long passage", () => {
    const renderer = render([
      { ...PASSAGE_QUOTE, text: "And it came to pass. ".repeat(120) },
    ])

    expect(findText(renderer, "GENESIS 1:26-27")).toBeDefined()
    expect(
      findText(renderer, "World English Bible British Edition"),
    ).toBeDefined()
    expect(findText(renderer, "Public Domain")).toBeDefined()
    expect(findText(renderer, "Read full passage")).toBeDefined()
  })

  // Covers R7.
  it("caps the verse at four lines and the copyright at two", () => {
    const renderer = render([PASSAGE_QUOTE])

    const verse = findText(renderer, "Let’s make man in our image")
    const copyright = findText(renderer, "Public Domain")

    expect(verse?.props.numberOfLines).toBe(VERSE_MAX_LINES)
    expect(copyright?.props.numberOfLines).toBe(COPYRIGHT_MAX_LINES)
  })

  // Covers AE3.
  it("renders a reference alone when the card has no passage", () => {
    const renderer = render([
      {
        ...PASSAGE_QUOTE,
        text: "",
        translation: null,
        copyright: null,
        passageUrl: null,
      },
    ])

    expect(findText(renderer, "GENESIS 1:26-27")).toBeDefined()
    expect(
      findText(renderer, "World English Bible British Edition"),
    ).toBeUndefined()
    expect(findText(renderer, "Public Domain")).toBeUndefined()
    expect(findText(renderer, "Read full passage")).toBeUndefined()
  })

  // Covers AE8.
  it("composes an announcement with no dangling separator when there is no verse", () => {
    const renderer = render([{ ...PASSAGE_QUOTE, text: "" }])

    expect(cardLabels(renderer)).toContain("Genesis 1:26-27")
    expect(cardLabels(renderer).some((label) => label.endsWith(": "))).toBe(
      false,
    )
  })

  // Covers AE10. The card is a fixed square, so a citation card and a loading
  // card occupy the same height by construction; what must hold is that the
  // loading card already shows its REAL reference and no verse.
  it("shows the real reference and no verse while the read is unsettled", () => {
    const renderer = render([
      {
        ...PASSAGE_QUOTE,
        text: "",
        translation: null,
        copyright: null,
        passageUrl: null,
        loading: true,
      },
    ])

    expect(findText(renderer, "GENESIS 1:26-27")).toBeDefined()
    expect(findText(renderer, "Read full passage")).toBeUndefined()
    expect(cardLabels(renderer)).toContain("Genesis 1:26-27, loading")
  })

  // The affordance disables itself when no handler is wired, so a link with no
  // behaviour can never reach a viewer through a landing-order mistake.
  it("renders a tappable link now that a handler is wired", () => {
    const renderer = render([PASSAGE_QUOTE])

    const links = passageLinks(renderer)
    expect(links.length).toBeGreaterThan(0)
    for (const link of links) {
      expect(link.props.disabled).toBe(false)
    }
  })

  it("opens the passage when the link is pressed", async () => {
    const renderer = render([PASSAGE_QUOTE])

    await press(passageLinks(renderer)[0]!)

    expect(mockOpenPassageSheet).toHaveBeenCalledWith(PASSAGE_QUOTE.passageUrl)
  })

  it("renders no link for a passage URL that fails validation", () => {
    const renderer = render([
      { ...PASSAGE_QUOTE, passageUrl: "javascript:alert(1)" },
    ])

    expect(findText(renderer, "Read full passage")).toBeUndefined()
  })
})

// Covers AE7 and R14.
describe("BibleQuotesCarouselRenderer — Experience cards are unchanged", () => {
  it("renders today's regions and its grouped announcement", () => {
    const renderer = render([EXPERIENCE_QUOTE])

    expect(findText(renderer, "SCRIPTURE")).toBeDefined()
    expect(findText(renderer, "JOHN 3:16")).toBeDefined()
    expect(findText(renderer, "For God so loved the world")).toBeDefined()
    expect(cardLabels(renderer)).toContain(
      "John 3:16: For God so loved the world…",
    )
  })

  it("adds none of the passage regions", () => {
    const renderer = render([EXPERIENCE_QUOTE])

    expect(findText(renderer, "Read full passage")).toBeUndefined()
    expect(passageLinks(renderer)).toHaveLength(0)
  })

  // The four-line clamp belongs to the passage card, which has credit lines
  // below the verse to protect. An Experience card has none, so clamping it
  // would be a silent change to a surface this work does not own.
  it("leaves the verse unclamped on the Experience path", () => {
    const renderer = render([EXPERIENCE_QUOTE])

    const verse = findText(renderer, "For God so loved the world")
    expect(verse).toBeDefined()
    expect(verse?.props.numberOfLines).toBeUndefined()
  })
})

describe("fitPassageCardRegions", () => {
  const typography = computeTypographyScale(375)

  const full = {
    typography,
    hasVerse: true,
    hasTranslation: true,
    hasCopyright: true,
    hasLink: true,
  }

  it("keeps every region on an ordinary phone at the default text size", () => {
    expect(
      fitPassageCardRegions({ ...full, contentHeight: 303, fontScale: 1 }),
    ).toEqual({
      verseLines: VERSE_MAX_LINES,
      translation: true,
      copyright: true,
      link: true,
    })
  })

  // The reader's text size is the only thing that can overflow the square.
  it("drops the link first, then shortens the verse, before losing the credit", () => {
    const scaled = fitPassageCardRegions({
      ...full,
      contentHeight: 303,
      fontScale: 2,
    })

    expect(scaled.link).toBe(false)
    expect(scaled.verseLines).toBeLessThan(VERSE_MAX_LINES)
    expect(scaled.verseLines).toBeGreaterThan(0)
    // R5: a rendered verse carries its translation and copyright. Shortening
    // the verse is preferred to publishing it without its credit.
    expect(scaled.translation).toBe(true)
    expect(scaled.copyright).toBe(true)
  })

  it("sheds the credit lines only when even a one-line verse will not fit", () => {
    const cramped = fitPassageCardRegions({
      ...full,
      contentHeight: 90,
      fontScale: 2,
    })

    expect(cramped.link).toBe(false)
    expect(cramped.verseLines).toBe(1)
    expect(cramped.copyright).toBe(false)
  })

  it("requests no region the card does not carry", () => {
    expect(
      fitPassageCardRegions({
        contentHeight: 303,
        typography,
        fontScale: 1,
        hasVerse: false,
        hasTranslation: false,
        hasCopyright: false,
        hasLink: false,
      }),
    ).toEqual({
      verseLines: 0,
      translation: false,
      copyright: false,
      link: false,
    })
  })
})

describe("composeCardLabel", () => {
  it("joins a reference to its verse", () => {
    expect(composeCardLabel("Genesis 1:26-27", "God said…")).toBe(
      "Genesis 1:26-27: God said…",
    )
  })

  it("emits the reference alone when there is no verse", () => {
    expect(composeCardLabel("Genesis 1:26-27", "")).toBe("Genesis 1:26-27")
    expect(composeCardLabel("Genesis 1:26-27", "   ")).toBe("Genesis 1:26-27")
  })
})
