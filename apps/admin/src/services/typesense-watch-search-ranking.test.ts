import { describe, expect, it } from "vitest"

import {
  compareSemanticRankingGroups,
  normalizeWatchSearchTitle,
  rankWatchSearchGroups,
  type WatchSearchRankingGroup,
} from "./typesense-watch-search-ranking"

function group(
  canonicalVideoId: string,
  overrides: Partial<WatchSearchRankingGroup> = {},
): WatchSearchRankingGroup {
  return {
    canonicalVideoId,
    fusedScore: 0,
    wholeTitleMatch: false,
    titleValues: [],
    metadataValues: [],
    laneEvidence: { title: null, metadata: null, semantic: null },
    ...overrides,
  }
}

function titleGroup(id: string, title: string, rank = 1) {
  return group(id, {
    titleValues: [title],
    laneEvidence: {
      title: { rank, contribution: 0.56 / (60 + rank) },
      metadata: null,
      semantic: null,
    },
  })
}

describe("Watch search title normalization", () => {
  it("normalizes joined brands, punctuation, Unicode, articles, and suffixes", () => {
    expect(normalizeWatchSearchTitle("  The BibleProject Collection ")).toEqual(
      {
        normalized: "the bible project collection",
        compact: "thebibleprojectcollection",
        core: "bible project",
        compactCore: "bibleproject",
        coreTokens: ["bible", "project"],
      },
    )
    expect(normalizeWatchSearchTitle("Bible-Project").core).toBe(
      "bible project",
    )
    expect(normalizeWatchSearchTitle("L’Évangile").normalized).toBe(
      "l évangile",
    )
  })
})

