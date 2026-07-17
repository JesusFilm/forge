import {
  buildVideoByCoreIdIndex,
  type WatchHomeVideoInput,
} from "../watchHome/model"
import type { WatchHomeModel } from "../watchHome/model"
import { initialRotationState } from "./languageRotation"
import {
  CREDITS_TAIL_SECONDS,
  EXCERPT_MAX_SECONDS,
  EXCERPT_MIN_SECONDS,
  SHOWCASE_STATS_SECTION_TITLE,
  buildFallbackChapters,
  parseShowcaseExperience,
  resolveExcerptStream,
  resolveExcerptWindow,
  resolveShowcaseSource,
  type ShowcaseExperienceBlock,
} from "./sourceResolution"

// ── Fixtures ────────────────────────────────────────────────────────
// Hydrated pool records, shaped as the lean `WatchHomeVideo` bulk fragment returns
// them (no dubs — the 9.5MB rule; streams resolve per-video at selection time).

function poolVideo(
  coreId: string,
  overrides: Partial<WatchHomeVideoInput> = {},
): WatchHomeVideoInput {
  return {
    documentId: `doc-${coreId}`,
    coreId,
    slug: `${coreId}-slug`,
    label: "SHORT_FILM",
    durationSeconds: 120,
    images: [{ mobileCinematicHigh: `https://img/${coreId}.jpg` }],
    locales: [{ title: `Title ${coreId}` }],
    ...overrides,
  }
}

function mediaCollection(
  title: string,
  coreIds: readonly (string | null)[],
  overrides: Record<string, unknown> = {},
): ShowcaseExperienceBlock {
  return {
    __typename: "MediaCollectionBlock",
    sectionKey: `key-${title}`,
    mcTitle: title,
    items: coreIds.map((coreId) => ({ coreId })),
    ...overrides,
  } as ShowcaseExperienceBlock
}

const emptyModel: WatchHomeModel = {
  featured: [],
  sections: [],
  missingData: [],
}

function modelWithCards(cards: WatchHomeModel["featured"]): WatchHomeModel {
  return { featured: cards, sections: [], missingData: [] }
}

// A pool card as normalizeCard emits it — rawLabel is the WIRE enum, which is what
// the fallback's short-form preference must branch on (never display text).
function poolCard(
  coreId: string,
  rawLabel: string,
  overrides: Partial<WatchHomeModel["featured"][number]> = {},
): WatchHomeModel["featured"][number] {
  return {
    id: `doc-${coreId}`,
    sourceId: coreId,
    coreId,
    slug: `${coreId}-slug`,
    title: `Title ${coreId}`,
    description: null,
    label: "Short film",
    rawLabel,
    metaLabel: null,
    imageUrl: `https://img/${coreId}.jpg`,
    landscapeImageUrl: `https://img/${coreId}-landscape.jpg`,
    imageAlt: coreId,
    muxPlaybackId: null,
    durationSeconds: 120,
    childCount: 0,
    parentCoreId: null,
    parentSlug: null,
    missingData: [],
    ...overrides,
  }
}

// ── KTD-10 parsing ──────────────────────────────────────────────────

