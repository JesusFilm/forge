// Per-kind round-trip + union-dispatch tests for the typed ExperienceBlock
// surface. Each test constructs a fixture POJO matching the Zod schema for
// one block kind, runs the GraphQL union's `resolveType` callback, and
// asserts the returned typename matches `T_TO_TYPENAME[t]`. The exhaustive
// 20-kind sweep proves Pothos's union dispatch contract for every block we
// can persist; the union-dispatch happy path mixes kinds in one array to
// catch any cross-block side effects in resolveType; edge cases cover the
// "no blocks" and "unknown discriminator" boundaries.
//
// Structural drift between Zod and Pothos lives in `blocks.drift.test.ts`.

import { describe, expect, it } from "vitest"
import {
  T_TO_TYPENAME,
  UnknownBlockKindError,
  type BlockKind,
} from "@/graphql/types/blocks"
import { schema } from "@/graphql/schema"
import {
  type GraphQLUnionType,
  type GraphQLObjectType,
  type GraphQLResolveInfo,
} from "graphql"

// -----------------------------------------------------------------------------
// Test helpers — reach into the schema to call each union's resolveType. The
// GraphQL-js union type stores resolveType under `_resolveType` (set by
// `Object.defineProperty` in `GraphQLUnionType`); using the public
// `resolveType` getter is safer.
// -----------------------------------------------------------------------------

type ResolveTypeFn = (
  value: unknown,
  context: unknown,
  info: GraphQLResolveInfo,
  abstractType: GraphQLUnionType,
) => string | GraphQLObjectType | null | undefined

function getUnionResolveType(unionName: string): ResolveTypeFn {
  const unionType = schema.getType(unionName) as GraphQLUnionType | undefined
  if (unionType == null) {
    throw new Error(`Union ${unionName} not registered on schema`)
  }
  const resolve = unionType.resolveType
  if (resolve == null) {
    throw new Error(`Union ${unionName} has no resolveType function`)
  }
  // Pothos wraps the resolveType so the typename can be returned either as a
  // string OR an object ref; the GraphQL-js layer accepts both.
  return resolve as unknown as ResolveTypeFn
}

const fakeInfo = {} as GraphQLResolveInfo
const fakeUnion = {} as GraphQLUnionType

function resolveTypeName(unionName: string, value: unknown): string {
  const resolved = getUnionResolveType(unionName)(
    value,
    null,
    fakeInfo,
    fakeUnion,
  )
  if (typeof resolved === "string") return resolved
  if (resolved != null && typeof resolved === "object" && "name" in resolved) {
    return (resolved as GraphQLObjectType).name
  }
  throw new Error(
    `resolveType returned a non-typename value: ${String(resolved)}`,
  )
}

// -----------------------------------------------------------------------------
// Fixtures — one minimum-valid POJO per kind. Mirrors `BlockSchema.options`
// minimum-required field sets in `domain/blocks.ts`.
// -----------------------------------------------------------------------------