describe("automatic Watch search ranking modes", () => {
  it("promotes a recalled canonical intent below a real whole-title match", () => {
    const target = group("core:1_cl-0-0", { fusedScore: 0.01 })
    const semantic = group("semantic", { fusedScore: 0.5 })

    const promoted = rankWatchSearchGroups(
      "Jesus for kids",
      [semantic, target],
      "en",
      "core:1_cl-0-0",
    )
    expect(promoted.mode).toBe("CANONICAL_INTENT")
    expect(
      promoted.groups.map(({ group: entry }) => entry.canonicalVideoId),
    ).toEqual(["core:1_cl-0-0", "semantic"])
    expect(promoted.groups.map(({ evidenceTier }) => evidenceTier)).toEqual([
      "CANONICAL_INTENT",
      "SEMANTIC_FILL",
    ])

    const exactCollision = titleGroup("literal-title", "Jesus for kids")
    const collision = rankWatchSearchGroups(
      "Jesus for kids",
      [target, exactCollision],
      "en",
      "core:1_cl-0-0",
    )
    expect(
      collision.groups.map(({ group: entry }) => entry.canonicalVideoId),
    ).toEqual(["literal-title", "core:1_cl-0-0"])
    expect(collision.groups.map(({ evidenceTier }) => evidenceTier)).toEqual([
      "NORMALIZED_WHOLE_TITLE",
      "CANONICAL_INTENT",
    ])
  })

  it("does not manufacture a missing intent target or perturb unknown queries", () => {
    const groups = [
      group("b", { fusedScore: 0.25 }),
      group("a", { fusedScore: 0.25 }),
    ]
    const baseline = rankWatchSearchGroups("Jesus for kids", groups)
    const missing = rankWatchSearchGroups(
      "Jesus for kids",
      groups,
      "en",
      "core:missing",
    )
    const unknown = rankWatchSearchGroups("resurrection", groups)

    expect(missing).toEqual(baseline)
    expect(
      unknown.groups.map(({ group: entry }) => entry.canonicalVideoId),
    ).toEqual(["a", "b"])
  })

  it("places precise brand metadata before stronger semantic-only RRF fill", () => {
    const collection = titleGroup("collection", "The BibleProject Collection")
    const metadata = group("brand-video", {
      fusedScore: 0.14 / 61,
      metadataValues: ["A BibleProject animation about the biblical story"],
      laneEvidence: {
        title: null,
        metadata: { rank: 1, contribution: 0.14 / 61 },
        semantic: null,
      },
    })
    const semantic = group("semantic-only", {
      fusedScore: 0.3 / 61,
      laneEvidence: {
        title: null,
        metadata: null,
        semantic: { rank: 1, contribution: 0.3 / 61 },
      },
    })

    expect([metadata, semantic].sort(compareSemanticRankingGroups)).toEqual([
      semantic,
      metadata,
    ])
    const ranked = rankWatchSearchGroups("the bible project", [
      collection,
      metadata,
      semantic,
    ])
    expect(ranked.mode).toBe("TITLE_AND_BRAND")
    expect(ranked.anchor).toMatchObject({
      compactCore: "bibleproject",
      sourceCanonicalVideoId: "collection",
    })
    expect(
      ranked.groups.map(({ group: entry }) => entry.canonicalVideoId),
    ).toEqual(["collection", "brand-video", "semantic-only"])
    expect(ranked.groups.map(({ evidenceTier }) => evidenceTier)).toEqual([
      "UNIQUE_TITLE_CORE",
      "ANCHOR_METADATA",
      "SEMANTIC_FILL",
    ])
  })

  it.each([
    "BibleProject",
    "bibleproject",
    "Bible Project",
    "Bible-Project",
    "the bible project",
    "BibleProject Collection",
  ])("recognizes normalized brand form %s", (query) => {
    expect(
      rankWatchSearchGroups(query, [
        titleGroup("brand", "The BibleProject Collection"),
      ]).mode,
    ).toBe("TITLE_AND_BRAND")
  })

  it("uses the same rule for other brands and omitted articles", () => {
    expect(
      rankWatchSearchGroups("StoryClubs", [
        titleGroup("storyclubs", "The StoryClubs Collection"),
      ]).mode,
    ).toBe("TITLE_AND_BRAND")
    expect(
      rankWatchSearchGroups("Week Away", [
        titleGroup("week-away", "A Week Away"),
      ]).mode,
    ).toBe("TITLE_AND_BRAND")
  })

  it("keeps conceptual and ambiguous title-core queries semantic", () => {
    expect(
      rankWatchSearchGroups("hope after divorce", [
        titleGroup("hope", "Hope Collection"),
      ]).mode,
    ).toBe("SEMANTIC")
    expect(
      rankWatchSearchGroups("Hope", [
        titleGroup("hope-collection", "Hope Collection"),
      ]).mode,
    ).toBe("SEMANTIC")
    expect(
      rankWatchSearchGroups("the rapist", [
        titleGroup("therapist", "Therapist"),
      ]).mode,
    ).toBe("SEMANTIC")
    expect(
      rankWatchSearchGroups("the bible project series", [
        titleGroup("series", "BibleProject Series"),
        titleGroup("collection", "BibleProject Collection", 2),
      ]).mode,
    ).toBe("SEMANTIC")
  })

  it("does not activate from metadata alone or promote negative metadata", () => {
    const metadataOnly = group("metadata", {
      metadataValues: ["BibleProject resources"],
      laneEvidence: {
        title: null,
        metadata: { rank: 1, contribution: 0.1 },
        semantic: null,
      },
    })
    expect(rankWatchSearchGroups("BibleProject", [metadataOnly]).mode).toBe(
      "SEMANTIC",
    )

    const ranked = rankWatchSearchGroups("BibleProject", [
      titleGroup("brand", "BibleProject Collection"),
      group("negative", {
        metadataValues: ["This series is not affiliated with BibleProject"],
        laneEvidence: {
          title: null,
          metadata: { rank: 1, contribution: 0.01 },
          semantic: null,
        },
      }),
    ])
    expect(ranked.groups[1]?.evidenceTier).toBe("SEMANTIC_FILL")
  })

  it("rejects negative and multi-brand context without suppressing positive prose", () => {
    const anchor = titleGroup("brand", "BibleProject Collection")
    const rejected = [
      "BibleProject versus LUMO resources",
      "BibleProject and The Chosen",
      "LUMO and BibleProject",
      "The Chosen alongside BibleProject",
      "This series is unrelated to BibleProject",
      "BibleProject is unrelated to this series",
      "A film with no official connection to BibleProject",
      "This is not an official BibleProject video",
    ].map((value, index) =>
      group(`rejected-${index}`, {
        metadataValues: [value],
        laneEvidence: {
          title: null,
          metadata: { rank: index + 1, contribution: 0.01 },
          semantic: null,
        },
      }),
    )
    const accepted = [
      "A BibleProject animation with practical lessons",
      "BibleProject explains creation and redemption",
      "BibleProject helps children live without fear",
      "BibleProject connects seemingly unrelated stories",
    ].map((value, index) =>
      group(`accepted-${index}`, {
        metadataValues: [value],
        laneEvidence: {
          title: null,
          metadata: { rank: index + 20, contribution: 0.005 },
          semantic: null,
        },
      }),
    )

    const ranked = rankWatchSearchGroups("BibleProject", [
      anchor,
      ...rejected,
      ...accepted,
    ])
    const tiers = new Map(
      ranked.groups.map(({ group: entry, evidenceTier }) => [
        entry.canonicalVideoId,
        evidenceTier,
      ]),
    )
    for (const entry of rejected) {
      expect(tiers.get(entry.canonicalVideoId)).toBe("SEMANTIC_FILL")
    }
    for (const entry of accepted) {
      expect(tiers.get(entry.canonicalVideoId)).toBe("ANCHOR_METADATA")
    }
  })

  it("normalizes Turkish dotted and dotless I using the query locale", () => {
    expect(
      rankWatchSearchGroups("isa", [titleGroup("isa", "İsa")], "tr").mode,
    ).toBe("TITLE_AND_BRAND")
    expect(
      rankWatchSearchGroups("ışık", [titleGroup("light", "Işık")], "tr").mode,
    ).toBe("TITLE_AND_BRAND")
    expect(
      rankWatchSearchGroups("kır", [titleGroup("dirt", "Kir")], "tr").mode,
    ).toBe("SEMANTIC")
  })

  it("supports mixed intent only when the title lane supplies the anchor", () => {
    const ranked = rankWatchSearchGroups("BibleProject forgiveness", [
      titleGroup("title", "BibleProject Forgiveness"),
      group("related", {
        metadataValues: ["BibleProject forgiveness lessons"],
        laneEvidence: {
          title: null,
          metadata: { rank: 1, contribution: 0.005 },
          semantic: null,
        },
      }),
    ])
    expect(ranked.mode).toBe("TITLE_AND_BRAND")
    expect(ranked.groups[1]?.evidenceTier).toBe("ANCHOR_METADATA")
  })

  it("keeps promotion bounded and semantic ties deterministic", () => {
    const lateMetadata = group("late-metadata", {
      fusedScore: 1,
      metadataValues: ["BibleProject animation"],
      laneEvidence: {
        title: null,
        metadata: { rank: 101, contribution: 1 },
        semantic: null,
      },
    })
    const ranked = rankWatchSearchGroups("BibleProject", [
      titleGroup("brand", "BibleProject Collection"),
      lateMetadata,
    ])
    expect(ranked.groups[1]?.evidenceTier).toBe("SEMANTIC_FILL")

    const semanticWindow = Array.from({ length: 99 }, (_value, index) =>
      group(`semantic-${index}`, {
        fusedScore: 1 - index / 1_000,
        laneEvidence: {
          title: null,
          metadata: null,
          semantic: { rank: index + 1, contribution: 1 - index / 1_000 },
        },
      }),
    )
    const widerWindow = rankWatchSearchGroups("BibleProject", [
      titleGroup("brand", "BibleProject Collection"),
      ...semanticWindow,
      lateMetadata,
    ])
    const reorderedWindow = rankWatchSearchGroups("BibleProject", [
      lateMetadata,
      ...[...semanticWindow].reverse(),
      titleGroup("brand", "BibleProject Collection"),
    ])
    expect(reorderedWindow.groups).toEqual(widerWindow.groups)
    const expectedOrder = widerWindow.groups.map(
      ({ group: entry }) => entry.canonicalVideoId,
    )
    expect(
      [0, 25, 50, 75, 100].flatMap((offset) =>
        widerWindow.groups
          .slice(offset, offset + 25)
          .map(({ group: entry }) => entry.canonicalVideoId),
      ),
    ).toEqual(expectedOrder)

    const semanticGroups = [
      group("b", { fusedScore: 0.25 }),
      group("whole", { fusedScore: 0.01, wholeTitleMatch: true }),
      group("a", { fusedScore: 0.25 }),
    ]
    expect(
      rankWatchSearchGroups(
        "how can I forgive someone",
        semanticGroups,
      ).groups.map(({ group: entry }) => entry.canonicalVideoId),
    ).toEqual(["whole", "a", "b"])
  })
})