describe("parseShowcaseExperience — KTD-10 authoring contract", () => {
  const index = buildVideoByCoreIdIndex([poolVideo("a"), poolVideo("b")])

  it("maps one MediaCollection section per felt-need chapter, in reel order", () => {
    const blocks = [
      mediaCollection("Loneliness", ["a"], { mcSubtitle: "You are not alone" }),
      mediaCollection("Hope", ["b"]),
    ]
    const { chapters } = parseShowcaseExperience(blocks, index)
    expect(chapters.map((chapter) => chapter.title)).toEqual([
      "Loneliness",
      "Hope",
    ])
    expect(chapters[0]?.subtitle).toBe("You are not alone")
    expect(chapters[0]?.excerpts[0]?.slug).toBe("a-slug")
  })

  it("preserves the curator's item order within a chapter", () => {
    const { chapters } = parseShowcaseExperience(
      [mediaCollection("Hope", ["b", "a"])],
      index,
    )
    expect(chapters[0]?.excerpts.map((e) => e.coreId)).toEqual(["b", "a"])
  })

  it("excludes the reserved showcase-stats section from chapters", () => {
    const blocks = [
      mediaCollection("Loneliness", ["a"]),
      mediaCollection(SHOWCASE_STATS_SECTION_TITLE, ["b"], {
        mcDescription: "1.5 billion views\n2,000 languages",
      }),
    ]
    const { chapters, statLines } = parseShowcaseExperience(blocks, index)
    expect(chapters.map((chapter) => chapter.title)).toEqual(["Loneliness"])
    expect(statLines).toEqual(["1.5 billion views", "2,000 languages"])
  })

  // The discriminator is the TITLE (admin auto-generates sectionKeys with no UI to
  // set them), so a curator's casing/whitespace slip must not leak stats as a chapter.
  it("matches the reserved stats title despite casing and surrounding whitespace", () => {
    const { chapters, statLines } = parseShowcaseExperience(
      [
        mediaCollection("  Showcase-Stats  ", ["a"], {
          mcDescription: "A claim",
        }),
      ],
      index,
    )
    expect(chapters).toEqual([])
    expect(statLines).toEqual(["A claim"])
  })

  it("drops blank lines from the authored stat lines", () => {
    const { statLines } = parseShowcaseExperience(
      [
        mediaCollection(SHOWCASE_STATS_SECTION_TITLE, [], {
          mcDescription: "One claim\n\n  \nAnother claim\n",
        }),
      ],
      index,
    )
    expect(statLines).toEqual(["One claim", "Another claim"])
  })

  it("yields no stat lines when the stats section has no description", () => {
    const { statLines } = parseShowcaseExperience(
      [
        mediaCollection(SHOWCASE_STATS_SECTION_TITLE, [], {
          mcDescription: null,
        }),
      ],
      index,
    )
    expect(statLines).toEqual([])
  })

  // The curator's authoring surface is a free-text title and a coreId, and both fail
  // silently. These counts are the only feedback loop they have.
  it("counts an item dropped for a coreId that never hydrated", () => {
    const { drops } = parseShowcaseExperience(
      [mediaCollection("Hope", ["a", "never-hydrated", "b"])],
      index,
    )
    expect(drops).toEqual({ items: 1, chapters: 0 })
  })

  it("counts an item dropped for a null or malformed coreId", () => {
    const { drops } = parseShowcaseExperience(
      [mediaCollection("Hope", [null, "b; DROP TABLE", "a"])],
      index,
    )
    expect(drops.items).toBe(2)
  })

  it("counts a whole chapter the curator authored that reaches no TV", () => {
    const { drops } = parseShowcaseExperience(
      [
        mediaCollection("Ghost", ["never-hydrated"]),
        mediaCollection("Hope", ["a"]),
      ],
      index,
    )
    expect(drops).toEqual({ items: 1, chapters: 1 })
  })

  it("does not count an empty section as a dropped chapter — nothing was authored to lose", () => {
    const { drops } = parseShowcaseExperience(
      [mediaCollection("Empty", [])],
      index,
    )
    expect(drops.chapters).toBe(0)
  })

  it("reports no drops when every authored item resolves", () => {
    const { drops } = parseShowcaseExperience(
      [mediaCollection("Hope", ["a", "b"])],
      index,
    )
    expect(drops).toEqual({ items: 0, chapters: 0 })
  })

  it("drops a chapter whose items are all unresolvable", () => {
    const blocks = [
      mediaCollection("Ghost", ["never-hydrated"]),
      mediaCollection("Hope", ["b"]),
    ]
    const { chapters } = parseShowcaseExperience(blocks, index)
    expect(chapters.map((chapter) => chapter.title)).toEqual(["Hope"])
  })

  it("drops an item with a null or malformed coreId but keeps the chapter", () => {
    const { chapters } = parseShowcaseExperience(
      [mediaCollection("Hope", [null, "b; DROP TABLE", "a"])],
      index,
    )
    expect(chapters[0]?.excerpts.map((e) => e.coreId)).toEqual(["a"])
  })

  it("drops a hydrated item that has no slug — the stream query keys on slug", () => {
    const slugless = buildVideoByCoreIdIndex([poolVideo("a", { slug: null })])
    const { chapters } = parseShowcaseExperience(
      [mediaCollection("Hope", ["a"])],
      slugless,
    )
    expect(chapters).toEqual([])
  })

  it("ignores non-MediaCollection blocks", () => {
    const blocks = [
      { __typename: "VideoHeroBlock" },
      mediaCollection("Hope", ["a"]),
      { __typename: "TextBlock" },
    ] as ShowcaseExperienceBlock[]
    const { chapters } = parseShowcaseExperience(blocks, index)
    expect(chapters).toHaveLength(1)
  })

  it("returns nothing for null, undefined, or empty blocks", () => {
    for (const blocks of [null, undefined, []]) {
      expect(parseShowcaseExperience(blocks, index)).toEqual({
        chapters: [],
        statLines: [],
        drops: { items: 0, chapters: 0 },
      })
    }
  })

  // GET_WATCH_EXPERIENCE aliases MediaCollection's fields (mcTitle/mcSubtitle/
  // mcDescription); a snapshot-deserialized block carries them unaliased. Reading
  // only one set would silently yield undefined titles for the other.
  it("reads both the mc* aliased and the unaliased field names", () => {
    const unaliased = {
      __typename: "MediaCollectionBlock",
      sectionKey: "plain",
      title: "Hope",
      subtitle: "Plain subtitle",
      items: [{ coreId: "a" }],
    } as ShowcaseExperienceBlock
    const { chapters } = parseShowcaseExperience([unaliased], index)
    expect(chapters[0]?.title).toBe("Hope")
    expect(chapters[0]?.subtitle).toBe("Plain subtitle")
  })

  it("falls back to a block-index chapter id when sectionKey is absent", () => {
    const blocks = [
      mediaCollection("Hope", ["a"], { sectionKey: null }),
    ] as ShowcaseExperienceBlock[]
    const { chapters } = parseShowcaseExperience(blocks, index)
    expect(chapters[0]?.id).toBe("showcase-chapter-0")
    expect(chapters[0]?.excerpts[0]?.id).toBe("showcase-chapter-0:a")
  })

  it("hydrates title and full-bleed poster art from the pool record", () => {
    const { chapters } = parseShowcaseExperience(
      [mediaCollection("Hope", ["a"])],
      index,
    )
    expect(chapters[0]?.excerpts[0]).toMatchObject({
      title: "Title a",
      posterUrl: "https://img/a.jpg",
      rawLabel: "SHORT_FILM",
    })
  })

  // The bare Cloudflare `url` is the variant-less delivery base and 400s — poster
  // intent must fall through to a sibling image's real art, never to `url`.
  it("never picks the variant-less bare url over real poster art", () => {
    const trap = buildVideoByCoreIdIndex([
      poolVideo("a", {
        images: [
          { url: "https://img/bare-400.jpg" },
          { mobileCinematicHigh: "https://img/real.jpg" },
        ],
      }),
    ])
    const { chapters } = parseShowcaseExperience(
      [mediaCollection("Hope", ["a"])],
      trap,
    )
    expect(chapters[0]?.excerpts[0]?.posterUrl).toBe("https://img/real.jpg")
  })

  it("falls back to the slug when the pool record has no localized title", () => {
    const untitled = buildVideoByCoreIdIndex([poolVideo("a", { locales: [] })])
    const { chapters } = parseShowcaseExperience(
      [mediaCollection("Hope", ["a"])],
      untitled,
    )
    expect(chapters[0]?.excerpts[0]?.title).toBe("a-slug")
  })

  // KTD-4's hydration index indexes children too (a curated item can live only as
  // another collection's child), but a top-level record must win a collision.
  it("prefers the top-level record over a child on a coreId collision", () => {
    const collide = buildVideoByCoreIdIndex([
      {
        documentId: "doc-parent",
        coreId: "parent",
        slug: "parent-slug",
        label: "SERIES",
        children: [
          {
            child: {
              documentId: "doc-a",
              coreId: "a",
              slug: "child-copy-slug",
              label: "EPISODE",
              locales: [{ title: "Child copy" }],
              images: [],
            },
          },
        ],
      },
      poolVideo("a", { slug: "top-level-slug" }),
    ])
    const { chapters } = parseShowcaseExperience(
      [mediaCollection("Hope", ["a"])],
      collide,
    )
    expect(chapters[0]?.excerpts[0]?.slug).toBe("top-level-slug")
    expect(chapters[0]?.excerpts[0]?.title).toBe("Title a")
  })

  it("hydrates an item that exists only as another collection's child", () => {
    const childOnly = buildVideoByCoreIdIndex([
      {
        documentId: "doc-parent",
        coreId: "parent",
        slug: "parent-slug",
        label: "SERIES",
        children: [
          {
            child: {
              documentId: "doc-kid",
              coreId: "kid",
              slug: "kid-slug",
              label: "EPISODE",
              locales: [{ title: "The Kid" }],
              images: [{ mobileCinematicHigh: "https://img/kid.jpg" }],
            },
          },
        ],
      },
    ])
    const { chapters } = parseShowcaseExperience(
      [mediaCollection("Hope", ["kid"])],
      childOnly,
    )
    expect(chapters[0]?.excerpts[0]?.title).toBe("The Kid")
  })
})