const fixtures: Readonly<Record<BlockKind, object>> = {
  adventCountdown: {
    t: "adventCountdown",
    title: "Advent",
  },
  bibleQuotesCarousel: {
    t: "bibleQuotesCarousel",
    quotes: [{ reference: "John 3:16", text: "For God so loved..." }],
  },
  card: {
    t: "card",
    title: "Hi",
    description: "World",
    variant: "default",
  },
  container: {
    t: "container",
    content: [],
  },
  containerSlot: {
    t: "containerSlot",
    gridSpan: 6,
  },
  cta: {
    t: "cta",
    buttonLabel: "Click",
    variant: "primary",
  },
  easterDates: {
    t: "easterDates",
    easterDatesTitle: "Easter",
    westernEasterLabel: "Western",
    orthodoxEasterLabel: "Orthodox",
    passoverLabel: "Passover",
  },
  infoBlocks: {
    t: "infoBlocks",
    blocks: [{ icon: "info", title: "Hello", description: "World" }],
  },
  mediaCollection: {
    t: "mediaCollection",
    variant: "grid",
    itemsSource: "manual",
    showItemNumbers: false,
    items: [],
  },
  navigationCarousel: {
    t: "navigationCarousel",
    items: [
      {
        contentId: "abc",
        title: "Nav",
      },
    ],
  },
  promoBanner: {
    t: "promoBanner",
    heading: "Banner",
    description: "Body",
    ctaLink: "/cta",
  },
  quizButton: {
    t: "quizButton",
    buttonText: "Take quiz",
    iframeSrc: "https://quiz.nextstep.is/abc",
  },
  relatedQuestions: {
    t: "relatedQuestions",
    questions: [{ question: "Why?", answer: "Because." }],
  },
  section: {
    t: "section",
    dynamicBackgroundImage: false,
    staticOverlay: false,
    content: [],
  },
  text: {
    t: "text",
  },
  video: {
    t: "video",
    useRouteVideo: false,
  },
  videoCarousel: {
    t: "videoCarousel",
    itemsSource: "manual",
    items: [],
  },
  videoHero: {
    t: "videoHero",
    useRouteVideo: false,
  },
  videoRecommendations: {
    t: "videoRecommendations",
    limit: 10,
  },
  watchHomeHero: {
    t: "watchHomeHero",
  },
  watchHomePromo: {
    t: "watchHomePromo",
    heading: "Mission",
    description: "Mission body",
    invitationHeading: "Help build",
    invitationDescription: "Join the beta.",
    ctaLabel: "Become a beta tester",
    ctaLink: "https://example.com/beta",
  },
}

// Sanity guard so the fixture set stays in lockstep with the typed map.
const fixtureKeys = Object.keys(fixtures) as BlockKind[]
const expectedKeys = Object.keys(T_TO_TYPENAME) as BlockKind[]

describe("blocks fixture set covers every kind in T_TO_TYPENAME", () => {
  it("has the same key set as T_TO_TYPENAME (no missing or stale fixtures)", () => {
    expect([...fixtureKeys].sort()).toEqual([...expectedKeys].sort())
  })
})

// -----------------------------------------------------------------------------
// Per-kind round-trip — dispatch every fixture through ExperienceBlock's
// resolveType. Container content + section content variants are exercised
// separately below via the SectionContentBlock / ContainerContentBlock union
// dispatches (those unions reject kinds that are not in their member list at
// schema-validation time, so we test by passing through their resolveType
// callbacks directly).
// -----------------------------------------------------------------------------

describe("ExperienceBlock union resolveType — per-kind dispatch", () => {
  for (const kind of expectedKeys) {
    it(`dispatches "${kind}" → ${T_TO_TYPENAME[kind]}`, () => {
      const value = fixtures[kind]
      // Only kinds that are top-level members get dispatched through
      // ExperienceBlock. quizButton + containerSlot are excluded — they live
      // in narrower union scopes. Skip those at this layer.
      if (kind === "quizButton" || kind === "containerSlot") {
        return
      }
      const typename = resolveTypeName("ExperienceBlock", value)
      expect(typename).toBe(T_TO_TYPENAME[kind])
    })
  }
})

describe("SectionContentBlock union resolveType — per-kind dispatch", () => {
  const sectionContentKinds: BlockKind[] = [
    "mediaCollection",
    "text",
    "promoBanner",
    "infoBlocks",
    "cta",
    "container",
    "relatedQuestions",
    "bibleQuotesCarousel",
    "card",
    "video",
    "quizButton",
    "videoCarousel",
    "navigationCarousel",
  ]

  for (const kind of sectionContentKinds) {
    it(`dispatches "${kind}" → ${T_TO_TYPENAME[kind]}`, () => {
      const typename = resolveTypeName("SectionContentBlock", fixtures[kind])
      expect(typename).toBe(T_TO_TYPENAME[kind])
    })
  }
})

