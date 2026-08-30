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

/**
 * The suite had no image-library mock and so had never rendered the image
 * branch at all. A jest.fn component is the assertion surface: zero calls means
 * no image element, which is what stops the prop cases below passing against an
 * absent node. `prefetch` is a module static the carousel calls directly.
 */
const mockImage = jest.fn((_props: Record<string, unknown>) => null)
const mockPrefetch = jest.fn((..._args: unknown[]) => Promise.resolve(true))
jest.mock("expo-image", () => {
  const Image = (props: Record<string, unknown>) => mockImage(props)
  Image.prefetch = (...args: unknown[]) => mockPrefetch(...args)
  return { __esModule: true, Image }
})

const mockWarn = jest.fn()
jest.mock("../../../lib/datadog", () => ({
  datadogLog: { info: jest.fn(), warn: (...a: unknown[]) => mockWarn(...a) },
}))

import { act } from "react"
import type React from "react"
import { AccessibilityInfo, Dimensions } from "react-native"

import {
  CARD_CONTENT_PADDING,
  COPYRIGHT_MAX_LINES,
  LINK_MARGIN_TOP,
  LINK_MIN_TAP_HEIGHT,
  REFERENCE_MARGIN,
  REFERENCE_MAX_LINES,
  SCRIM_MAX_SOLID_STOP,
  TRANSLATION_MARGIN,
  TRANSLATION_MAX_LINES,
  VERSE_FONT_SIZE_INCREASE,
  VERSE_MARGIN,
  VERSE_MAX_LINES,
  composeCardLabel,
  fitPassageCardRegions,
  passageCardStackHeight,
  scrimRampStart,
  verseTypography,
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

function sectionOf(quotes: Quote[]): AdminBlock {
  return {
    __typename: "BibleQuotesCarouselBlock",
    heading: "Bible Quotes",
    quotes,
  } as unknown as AdminBlock
}

/**
 * Every renderer is torn down after its test. The card subscribes to the OS
 * reduce-motion setting, so a renderer left mounted re-renders when that read
 * resolves — inside the NEXT test's `act`, where its props land in the image
 * mock ahead of the card actually under test.
 */
const mounted: TestInstance[] = []

function render(
  quotes: Quote[],
  onArtworkFailed?: (cardIndex: number, failedUrl: string) => void,
): TestInstance {
  let renderer!: TestInstance
  act(() => {
    renderer = TestRenderer.create(
      (
        <BibleQuotesCarouselRenderer
          section={sectionOf(quotes)}
          onArtworkFailed={onArtworkFailed}
        />
      ) as React.ReactElement,
    )
  })
  mounted.push(renderer)
  return renderer
}

/** Lets the reduce-motion read resolve before anything is asserted. */
async function renderSettled(
  quotes: Quote[],
  onArtworkFailed?: (cardIndex: number, failedUrl: string) => void,
): Promise<TestInstance> {
  let renderer!: TestInstance
  await act(async () => {
    renderer = TestRenderer.create(
      (
        <BibleQuotesCarouselRenderer
          section={sectionOf(quotes)}
          onArtworkFailed={onArtworkFailed}
        />
      ) as React.ReactElement,
    )
  })
  mounted.push(renderer)
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

/** A Pressable's `style` is a function of its press state, not an array. */
function flatStyle(node: RenderedNode | undefined): Record<string, number> {
  const raw = node?.props.style
  const style =
    typeof raw === "function"
      ? (raw as (s: { pressed: boolean }) => unknown)({ pressed: false })
      : raw
  const parts = Array.isArray(style) ? style.flat(3) : [style]
  return Object.assign({}, ...parts.filter(Boolean)) as Record<string, number>
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

  it("renders scripture upright, bold, and larger than the body copy", () => {
    const renderer = render([PASSAGE_QUOTE])
    const verse = findText(renderer, "Let’s make man in our image")
    const style = flatStyle(verse)
    const typography = computeTypographyScale(
      Dimensions.get("window").width as number,
    )

    expect(style.fontStyle).not.toBe("italic")
    expect(style.fontWeight).toBe("700")
    expect(style.fontSize).toBe(
      typography.body.fontSize + VERSE_FONT_SIZE_INCREASE,
    )
    expect(style.fontSize).toBe(verseTypography(typography).fontSize)
    expect(style.lineHeight).toBe(verseTypography(typography).lineHeight)
  })

  // The fit budgets the verse by its line height. If the rendered line height
  // ever stops matching what `verseTypography` returns, every fit decision is
  // wrong and the card overflows with no test to catch it.
  it("draws the verse at exactly the line height the fit reserves for it", () => {
    for (const width of [375, 393, 430]) {
      const renderer = renderAtSize([PASSAGE_QUOTE], { width, fontScale: 1 })
      const style = flatStyle(findText(renderer, "Let’s make man in our image"))
      const expected = verseTypography(computeTypographyScale(width))

      expect(style.fontSize).toBe(expected.fontSize)
      expect(style.lineHeight).toBe(expected.lineHeight)
    }
  })

  // Covers R14: the Experience path keeps today's presentation.
  it("leaves the Experience verse italic at body size", () => {
    const renderer = render([EXPERIENCE_QUOTE])
    const style = flatStyle(findText(renderer, "For God so loved the world"))
    const typography = computeTypographyScale(
      Dimensions.get("window").width as number,
    )

    expect(style.fontStyle).toBe("italic")
    expect(style.fontWeight).toBeUndefined()
    expect(style.fontSize).toBe(typography.body.fontSize)
  })

  it("renders the reference unbold", () => {
    const renderer = render([PASSAGE_QUOTE])
    const style = flatStyle(findText(renderer, "GENESIS 1:26-27"))

    expect(style.fontWeight).toBeUndefined()
    expect(style.letterSpacing).toBe(1.5)
  })

  // Card artwork is not chosen for contrast — the Psalm 19 frame is near-white
  // — and the gradient scrim only covers the lower part. EVERY text node needs
  // its own separation, so this asserts over all of them rather than a sample:
  // a future style edit that adds a region without the shadow goes red.
  it("gives every text node on the card a drop shadow", () => {
    const renderer = render([PASSAGE_QUOTE])
    // The section heading sits above the carousel on the page background, not
    // on card artwork, so it is not in scope.
    const texts = textNodes(renderer).filter(
      (node) =>
        String(node.props.children).trim().length > 0 &&
        node.props.accessibilityRole !== "header",
    )

    expect(texts.length).toBeGreaterThanOrEqual(5)
    for (const node of texts) {
      const style = flatStyle(node)
      expect(style.textShadowColor).toBeDefined()
      expect(style.textShadowRadius).toBeGreaterThan(0)
    }
  })

  it("gives the promotional card's text the same shadow", () => {
    const renderer = render([
      {
        reference: "FREE RESOURCES",
        text: "Want to explore life's biggest questions?",
        ctaLabel: "Join Our Bible Study",
        ctaLink: "https://join.bsfinternational.org/",
      },
    ])

    const cta = findText(renderer, "Join Our Bible Study")
    expect(flatStyle(cta).textShadowColor).toBeDefined()
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

// ── Card artwork ────────────────────────────────────────────────────────────

const STILL_A =
  "https://image.mux.com/playbackA/thumbnail.webp?width=800&height=800&fit_mode=smartcrop&time=140.00"
const STILL_B =
  "https://image.mux.com/playbackA/thumbnail.webp?width=800&height=800&fit_mode=smartcrop&time=420.00"
const STOCK_A = "https://images.unsplash.com/photo-1480869799327?q=80&w=800"

/** A watch-page card that resolved the top rung of the ladder. */
function stillQuote(overrides: Quote = {}): Quote {
  return {
    ...PASSAGE_QUOTE,
    imageUrl: STILL_A,
    artCandidates: [STILL_A, STOCK_A],
    artIndex: 0,
    ...overrides,
  }
}

function imageProps(): Record<string, unknown> | undefined {
  return mockImage.mock.calls[0]?.[0]
}

/** The rendered scrim, read off the tree rather than off a duplicated constant. */
function scrim(renderer: TestInstance) {
  const node = renderer.root.findAll((n) => Array.isArray(n.props.colors))[0]
  const colors = node?.props.colors as string[] | undefined
  const locations = node?.props.locations as number[] | undefined
  if (colors == null || locations == null) throw new Error("no scrim rendered")
  return { colors, locations }
}

type Rgba = { r: number; g: number; b: number; a: number }

function parseColor(value: string): Rgba {
  const rgba = /^rgba?\(([^)]+)\)$/.exec(value.trim())
  if (rgba?.[1] != null) {
    const parts = rgba[1].split(",").map((p) => Number(p.trim()))
    return {
      r: parts[0] ?? 0,
      g: parts[1] ?? 0,
      b: parts[2] ?? 0,
      a: parts[3] ?? 1,
    }
  }
  const hex = value.replace("#", "")
  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16),
    a: 1,
  }
}

const channel = (c: number) => {
  const v = c / 255
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
}
const luminance = (c: Rgba) =>
  0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b)

function composite(fg: Rgba, bg: Rgba): Rgba {
  return {
    r: fg.a * fg.r + (1 - fg.a) * bg.r,
    g: fg.a * fg.g + (1 - fg.a) * bg.g,
    b: fg.a * fg.b + (1 - fg.a) * bg.b,
    a: 1,
  }
}

function contrast(a: Rgba, b: Rgba): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05)
}