// ── Fallback composition (R5) ───────────────────────────────────────

describe("buildFallbackChapters — poster shape", () => {
  it("takes the landscape cinematic, not the card's own art", () => {
    // On a poster rail `imageUrl` is a curated 2:3 poster; the reel is full-bleed
    // 16:9, so cover-fitting a portrait poster crops it to a sliver. Both fields
    // are `string | null`, so only this test separates them.
    const chapters = buildFallbackChapters({
      model: modelWithCards([poolCard("v1", "SHORT_FILM")]),
      now: new Date("2026-07-16T00:00:00Z"),
    })

    expect(chapters[0]?.excerpts[0]?.posterUrl).toBe(
      "https://img/v1-landscape.jpg",
    )
  })

  it("falls back to the card's art when the video has no cinematic", () => {
    const chapters = buildFallbackChapters({
      model: modelWithCards([
        poolCard("v1", "SHORT_FILM", { landscapeImageUrl: null }),
      ]),
      now: new Date("2026-07-16T00:00:00Z"),
    })

    expect(chapters[0]?.excerpts[0]?.posterUrl).toBe("https://img/v1.jpg")
  })
})

describe("buildFallbackChapters — R5/AE1", () => {
  const now = new Date("2026-07-15T12:00:00Z")

  it("composes one unlabeled chapter — fallback shows no felt-need cards", () => {
    const model = modelWithCards([poolCard("a", "SHORT_FILM")])
    const chapters = buildFallbackChapters({ model, now })
    expect(chapters).toHaveLength(1)
    expect(chapters[0]?.title).toBe("")
    expect(chapters[0]?.subtitle).toBeNull()
  })

  it("prefers short-form items ahead of long-form backfill", () => {
    const model = modelWithCards([
      poolCard("film", "FEATURE_FILM"),
      poolCard("short", "SHORT_FILM"),
      poolCard("series", "SERIES"),
      poolCard("segment", "SEGMENT"),
    ])
    const chapters = buildFallbackChapters({ model, now })
    const coreIds = chapters[0]!.excerpts.map((e) => e.coreId)
    expect(coreIds.slice(0, 2).sort()).toEqual(["segment", "short"])
  })

  // heroQueue's live trap: eligibility must read rawLabel (the wire enum), never
  // the display text `label`, which every one of these cards shares.
  it("branches on rawLabel, not the display label text", () => {
    const model = modelWithCards([
      poolCard("a", "FEATURE_FILM", { label: "Short film" }),
      poolCard("b", "SHORT_FILM", { label: "Short film" }),
    ])
    const chapters = buildFallbackChapters({ model, now })
    expect(chapters[0]?.excerpts[0]?.coreId).toBe("b")
  })

  it("still yields a reel when nothing short-form exists (AE1)", () => {
    const model = modelWithCards([poolCard("film", "FEATURE_FILM")])
    const chapters = buildFallbackChapters({ model, now })
    expect(chapters[0]?.excerpts.map((e) => e.coreId)).toEqual(["film"])
  })

  it("draws from section cards as well as the featured hero queue", () => {
    const model: WatchHomeModel = {
      featured: [],
      sections: [
        {
          id: "s1",
          eyebrow: "",
          title: "Row",
          description: null,
          layout: "rail",
          orientation: "horizontal",
          showSequenceNumbers: false,
          isPosterRail: false,
          cards: [poolCard("in-section", "SHORT_FILM")],
        },
      ],
      missingData: [],
    }
    expect(buildFallbackChapters({ model, now })[0]?.excerpts).toHaveLength(1)
  })

  it("dedupes a card that appears in both featured and a section", () => {
    const card = poolCard("dupe", "SHORT_FILM")
    const model: WatchHomeModel = {
      featured: [card],
      sections: [
        {
          id: "s1",
          eyebrow: "",
          title: "Row",
          description: null,
          layout: "rail",
          orientation: "horizontal",
          showSequenceNumbers: false,
          isPosterRail: false,
          cards: [card],
        },
      ],
      missingData: [],
    }
    expect(buildFallbackChapters({ model, now })[0]?.excerpts).toHaveLength(1)
  })

  it("drops cards with no slug — the stream query keys on slug", () => {
    const model = modelWithCards([
      poolCard("a", "SHORT_FILM", { slug: null }),
      poolCard("b", "SHORT_FILM"),
    ])
    expect(
      buildFallbackChapters({ model, now })[0]?.excerpts.map((e) => e.coreId),
    ).toEqual(["b"])
  })

  it("returns no chapters when the pool is empty — the stills input", () => {
    expect(buildFallbackChapters({ model: emptyModel, now })).toEqual([])
  })

  it("caps the reel so one loop stays bounded", () => {
    const model = modelWithCards(
      Array.from({ length: 100 }, (_, i) => poolCard(`c${i}`, "SHORT_FILM")),
    )
    const excerpts = buildFallbackChapters({ model, now })[0]!.excerpts
    expect(excerpts.length).toBeLessThanOrEqual(24)
    expect(new Set(excerpts.map((e) => e.coreId)).size).toBe(excerpts.length)
  })

  // Day-seeded like the Home hero, so an office TV does not replay one fixed order
  // forever — but is stable within a day (an injected clock keeps this hermetic).
  it("is deterministic for a given day and rotates across days", () => {
    const model = modelWithCards(
      Array.from({ length: 30 }, (_, i) => poolCard(`c${i}`, "SHORT_FILM")),
    )
    const monday = buildFallbackChapters({ model, now })
    const mondayAgain = buildFallbackChapters({ model, now })
    const laterDay = buildFallbackChapters({
      model,
      now: new Date("2026-08-02T12:00:00Z"),
    })
    expect(monday[0]?.excerpts.map((e) => e.id)).toEqual(
      mondayAgain[0]?.excerpts.map((e) => e.id),
    )
    expect(monday[0]?.excerpts.map((e) => e.id)).not.toEqual(
      laterDay[0]?.excerpts.map((e) => e.id),
    )
  })
})

