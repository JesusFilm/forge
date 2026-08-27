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
import { Dimensions } from "react-native"

import {
  CARD_CONTENT_PADDING,
  COPYRIGHT_MAX_LINES,
  LINK_MARGIN_TOP,
  LINK_MIN_TAP_HEIGHT,
  REFERENCE_MARGIN,
  REFERENCE_MAX_LINES,
  TRANSLATION_MARGIN,
  TRANSLATION_MAX_LINES,
  VERSE_MARGIN,
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

/**
 * Render at a specific screen width and reader text size. `useWindowDimensions`
 * reads `Dimensions.get("window")`, so overriding that is what lets a test reach
 * the cramped end of the fit, where the drop order actually fires.
 */
function renderAtSize(
  quotes: Quote[],
  size: { width: number; fontScale: number },
): TestInstance {
  const real = Dimensions.get
  const spy = jest
    .spyOn(Dimensions, "get")
    .mockImplementation((dim: Parameters<typeof real>[0]) =>
      dim === "window"
        ? {
            width: size.width,
            height: 800,
            scale: 3,
            fontScale: size.fontScale,
          }
        : real(dim),
    )
  try {
    return render(quotes)
  } finally {
    spy.mockRestore()
  }
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

  // The fit arithmetic reserves a fixed line count for EVERY region. A region
  // the renderer leaves unclamped can wrap past its budget, overflow the fixed
  // square, and — because content is bottom-aligned — get clipped off the TOP,
  // taking the reference with it. Each budget needs its matching clamp.
  it("clamps every budgeted region to the line count the fit reserves", () => {
    const renderer = render([
      {
        ...PASSAGE_QUOTE,
        reference: "1 Thessalonians 4:13-5:11",
        translation: "World English Bible British Edition",
      },
    ])

    expect(
      findText(renderer, "1 THESSALONIANS 4:13-5:11")?.props.numberOfLines,
    ).toBe(REFERENCE_MAX_LINES)
    expect(
      findText(renderer, "World English Bible British Edition")?.props
        .numberOfLines,
    ).toBe(TRANSLATION_MAX_LINES)
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

  // `BibleQuoteItem.text` is nullable in admin's schema and the shared
  // Experience fragment selects it raw, so this is the production shape — not a
  // defensive hypothetical. A render throw here replaces the WHOLE app with the
  // root error screen. Falsified by hand: `quote.text.length` throws on this.
  it("renders a card whose authored text is absent", () => {
    const renderer = render([{ ...EXPERIENCE_QUOTE, text: null }])

    expect(findText(renderer, "JOHN 3:16")).toBeDefined()
    expect(cardLabels(renderer)).toContain("John 3:16")
  })

  it("renders a card whose authored text key is missing entirely", () => {
    const withoutText: Quote = { ...EXPERIENCE_QUOTE }
    delete withoutText.text
    const renderer = render([withoutText])

    expect(findText(renderer, "JOHN 3:16")).toBeDefined()
  })

  // React Native maps numberOfLines={0} to UNSET, i.e. NO limit. So the fit's
  // "drop the verse" outcome must be honoured by the render gate, not passed
  // through as a line count — otherwise the one state that exists to prevent
  // overflow is the state that causes it. Falsified by hand: dropping the
  // `regions.verseLines > 0` gate renders the verse with numberOfLines={0}.
  it("renders no verse at all when the fit drops it", () => {
    const renderer = renderAtSize([PASSAGE_QUOTE], { width: 300, fontScale: 3 })

    const verse = findText(renderer, "Let’s make man in our image")
    expect(verse).toBeUndefined()
    expect(findText(renderer, "GENESIS 1:26-27")).toBeDefined()
  })

  it("never renders a verse with an unlimited line count", () => {
    for (const fontScale of [1, 1.35, 2, 2.6, 3, 3.5]) {
      const renderer = renderAtSize([PASSAGE_QUOTE], { width: 300, fontScale })
      const verse = findText(renderer, "Let’s make man in our image")
      if (verse) {
        expect(verse.props.numberOfLines).toBeGreaterThan(0)
      }
    }
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

  // R5: scripture never renders uncredited. When a one-line verse plus its
  // credit still will not fit, the VERSE goes and the card degrades to the
  // reference-only presentation an unresolved passage already produces.
  it("drops the verse rather than its credit when nothing else fits", () => {
    const cramped = fitPassageCardRegions({
      ...full,
      contentHeight: 230,
      fontScale: 2,
    })

    expect(cramped.link).toBe(false)
    expect(cramped.verseLines).toBe(0)
    expect(cramped.translation).toBe(true)
    expect(cramped.copyright).toBe(true)
  })

  // Past that point R5 no longer binds — it governs a RENDERED verse, and there
  // is none. The reference is what the remaining space must protect.
  it("sheds the credit too once there is no verse left to credit", () => {
    const tiny = fitPassageCardRegions({
      ...full,
      contentHeight: 90,
      fontScale: 2,
    })

    expect(tiny.verseLines).toBe(0)
    expect(tiny.link).toBe(false)
    expect(tiny.copyright).toBe(false)
    expect(tiny.translation).toBe(false)
  })

  // Sweep: no combination may publish verse text with either credit line
  // missing. This is the invariant, asserted over the whole reachable space
  // rather than at one sampled height.
  it("never renders a verse without both credit lines", () => {
    for (let contentHeight = 40; contentHeight <= 600; contentHeight += 10) {
      for (const fontScale of [1, 1.35, 2, 2.5, 3, 3.5]) {
        const regions = fitPassageCardRegions({
          ...full,
          contentHeight,
          fontScale,
        })
        if (regions.verseLines > 0) {
          expect(regions.translation).toBe(true)
          expect(regions.copyright).toBe(true)
        }
      }
    }
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

// The fit arithmetic reserves height using these constants. If the rendered
// styles ever stop matching them, every fit decision is wrong while the whole
// fit suite stays green — so read the numbers off the REAL rendered nodes.
describe("fit constants match the rendered styles", () => {
  // A Pressable's `style` is a function of its press state, not an array.
  function flatStyle(node: RenderedNode | undefined): Record<string, number> {
    const raw = node?.props.style
    const style =
      typeof raw === "function"
        ? (raw as (s: { pressed: boolean }) => unknown)({ pressed: false })
        : raw
    const parts = Array.isArray(style) ? style.flat(3) : [style]
    return Object.assign({}, ...parts.filter(Boolean)) as Record<string, number>
  }

  it("reserves the margins the card actually renders", () => {
    const renderer = render([PASSAGE_QUOTE])

    expect(flatStyle(findText(renderer, "GENESIS 1:26-27")).marginBottom).toBe(
      REFERENCE_MARGIN,
    )
    expect(
      flatStyle(findText(renderer, "Let’s make man in our image")).marginBottom,
    ).toBe(VERSE_MARGIN)
    expect(
      flatStyle(findText(renderer, "World English Bible British Edition"))
        .marginBottom,
    ).toBe(TRANSLATION_MARGIN)
  })

  it("reserves the link's tap target and the card's own padding", () => {
    const renderer = render([PASSAGE_QUOTE])
    const link = passageLinks(renderer)[0]
    const linkStyle = flatStyle(link)

    expect(linkStyle.marginTop).toBe(LINK_MARGIN_TOP)
    expect(linkStyle.minHeight).toBe(LINK_MIN_TAP_HEIGHT)

    const content = renderer.root.findAll(
      (node) => flatStyle(node).padding === CARD_CONTENT_PADDING,
    )
    expect(content.length).toBeGreaterThan(0)
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