/** The colour each named text region actually rendered with. */
function regionColor(renderer: TestInstance, needle: string): Rgba {
  const node = findText(renderer, needle)
  const color = flatStyle(node).color as unknown as string
  if (typeof color !== "string") throw new Error(`no colour on "${needle}"`)
  return parseColor(color)
}

beforeEach(() => {
  mockImage.mockClear()
  mockPrefetch.mockClear()
  mockWarn.mockClear()
  // The card reads the OS reduce-motion setting asynchronously. Left to
  // resolve, it lands a state update outside `act` in every synchronous case
  // here. The two cases that care about the setting override this and await.
  jest
    .spyOn(AccessibilityInfo, "isReduceMotionEnabled")
    .mockReturnValue(new Promise<boolean>(() => {}))
})

afterEach(() => {
  act(() => {
    mounted.splice(0).forEach((renderer) => renderer.unmount())
  })
  jest.restoreAllMocks()
})

describe("BibleQuotesCarouselRenderer — card artwork", () => {
  it("renders an image element when the card has a candidate", () => {
    // Anti-vacuous: every prop assertion below reads mock call zero, which
    // would be undefined — and silently absent — without this.
    render([stillQuote()])
    expect(mockImage).toHaveBeenCalledTimes(1)
    expect(imageProps()?.source).toBe(STILL_A)
  })

  it("renders no image element and no broken frame when there is no candidate", () => {
    render([{ ...PASSAGE_QUOTE, imageUrl: null, artCandidates: [] }])
    expect(mockImage).not.toHaveBeenCalled()
  })

  it("clears 4.5:1 for all four text regions over the worst still (AE13)", () => {
    const renderer = render([stillQuote()])
    const { colors, locations } = scrim(renderer)

    // The scrim's SOLID stop is the card colour, and the whole text stack sits
    // below it, so a pure-white still never reaches any text pixel.
    const solid = parseColor(colors[2] as string)
    const regions: Array<[string, Rgba]> = [
      ["verse", regionColor(renderer, "Let’s make man")],
      ["reference", regionColor(renderer, "GENESIS 1:26-27")],
      ["translation", regionColor(renderer, "World English Bible")],
      ["copyright", regionColor(renderer, "Public Domain")],
    ]
    for (const [name, color] of regions) {
      const ratio = contrast(composite(color, solid), solid)
      expect({ name, ratio: ratio >= 4.5 }).toEqual({ name, ratio: true })
    }

    // R9: non-zero from the card's TOP edge, so no still renders at full
    // strength anywhere.
    expect(locations[0]).toBe(0)
    expect(parseColor(colors[0] as string).a).toBeGreaterThan(0)
  })

  it("puts the scrim's solid stop at or above the top of the text stack", () => {
    // This geometry is what makes the contrast case above hold for ANY still
    // rather than for one sampled frame.
    const width = 390
    const cardWidth = Math.round(width - 32)
    const renderer = renderAtSize([stillQuote()], { width, fontScale: 1 })
    const { locations } = scrim(renderer)

    // The SCREEN WIDTH the component itself reads, not a scale factor:
    // `computeTypographyScale` takes a width, so passing 1 here would clamp to
    // the smallest type, inflate the expected stack top, and let any real stop
    // satisfy the assertion.
    const fitInput = {
      contentHeight: cardWidth - CARD_CONTENT_PADDING * 2,
      typography: computeTypographyScale(width),
      fontScale: 1,
      hasVerse: true,
      hasTranslation: true,
      hasCopyright: true,
      hasLink: true,
    }
    const stackTop =
      (cardWidth -
        CARD_CONTENT_PADDING -
        passageCardStackHeight(fitInput, fitPassageCardRegions(fitInput))) /
      cardWidth

    // Equality, not an upper bound: with the component's own typography the
    // rendered stop IS the stack top, and `<=` would still pass if the geometry
    // silently drifted lower.
    expect(locations[2]).toBeCloseTo(stackTop, 10)
    expect(locations[2]).toBeGreaterThan(0)
  })

  it("holds the veil until one band above the text, rather than ramping from the edge", () => {
    // The still occupies the region ABOVE the text. Ramping across all of it
    // would leave the artwork already half-buried by mid-card; the transition
    // belongs in a band immediately above the words it protects.
    const renderer = render([{ reference: "John 3:16", text: null }])
    const { colors, locations } = scrim(renderer)

    expect(colors).toHaveLength(3)
    // The first two stops are the SAME colour — that is what holds the veil.
    expect(colors[0]).toBe(colors[1])
    expect(locations).toHaveLength(3)
    expect(locations[0]).toBe(0)
    expect(locations[1]).toBeCloseTo(scrimRampStart(locations[2] as number), 10)
    // A real card leaves a band of still at the light top value.
    expect(locations[1] as number).toBeGreaterThan(0)
  })

  it("never lets the scrim sit lighter than the fixed stop it replaced", () => {
    // A card with almost no text would otherwise push the solid point far down
    // and leave a bright still fighting the reference.
    const renderer = render([
      { reference: "John 3:16", text: null, imageUrl: STILL_A },
    ])
    expect(scrim(renderer).locations[2]).toBeLessThanOrEqual(
      SCRIM_MAX_SOLID_STOP,
    )
  })

  it("pins the image to the memory and disk cache tiers", () => {
    render([stillQuote()])
    expect(imageProps()?.cachePolicy).toBe("memory-disk")
  })

  it("ranks the card image below the player it competes with", () => {
    render([stillQuote()])
    expect(imageProps()?.priority).toBe("low")
  })

  it("fades the still in over an explicit duration", async () => {
    jest
      .spyOn(AccessibilityInfo, "isReduceMotionEnabled")
      .mockResolvedValue(false)
    await renderSettled([stillQuote()])
    // `.at(-1)`, not call zero: the first render still carries the hook's
    // initial false, so reading it would pass without the resolved value ever
    // being exercised.
    expect(mockImage.mock.calls.at(-1)?.[0]?.transition).toBe(200)
  })

  it("snaps rather than fades when reduce motion is on (AE8)", async () => {
    jest
      .spyOn(AccessibilityInfo, "isReduceMotionEnabled")
      .mockResolvedValue(true)
    await renderSettled([stillQuote()])

    // A NUMBER, not an object without a duration: the transition record
    // defaults to 100ms on iOS and 0 on Android, so the object form would fade
    // on iOS and not at all on Android — and an iOS-only check would pass.
    const last = mockImage.mock.calls.at(-1)?.[0]
    expect(last?.transition).toBe(0)
  })

  it("keys recycling off the resolved source, not the reference label (AE9)", () => {
    // Two citations really can resolve to one label; keying on it would tell
    // the list the two cards are the same image.
    render([
      stillQuote({ imageUrl: STILL_A, artCandidates: [STILL_A] }),
      stillQuote({ imageUrl: STILL_B, artCandidates: [STILL_B] }),
    ])
    const keys = mockImage.mock.calls.map((call) => call[0]?.recyclingKey)
    expect(keys).toEqual([STILL_A, STILL_B])
    expect(new Set(keys).size).toBe(2)
  })

  it("renders a ladder-resolved URL byte-identically (KTD12)", () => {
    // The render-time validator is idempotent on an absolute URL, which is why
    // keeping it for the Experience and SDUI paths costs this path nothing.
    render([stillQuote()])
    expect(imageProps()?.source).toBe(STILL_A)
  })

  it("hides the still from assistive technology (AE14)", () => {
    const renderer = render([stillQuote()])
    expect(imageProps()?.accessible).toBe(false)
    expect(imageProps()?.accessibilityLabel).toBeUndefined()

    // The card is one grouped element and announces itself once.
    expect(cardLabels(renderer)).toContain(
      composeCardLabel("Genesis 1:26-27", String(PASSAGE_QUOTE.text)),
    )
  })

  it("reports a load failure upward rather than holding its own tier (AE11)", () => {
    const onArtworkFailed = jest.fn()
    render([stillQuote()], onArtworkFailed)

    act(() => {
      ;(imageProps()?.onError as () => void)()
    })
    expect(onArtworkFailed).toHaveBeenCalledWith(0, STILL_A)
  })

  it("emits the exhaustion signal once when the last rung fails", () => {
    const onArtworkFailed = jest.fn()
    render(
      [
        stillQuote({
          imageUrl: STOCK_A,
          artCandidates: [STOCK_A],
          artIndex: 0,
        }),
      ],
      onArtworkFailed,
    )

    act(() => {
      ;(imageProps()?.onError as () => void)()
    })

    expect(mockWarn).toHaveBeenCalledTimes(1)
    expect(mockWarn.mock.calls[0]?.[0]).toBe("bible_card_art.exhausted")
  })

  it("emits the exhaustion signal once when one load reports twice", () => {
    // SDWebImage's completion closure can call `onError` more than once for a
    // single failed load. Both calls land in the same render pass, reading the
    // same props, so the terminal check alone would double-count the only
    // signal that distinguishes an exhausted card from a loading one.
    const onArtworkFailed = jest.fn()
    render(
      [
        stillQuote({
          imageUrl: STOCK_A,
          artCandidates: [STOCK_A],
          artIndex: 0,
        }),
      ],
      onArtworkFailed,
    )

    act(() => {
      const onError = imageProps()?.onError as () => void
      onError()
      onError()
    })

    expect(mockWarn).toHaveBeenCalledTimes(1)
  })

  it("stays quiet when a failure still has somewhere to fall to", () => {
    render([stillQuote()], jest.fn())
    act(() => {
      ;(imageProps()?.onError as () => void)()
    })
    expect(mockWarn).not.toHaveBeenCalled()
  })

  it("reports nothing for a card that never entered the ladder", () => {
    const onArtworkFailed = jest.fn()
    // The Experience path: an image field, but no candidate list behind it.
    render([{ ...EXPERIENCE_QUOTE, imageUrl: STOCK_A }], onArtworkFailed)

    act(() => {
      ;(imageProps()?.onError as () => void)()
    })
    expect(onArtworkFailed).not.toHaveBeenCalled()
    expect(mockWarn).not.toHaveBeenCalled()
  })
})