// ── The ladder (R5/R16/AE1) ─────────────────────────────────────────

describe("resolveShowcaseSource — the ladder", () => {
  const curated = [
    { id: "c1", title: "Loneliness", subtitle: null, excerpts: [] as never[] },
  ]
  const fallback = [
    { id: "f", title: "", subtitle: null, excerpts: [] as never[] },
  ]

  it("uses the Experience when it yields at least one chapter", () => {
    const result = resolveShowcaseSource({
      experienceOutcome: "present",
      experienceChapters: curated,
      experienceStatLines: ["A stat"],
      fallbackChapters: fallback,
    })
    expect(result).toMatchObject({
      kind: "queue",
      queue: { kind: "curated", chapters: curated, statLines: ["A stat"] },
    })
  })

  // AE1: missing, empty, and errored Experiences all reach real catalog content.
  it.each([
    ["absent", "experience-absent"],
    ["empty", "experience-empty"],
    ["error", "experience-error"],
  ] as const)(
    "falls back to the pool reel when the Experience is %s",
    (outcome, reason) => {
      const result = resolveShowcaseSource({
        experienceOutcome: outcome === "empty" ? "present" : outcome,
        experienceChapters: [],
        experienceStatLines: [],
        fallbackChapters: fallback,
      })
      expect(result.kind).toBe("queue")
      expect(result).toMatchObject({
        queue: { kind: "fallback", chapters: fallback },
      })
      expect(result.logs).toEqual([reason])
    },
  )

  it("never carries authored stat lines onto the fallback reel", () => {
    const result = resolveShowcaseSource({
      experienceOutcome: "error",
      experienceChapters: [],
      experienceStatLines: ["A stat that lost its chapters"],
      fallbackChapters: fallback,
    })
    expect(result).toMatchObject({ queue: { statLines: [] } })
  })

  it("returns the stills state only when BOTH sources yield nothing", () => {
    const result = resolveShowcaseSource({
      experienceOutcome: "error",
      experienceChapters: [],
      experienceStatLines: [],
      fallbackChapters: [],
    })
    expect(result.kind).toBe("stills")
    expect(result.logs).toEqual(["experience-error"])
  })

  it("logs error-recovered when a last-good Experience survives a failed refetch", () => {
    const result = resolveShowcaseSource({
      experienceOutcome: "error",
      experienceChapters: curated,
      experienceStatLines: [],
      fallbackChapters: fallback,
    })
    expect(result).toMatchObject({ queue: { kind: "curated" } })
    expect(result.logs).toEqual(["experience-error-recovered"])
  })

  it("logs nothing when the Experience resolves cleanly", () => {
    const result = resolveShowcaseSource({
      experienceOutcome: "present",
      experienceChapters: curated,
      experienceStatLines: [],
      fallbackChapters: fallback,
    })
    expect(result.logs).toEqual([])
  })
})

