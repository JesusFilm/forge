import { describe, expect, it, vi } from "vitest"
import {
  TYPESENSE_WATCH_AVAILABILITY_ALIAS,
  TYPESENSE_WATCH_CATALOG_ALIAS,
  TYPESENSE_WATCH_LEXICAL_ALIAS,
  TYPESENSE_WATCH_TRANSCRIPT_ALIAS,
} from "./typesense-watch-search-schema"
import {
  TypesenseWatchSearchProfileError,
  assertQualificationProfilesMatchLease,
  createCandidateWatchSearchProfile,
  createCurrentWatchSearchProfile,
  freezeCurrentWatchSearchProfile,
  resolveCandidateWatchSearchProfile,
  watchSearchBindingMembers,
} from "./typesense-watch-search-profile"

const fieldManifests = {
  catalog: [{ name: "slug", type: "string" }],
  availability: [{ name: "videoId", type: "string" }],
  lexical: [
    { name: "title_en", type: "string[]" },
    { name: "title_fallback", type: "string[]" },
    { name: "metadata_en", type: "string[]" },
    { name: "metadata_fallback", type: "string[]" },
  ],
  transcript: [{ name: "embedding", type: "float[]", num_dim: 1536 }],
} as const

describe("Typesense Watch search profiles", () => {
  it("keeps current on the existing aliases with compatibility enabled", () => {
    const profile = createCurrentWatchSearchProfile()

    expect(profile).toEqual({
      kind: "CURRENT",
      binding: {
        catalog: TYPESENSE_WATCH_CATALOG_ALIAS,
        availability: TYPESENSE_WATCH_AVAILABILITY_ALIAS,
        lexical: TYPESENSE_WATCH_LEXICAL_ALIAS,
        transcript: TYPESENSE_WATCH_TRANSCRIPT_ALIAS,
      },
      generationId: null,
      applicationRevision: null,
      rankingRevision: "legacy-rrf",
      transcriptProjectionRevision: null,
      qrelsRevision: null,
      fieldManifests: null,
      allowCompatibilityFallback: true,
    })
    expect(Object.isFrozen(profile)).toBe(true)
    expect(Object.isFrozen(profile.binding)).toBe(true)
  })

  it("creates one immutable candidate profile from an explicit resolved generation", () => {
    const profile = createCandidateWatchSearchProfile(
      {
        generationId: "generation-1",
        applicationRevision: "revision-1",
        transcriptProjectionRevision: 7n,
        fieldManifests,
        collections: {
          catalog: "watch_search_candidate_generation-1_catalog",
          availability: "watch_search_candidate_generation-1_availability",
          lexical: "watch_search_candidate_generation-1_lexical",
          transcript: "watch_search_transcripts_20260809",
        },
      },
      { qrelsRevision: null, rankingRevision: "title-and-brand-v1" },
    )

    expect(profile).toMatchObject({
      kind: "CANDIDATE",
      generationId: "generation-1",
      applicationRevision: "revision-1",
      rankingRevision: "title-and-brand-v1",
      transcriptProjectionRevision: 7n,
      allowCompatibilityFallback: false,
    })
    expect(watchSearchBindingMembers(profile)).toEqual([
      "watch_search_candidate_generation-1_catalog",
      "watch_search_candidate_generation-1_availability",
      "watch_search_candidate_generation-1_lexical",
      "watch_search_transcripts_20260809",
    ])
    expect(Object.isFrozen(profile)).toBe(true)
    expect(Object.isFrozen(profile.binding)).toBe(true)
  })

  it("fails closed for an unknown candidate ranking revision", () => {
    expect(() =>
      createCandidateWatchSearchProfile(
        {
          generationId: "generation-1",
          applicationRevision: "revision-1",
          transcriptProjectionRevision: 7n,
          fieldManifests,
          collections: {
            catalog: "watch_search_candidate_generation-1_catalog",
            availability: "watch_search_candidate_generation-1_availability",
            lexical: "watch_search_candidate_generation-1_lexical",
            transcript: "watch_search_transcripts_20260809",
          },
        },
        {
          qrelsRevision: null,
          rankingRevision: "unknown-ranker" as "title-and-brand-v1",
        },
      ),
    ).toThrow(TypesenseWatchSearchProfileError)
  })

  it.each([
    TYPESENSE_WATCH_CATALOG_ALIAS,
    TYPESENSE_WATCH_AVAILABILITY_ALIAS,
    TYPESENSE_WATCH_LEXICAL_ALIAS,
    TYPESENSE_WATCH_TRANSCRIPT_ALIAS,
  ])(
    "rejects candidate bindings that can fall through an alias: %s",
    (alias) => {
      const collections = {
        catalog: "watch_search_candidate_generation-1_catalog",
        availability: "watch_search_candidate_generation-1_availability",
        lexical: "watch_search_candidate_generation-1_lexical",
        transcript: "watch_search_transcripts_20260809",
      }
      if (alias === TYPESENSE_WATCH_CATALOG_ALIAS) collections.catalog = alias
      if (alias === TYPESENSE_WATCH_AVAILABILITY_ALIAS) {
        collections.availability = alias
      }
      if (alias === TYPESENSE_WATCH_LEXICAL_ALIAS) collections.lexical = alias
      if (alias === TYPESENSE_WATCH_TRANSCRIPT_ALIAS) {
        collections.transcript = alias
      }
      expect(() =>
        createCandidateWatchSearchProfile(
          {
            generationId: "generation-1",
            applicationRevision: "revision-1",
            transcriptProjectionRevision: 7n,
            fieldManifests,
            collections,
          },
          { qrelsRevision: null, rankingRevision: "title-and-brand-v1" },
        ),
      ).toThrow(TypesenseWatchSearchProfileError)
    },
  )

  it("resolves current aliases once for a qualification lease", async () => {
    const aliases = new Map([
      [TYPESENSE_WATCH_CATALOG_ALIAS, "watch_search_catalog_current-1"],
      [
        TYPESENSE_WATCH_AVAILABILITY_ALIAS,
        "watch_search_availability_current-1",
      ],
      [TYPESENSE_WATCH_LEXICAL_ALIAS, "watch_search_lexical_current-1"],
      [TYPESENSE_WATCH_TRANSCRIPT_ALIAS, "watch_search_transcripts_current-1"],
    ])
    const getAlias = vi.fn(async (name: string) => {
      const collectionName = aliases.get(name)
      return collectionName
        ? { name, collection_name: collectionName }
        : undefined
    })

    const frozen = await freezeCurrentWatchSearchProfile({ getAlias })
    aliases.set(TYPESENSE_WATCH_CATALOG_ALIAS, "watch_search_catalog_current-2")

    expect(frozen.binding.catalog).toBe("watch_search_catalog_current-1")
    expect(frozen.allowCompatibilityFallback).toBe(false)
    expect(watchSearchBindingMembers(frozen)).toEqual([
      "watch_search_catalog_current-1",
      "watch_search_availability_current-1",
      "watch_search_lexical_current-1",
      "watch_search_transcripts_current-1",
    ])
    expect(getAlias).toHaveBeenCalledTimes(4)
  })

  it("constructs a candidate only after exact generation validation", async () => {
    const resolveGeneration = vi.fn(async () => ({
      generationId: "generation-1",
      applicationRevision: "revision-1",
      transcriptProjectionRevision: 7n,
      fieldManifests,
      collections: {
        catalog: "watch_search_candidate_generation-1_catalog",
        availability: "watch_search_candidate_generation-1_availability",
        lexical: "watch_search_candidate_generation-1_lexical",
        transcript: "watch_search_transcripts_20260809",
      },
    }))

    const profile = await resolveCandidateWatchSearchProfile({
      generations: { resolveGeneration },
      generationId: "generation-1",
      applicationRevision: "revision-1",
      transcriptCollection: "watch_search_transcripts_20260809",
      transcriptProjectionRevision: 7n,
      requireQualified: true,
      currentBindings: ["current-catalog", "current-transcript"],
      qrelsRevision: "qrels-1",
      rankingRevision: "title-and-brand-v1",
    })

    expect(resolveGeneration).toHaveBeenCalledWith({
      generationId: "generation-1",
      applicationRevision: "revision-1",
      transcriptCollection: "watch_search_transcripts_20260809",
      transcriptProjectionRevision: 7n,
      requireQualified: true,
      currentBindings: ["current-catalog", "current-transcript"],
      qrelsRevision: "qrels-1",
      rankingRevision: "title-and-brand-v1",
    })
    expect(profile.generationId).toBe("generation-1")
    expect(profile.rankingRevision).toBe("title-and-brand-v1")
  })

  it("does not construct a candidate when exact generation validation fails", async () => {
    await expect(
      resolveCandidateWatchSearchProfile({
        generations: {
          resolveGeneration: vi.fn(async () => {
            throw new Error("candidate generation is not READY")
          }),
        },
        generationId: "generation-1",
        applicationRevision: "revision-1",
        transcriptCollection: "watch_search_transcripts_20260809",
        transcriptProjectionRevision: 7n,
        rankingRevision: "title-and-brand-v1",
      }),
    ).rejects.toThrow("not READY")
  })

  it("rejects an unknown resolved ranker before generation lookup", async () => {
    const resolveGeneration = vi.fn()

    await expect(
      resolveCandidateWatchSearchProfile({
        generations: { resolveGeneration },
        generationId: "generation-1",
        applicationRevision: "revision-1",
        transcriptCollection: "watch_search_transcripts_20260809",
        transcriptProjectionRevision: 7n,
        rankingRevision: "unknown-ranker",
      }),
    ).rejects.toThrow(TypesenseWatchSearchProfileError)
    expect(resolveGeneration).not.toHaveBeenCalled()
  })

  it("fails closed when a current alias cannot be frozen", async () => {
    await expect(
      freezeCurrentWatchSearchProfile({
        getAlias: vi.fn(async () => undefined),
      }),
    ).rejects.toThrow(TypesenseWatchSearchProfileError)
  })

  it("accepts only the exact renewable qualification lease identity", async () => {
    const current = await freezeCurrentWatchSearchProfile({
      getAlias: vi.fn(async (name: string) => ({
        name,
        collection_name: `${name}_physical-1`,
      })),
    })
    const candidate = createCandidateWatchSearchProfile(
      {
        generationId: "generation-1",
        applicationRevision: "revision-1",
        transcriptProjectionRevision: 7n,
        fieldManifests,
        collections: {
          catalog: "watch_search_candidate_generation-1_catalog",
          availability: "watch_search_candidate_generation-1_availability",
          lexical: "watch_search_candidate_generation-1_lexical",
          transcript: "watch_search_transcripts_physical-1",
        },
      },
      { qrelsRevision: null, rankingRevision: "title-and-brand-v1" },
    )
    const lease = {
      generationId: "generation-1",
      applicationRevision: "revision-1",
      transcriptCollection: "watch_search_transcripts_physical-1",
      transcriptProjectionRevision: 7n,
      currentBindings: watchSearchBindingMembers(current),
      expiresAt: new Date("2026-08-10T00:01:00.000Z"),
    }

    expect(() =>
      assertQualificationProfilesMatchLease({
        current,
        candidate,
        lease,
        now: new Date("2026-08-10T00:00:00.000Z"),
      }),
    ).not.toThrow()
    expect(() =>
      assertQualificationProfilesMatchLease({
        current,
        candidate,
        lease,
        now: lease.expiresAt,
      }),
    ).toThrow("expired")
    expect(() =>
      assertQualificationProfilesMatchLease({
        current,
        candidate,
        lease: { ...lease, currentBindings: ["drifted"] },
        now: new Date("2026-08-10T00:00:00.000Z"),
      }),
    ).toThrow("drifted")
  })
})