describe("BibleQuotesCarouselRenderer — the Experience parity gap", () => {
  it("renders no image for a quote carrying admin's own artwork field", () => {
    // Admin's quote item defines `imageAsset` and `backgroundImageAsset`; this
    // renderer reads `imageUrl`, which the type does not define. Pinning
    // today's behaviour, NOT endorsing it — closing the gap is out of scope.
    render([{ ...EXPERIENCE_QUOTE, imageAsset: STOCK_A }])
    expect(mockImage).not.toHaveBeenCalled()
  })

  it("still resolves and validates an image field that does arrive", () => {
    render([{ ...EXPERIENCE_QUOTE, imageUrl: "javascript:alert(1)" }])
    expect(mockImage).not.toHaveBeenCalled()

    render([{ ...EXPERIENCE_QUOTE, imageUrl: STOCK_A }])
    expect(imageProps()?.source).toBe(STOCK_A)
  })
})

describe("BibleQuotesCarouselRenderer — bounded prefetch", () => {
  /** Every card carries its own still, which is the shape a real video has. */
  function carousel(count: number, overrides: Quote = {}): Quote[] {
    return Array.from({ length: count }, (_, i) =>
      stillQuote({
        reference: `Psalm ${i + 1}:1`,
        imageUrl: `https://image.mux.com/p/thumbnail.webp?time=${i}.00`,
        artCandidates: [`https://image.mux.com/p/thumbnail.webp?time=${i}.00`],
        ...overrides,
      }),
    )
  }

  const settleCard = (index: number) =>
    act(() => {
      ;(mockImage.mock.calls[index]?.[0]?.onLoad as () => void)()
    })

  it("issues no prefetch before the visible card has settled", () => {
    render(carousel(3))
    // The API takes no priority, so ordering behind the visible card's own load
    // is the only thing keeping an off-screen still from outranking it.
    expect(mockPrefetch).not.toHaveBeenCalled()
  })

  it("prefetches the next card's still once the visible one settles", () => {
    render(carousel(3))
    settleCard(0)

    expect(mockPrefetch).toHaveBeenCalledTimes(1)
    expect(mockPrefetch.mock.calls[0]?.[0]).toEqual([
      "https://image.mux.com/p/thumbnail.webp?time=1.00",
    ])
  })

  it("prefetches with the cache policy the render itself uses", () => {
    render(carousel(3))
    settleCard(0)
    expect(mockPrefetch.mock.calls[0]?.[1]).toEqual({
      cachePolicy: "memory-disk",
    })
  })

  it("does not re-issue a request for a card already prefetched", () => {
    render(carousel(3))
    settleCard(0)
    settleCard(0)
    settleCard(1)
    expect(mockPrefetch).toHaveBeenCalledTimes(1)
  })

  it("issues nothing at the end of the carousel rather than an empty list", () => {
    // `Image.prefetch` never settles when handed an empty array — both native
    // implementations resolve only from inside a per-URL callback.
    render(carousel(1))
    settleCard(0)
    expect(mockPrefetch).not.toHaveBeenCalled()
  })

  it("issues nothing for a video whose ladder yields no artwork", () => {
    render([
      { ...PASSAGE_QUOTE, imageUrl: null, artCandidates: [] },
      { ...PASSAGE_QUOTE, imageUrl: null, artCandidates: [] },
    ])
    expect(mockPrefetch).not.toHaveBeenCalled()
  })

  it("prefetches when the visible card errors rather than loads", () => {
    render(carousel(3), jest.fn())
    act(() => {
      ;(mockImage.mock.calls[0]?.[0]?.onError as () => void)()
    })
    expect(mockPrefetch).toHaveBeenCalledTimes(1)
  })

  it("prefetches immediately when the visible card has nothing to load", () => {
    // A held card is settled by construction: waiting on an image it will never
    // request would suppress the prefetch for the rest of the session.
    render([
      { ...PASSAGE_QUOTE, imageUrl: null, artCandidates: [] },
      ...carousel(1),
    ])
    expect(mockPrefetch).toHaveBeenCalledTimes(1)
  })

  it("releases the gate on a load that never settles, and not before", () => {
    jest.useFakeTimers()
    try {
      render(carousel(3))
      // Asserted in BOTH directions: absence alone would pass against a
      // prefetch that never fires at all.
      expect(mockPrefetch).not.toHaveBeenCalled()

      act(() => {
        jest.advanceTimersByTime(3000)
      })
      expect(mockPrefetch).toHaveBeenCalledTimes(1)
    } finally {
      jest.useRealTimers()
    }
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