// ── Excerpt windows (R6) ────────────────────────────────────────────

describe("resolveExcerptWindow — R6: bounded excerpts", () => {
  it("plays a short-form item from the start, stopping clear of the credits", () => {
    expect(resolveExcerptWindow(25)).toEqual({
      startSeconds: 0,
      endSeconds: 20,
    })
  })

  it("plays an item exactly at the max window from the start", () => {
    // 40s item, less the 5s credits tail.
    expect(resolveExcerptWindow(EXCERPT_MAX_SECONDS)).toEqual({
      startSeconds: 0,
      endSeconds: 35,
    })
  })

  it("gives a long-form item one bounded window offset ~15% in", () => {
    // 3600s feature film: 15% in = 540s, capped at the 40s max window.
    expect(resolveExcerptWindow(3600)).toEqual({
      startSeconds: 540,
      endSeconds: 580,
    })
  })

  it("never runs a long-form window past the end of the video", () => {
    const window = resolveExcerptWindow(45)
    expect(window.endSeconds).toBeLessThanOrEqual(45)
    expect(window.startSeconds).toBeGreaterThan(0)
  })

  it("keeps every long-form window inside the 20-40s target band", () => {
    for (const duration of [41, 45, 50, 60, 120, 600, 3600, 7200]) {
      const { startSeconds, endSeconds } = resolveExcerptWindow(duration)
      const length = endSeconds - startSeconds
      expect(length).toBeGreaterThanOrEqual(EXCERPT_MIN_SECONDS)
      expect(length).toBeLessThanOrEqual(EXCERPT_MAX_SECONDS)
      expect(endSeconds).toBeLessThanOrEqual(duration)
    }
  })

  it("is deterministic — the same duration always yields the same window", () => {
    expect(resolveExcerptWindow(3600)).toEqual(resolveExcerptWindow(3600))
  })

  // An unknown duration must still be BOUNDED: unbounded on a 2-hour feature would
  // park the reel on one item. playToEnd advances anything shorter than the cap.
  it("bounds an unknown or invalid duration at the max window from 0", () => {
    for (const duration of [
      null,
      undefined,
      0,
      -5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
    ]) {
      expect(resolveExcerptWindow(duration)).toEqual({
        startSeconds: 0,
        endSeconds: EXCERPT_MAX_SECONDS,
      })
    }
  })

  it("rounds window bounds to whole seconds", () => {
    const { startSeconds, endSeconds } = resolveExcerptWindow(101)
    expect(Number.isInteger(startSeconds)).toBe(true)
    expect(Number.isInteger(endSeconds)).toBe(true)
  })
})