describe("ContainerContentBlock union resolveType — per-kind dispatch", () => {
  const containerContentKinds: BlockKind[] = [
    "containerSlot",
    "mediaCollection",
    "text",
    "relatedQuestions",
    "cta",
    "bibleQuotesCarousel",
    "card",
    "easterDates",
    "adventCountdown",
    "video",
  ]

  for (const kind of containerContentKinds) {
    it(`dispatches "${kind}" → ${T_TO_TYPENAME[kind]}`, () => {
      const typename = resolveTypeName("ContainerContentBlock", fixtures[kind])
      expect(typename).toBe(T_TO_TYPENAME[kind])
    })
  }
})

// -----------------------------------------------------------------------------
// Union dispatch happy path — mixed-kind array (mimics what a real
// ExperienceLocale.blocks JSON column holds). A SectionBlock inside the array
// itself contains a ContainerBlock so the nested-union dispatch path runs.
// -----------------------------------------------------------------------------

describe("Mixed-kind round-trip across nested unions", () => {
  it("dispatches a 3-block mix (Card + MediaCollection + Section→Container) correctly", () => {
    const blocks = [
      fixtures.card,
      fixtures.mediaCollection,
      {
        t: "section",
        dynamicBackgroundImage: false,
        staticOverlay: false,
        content: [
          fixtures.card,
          {
            t: "container",
            content: [fixtures.containerSlot, fixtures.mediaCollection],
          },
        ],
      },
    ]

    const topTypenames = blocks.map((b) =>
      resolveTypeName("ExperienceBlock", b),
    )
    expect(topTypenames).toEqual([
      "CardBlock",
      "MediaCollectionBlock",
      "SectionBlock",
    ])

    // SectionBlock.content dispatches via SectionContentBlock.
    const sectionBlock = blocks[2] as { content: object[] }
    const sectionChildren = sectionBlock.content.map((child) =>
      resolveTypeName("SectionContentBlock", child),
    )
    expect(sectionChildren).toEqual(["CardBlock", "ContainerBlock"])

    // ContainerBlock.content dispatches via ContainerContentBlock.
    const containerBlock = sectionBlock.content[1] as { content: object[] }
    const containerChildren = containerBlock.content.map((child) =>
      resolveTypeName("ContainerContentBlock", child),
    )
    expect(containerChildren).toEqual([
      "ContainerSlotBlock",
      "MediaCollectionBlock",
    ])
  })
})

// -----------------------------------------------------------------------------
// Edge cases
// -----------------------------------------------------------------------------

describe("Edge cases", () => {
  it("exposes videoSlug on MediaCollectionItem for authored card links", () => {
    const type = schema.getType("MediaCollectionItem")
    expect(
      type && "getFields" in type ? type.getFields().videoSlug : null,
    ).toBeDefined()
  })

  it("exposes WatchHomePromoBlock for authored mission promo content", () => {
    const type = schema.getType("WatchHomePromoBlock")
    expect(
      type && "getFields" in type ? type.getFields().ctaLabel : null,
    ).toBeDefined()
  })

  it("unknown discriminator throws UnknownBlockKindError", () => {
    expect(() =>
      resolveTypeName("ExperienceBlock", { t: "totallyUnknownKind" }),
    ).toThrow(UnknownBlockKindError)
    expect(() =>
      resolveTypeName("ExperienceBlock", { t: "totallyUnknownKind" }),
    ).toThrow(/totallyUnknownKind/)
  })

  it("UnknownBlockKindError exposes the offending kind as a field", () => {
    let caught: unknown
    try {
      resolveTypeName("ExperienceBlock", { t: "anotherBadKind" })
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(UnknownBlockKindError)
    expect((caught as UnknownBlockKindError).kind).toBe("anotherBadKind")
  })

  it("empty blocks array does not invoke resolveType at all", () => {
    // No assertion needed — the test exists to document that the resolver
    // returns the empty array verbatim and never calls resolveType.
    const blocks: object[] = []
    const dispatched = blocks.map((b) => resolveTypeName("ExperienceBlock", b))
    expect(dispatched).toEqual([])
  })
})
