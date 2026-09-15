/**
 * The scrim treatment's rendered geometry. Its own file because the treatment
 * is a module constant: mocking it per-file is what keeps BOTH backdrops
 * render-tested, so shipping either one cannot silently delete the other's guard.
 */

jest.mock("../../../lib/bibleCardTreatment", () => ({
  ...jest.requireActual("../../../lib/bibleCardTreatment"),
  CARD_TREATMENT: "scrim",
}))

jest.mock("../../../lib/openPassageSheet", () => ({
  openPassageSheet: jest.fn(),
}))

const mockImage = jest.fn((_props: Record<string, unknown>) => null)
jest.mock("expo-image", () => {
  const Image = (props: Record<string, unknown>) => mockImage(props)
  Image.prefetch = () => Promise.resolve(true)
  return { __esModule: true, Image }
})

jest.mock("../../../lib/datadog", () => ({
  datadogLog: { info: jest.fn(), warn: jest.fn() },
}))

import { act } from "react"
import type React from "react"
import { AccessibilityInfo, Dimensions } from "react-native"

import {
  CARD_CONTENT_PADDING,
  SCRIM_MAX_SOLID_STOP,
  fitPassageCardRegions,
  passageCardStackHeight,
  scrimRampStart,
} from "../../../lib/bibleCardFit"
import { computeTypographyScale } from "../../../hooks/useTypography"
import { BibleQuotesCarouselRenderer } from "../BibleQuotesCarouselRenderer"
import {
  TestRenderer,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"
import type { AdminBlock } from "../../../lib/queries"

type Quote = Record<string, unknown>

const STILL_A =
  "https://image.mux.com/playbackA/thumbnail.webp?width=800&height=800&fit_mode=smartcrop&time=140.00"

const PASSAGE_QUOTE: Quote = {
  reference: "Genesis 1:26-27",
  text: "God said, “Let’s make man in our image, after our likeness.”",
  attribution: null,
  imageUrl: STILL_A,
  artCandidates: [STILL_A],
  artIndex: 0,
  backgroundColor: null,
  ctaLabel: null,
  ctaLink: null,
  translation: "World English Bible British Edition",
  copyright: "Public Domain",
  passageUrl: "https://www.bible.com/bible/206/GEN.1.26-GEN.1.27.WEBBE",
  loading: false,
}

function sectionOf(quotes: Quote[]): AdminBlock {
  return {
    __typename: "BibleQuotesCarouselBlock",
    heading: "Bible Quotes",
    quotes,
  } as unknown as AdminBlock
}

const mounted: TestInstance[] = []

function render(quotes: Quote[]): TestInstance {
  let renderer!: TestInstance
  act(() => {
    renderer = TestRenderer.create(
      (
        <BibleQuotesCarouselRenderer section={sectionOf(quotes)} />
      ) as React.ReactElement,
    )
  })
  mounted.push(renderer)
  return renderer
}

/** Renders at a screen width, which is what picks the typography the fit uses. */
function renderAtSize(quotes: Quote[], width: number): TestInstance {
  const real = Dimensions.get
  const spy = jest
    .spyOn(Dimensions, "get")
    .mockImplementation((dim: Parameters<typeof real>[0]) =>
      dim === "window"
        ? { width, height: 800, scale: 3, fontScale: 1 }
        : real(dim),
    )
  try {
    return render(quotes)
  } finally {
    spy.mockRestore()
  }
}

function scrim(renderer: TestInstance) {
  const node = renderer.root.findAll((n) => Array.isArray(n.props.colors))[0]
  const colors = node?.props.colors as string[] | undefined
  const locations = node?.props.locations as number[] | undefined
  if (colors == null || locations == null) throw new Error("no scrim rendered")
  return { colors, locations }
}

function alphaOf(value: string): number {
  const rgba = /^rgba?\(([^)]+)\)$/.exec(value.trim())
  if (rgba?.[1] == null) return 1
  return Number(rgba[1].split(",")[3]?.trim() ?? 1)
}

beforeEach(() => {
  mockImage.mockClear()
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

describe("BibleQuotesCarouselRenderer — scrim geometry", () => {
  it("renders the gradient rather than the frosted tint", () => {
    // Anti-vacuous: without this, every case below would pass by construction
    // if the treatment mock stopped taking effect.
    expect(scrim(render([PASSAGE_QUOTE])).colors).toHaveLength(3)
  })

  it("puts the scrim's solid stop at or above the top of the text stack", () => {
    const width = 390
    const cardWidth = Math.round(width - 32)
    const renderer = renderAtSize([PASSAGE_QUOTE], width)
    const { locations } = scrim(renderer)

    // The SCREEN WIDTH the component itself reads, not a scale factor:
    // `computeTypographyScale` takes a width, so passing 1 here would clamp to
    // the smallest type and let any real stop satisfy the assertion.
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
    // would leave the artwork already half-buried by mid-card.
    const renderer = render([{ ...PASSAGE_QUOTE, text: null }])
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
    const renderer = render([{ ...PASSAGE_QUOTE, text: null }])
    expect(scrim(renderer).locations[2]).toBeLessThanOrEqual(
      SCRIM_MAX_SOLID_STOP,
    )
  })

  it("dims the still from the card's very top edge (R9)", () => {
    const { colors, locations } = scrim(render([PASSAGE_QUOTE]))
    expect(locations[0]).toBe(0)
    expect(alphaOf(colors[0] as string)).toBeGreaterThan(0)
  })
})