// ── The credits tail ────────────────────────────────────────────────

describe("resolveExcerptWindow — never reaches the end credits", () => {
  // The product rule is literally five seconds, so these assert against 5 and NOT
  // against CREDITS_TAIL_SECONDS: a self-referential bound moves with the constant
  // and would pass vacuously if the guard were ever tuned to zero.
  const TAIL = 5

  // Every duration where the trim leaves a worthwhile excerpt, across both branches.
  const TRIMMABLE = [
    25, 26, 30, 39, 40, 41, 45, 47, 50, 53, 60, 120, 600, 3600, 7200,
  ]

  it("pins the credits tail to the five seconds the product rule asks for", () => {
    expect(CREDITS_TAIL_SECONDS).toBe(TAIL)
  })

  it("stops at least five seconds short of the end", () => {
    for (const duration of TRIMMABLE) {
      expect(resolveExcerptWindow(duration).endSeconds).toBeLessThanOrEqual(
        duration - TAIL,
      )
    }
  })

  // Every one of these ran INTO the tail before the guard (41/45/47 to the literal
  // last frame, 50 to 48s of 50). 53 is deliberately absent: min(start+40, d) already
  // stopped it at exactly d-5, so it would pass with the guard reverted.
  it("covers the durations whose window used to reach the credits", () => {
    for (const duration of [41, 45, 47, 50]) {
      const { startSeconds, endSeconds } = resolveExcerptWindow(duration)
      expect(endSeconds).toBeLessThanOrEqual(duration - TAIL)
      expect(endSeconds - startSeconds).toBeGreaterThanOrEqual(
        EXCERPT_MIN_SECONDS,
      )
    }
  })

  // A fractional duration must not round the end back into the tail.
  it("floors the trimmed end rather than rounding into the credits", () => {
    for (const duration of [25.6, 30.9, 45.7, 101.5]) {
      expect(resolveExcerptWindow(duration).endSeconds).toBeLessThanOrEqual(
        duration - TAIL,
      )
    }
  })

  // Below the trim threshold the MIN floor wins: a 6s item trimmed to 1s would be
  // a flash, and a 5s item would be an empty window that skips instantly.
  it("plays an item out in full when the trim would leave less than the floor", () => {
    expect(resolveExcerptWindow(24)).toEqual({
      startSeconds: 0,
      endSeconds: 24,
    })
    expect(resolveExcerptWindow(6)).toEqual({ startSeconds: 0, endSeconds: 6 })
    expect(resolveExcerptWindow(5)).toEqual({ startSeconds: 0, endSeconds: 5 })
    expect(resolveExcerptWindow(1)).toEqual({ startSeconds: 0, endSeconds: 1 })
  })

  it("switches to trimming at exactly the duration where the floor still fits", () => {
    // 24s: trimming would leave 19s, under the floor -> plays out.
    expect(resolveExcerptWindow(24).endSeconds).toBe(24)
    // 25s: trimming leaves exactly the floor -> trims.
    expect(resolveExcerptWindow(25).endSeconds).toBe(EXCERPT_MIN_SECONDS)
  })

  it("never yields an empty, negative, or backwards window at any duration", () => {
    for (let duration = 1; duration <= 400; duration += 1) {
      const { startSeconds, endSeconds } = resolveExcerptWindow(duration)
      expect(startSeconds).toBeGreaterThanOrEqual(0)
      expect(endSeconds).toBeGreaterThan(startSeconds)
      expect(endSeconds).toBeLessThanOrEqual(duration)
    }
  })

  it("leaves the unbounded unknown-duration window alone — no tail to find", () => {
    expect(resolveExcerptWindow(null)).toEqual({
      startSeconds: 0,
      endSeconds: EXCERPT_MAX_SECONDS,
    })
  })
})

// ── Playable stream resolution (the injectable fetch seam) ──────────

describe("resolveExcerptStream", () => {
  const excerpt = {
    id: "c1:a",
    coreId: "a",
    slug: "a-slug",
    title: "Title a",
    posterUrl: null,
    rawLabel: "SHORT_FILM",
  }

  const englishDub = {
    published: true,
    hls: "https://stream/en.m3u8",
    duration: 30,
    language: { slug: "english", name: { en: "English" } },
    muxVideo: { playbackId: "pb-en" },
  }

  it("resolves a playable, windowed, language-rotated stream", async () => {
    const result = await resolveExcerptStream({
      excerpt,
      rotation: initialRotationState,
      fetchVideo: async () => ({ dubs: [englishDub] }),
    })
    expect(result?.stream).toMatchObject({
      hls: "https://stream/en.m3u8",
      languageSlug: "english",
      languageName: "English",
      muxPlaybackId: "pb-en",
      // 30s dub, less the credits tail.
      window: { startSeconds: 0, endSeconds: 25 },
      claimsLanguage: false,
    })
  })

  it("fetches by the excerpt's slug", async () => {
    const fetchVideo = jest.fn(async () => ({ dubs: [englishDub] }))
    await resolveExcerptStream({
      excerpt,
      rotation: initialRotationState,
      fetchVideo,
    })
    expect(fetchVideo).toHaveBeenCalledWith("a-slug")
  })

  it("windows the LONG-FORM dub's own duration, not the pool's durationSeconds", async () => {
    const result = await resolveExcerptStream({
      excerpt,
      rotation: initialRotationState,
      fetchVideo: async () => ({ dubs: [{ ...englishDub, duration: 3600 }] }),
    })
    expect(result?.stream.window).toEqual({
      startSeconds: 540,
      endSeconds: 580,
    })
  })

  it("threads rotation state forward so the next excerpt can differ", async () => {
    const result = await resolveExcerptStream({
      excerpt,
      rotation: initialRotationState,
      fetchVideo: async () => ({ dubs: [englishDub] }),
    })
    expect(result?.rotation.previousSlug).toBe("english")
  })

  it("rotates language across a 3-excerpt chapter (R7 end to end)", async () => {
    const dubs = ["english", "spanish", "french"].map((slug) => ({
      published: true,
      hls: `https://stream/${slug}.m3u8`,
      duration: 30,
      language: { slug, name: { en: slug } },
      muxVideo: { playbackId: `pb-${slug}` },
    }))
    let rotation = initialRotationState
    const picked: (string | null)[] = []
    for (const coreId of ["a", "b", "c"]) {
      const result = await resolveExcerptStream({
        excerpt: { ...excerpt, coreId, id: `c1:${coreId}` },
        rotation,
        fetchVideo: async () => ({ dubs }),
      })
      picked.push(result!.stream.languageSlug)
      rotation = result!.rotation
    }
    expect(new Set(picked).size).toBe(3)
  })

  // R16: every failure degrades to a skip signal — this seam must never throw.
  it("returns null when the video fetch rejects", async () => {
    const result = await resolveExcerptStream({
      excerpt,
      rotation: initialRotationState,
      fetchVideo: async () => {
        throw new Error("network down")
      },
    })
    expect(result).toBeNull()
  })

  it("returns null when the video is not found", async () => {
    const result = await resolveExcerptStream({
      excerpt,
      rotation: initialRotationState,
      fetchVideo: async () => null,
    })
    expect(result).toBeNull()
  })

  it("returns null when the video has no playable dub", async () => {
    const result = await resolveExcerptStream({
      excerpt,
      rotation: initialRotationState,
      fetchVideo: async () => ({ dubs: [{ ...englishDub, published: false }] }),
    })
    expect(result).toBeNull()
  })

  it("leaves rotation state untouched when resolution fails", async () => {
    const rotation = { usedSlugs: ["english"], previousSlug: "english" }
    const result = await resolveExcerptStream({
      excerpt,
      rotation,
      fetchVideo: async () => null,
    })
    expect(result).toBeNull()
    expect(rotation).toEqual({
      usedSlugs: ["english"],
      previousSlug: "english",
    })
  })
})
