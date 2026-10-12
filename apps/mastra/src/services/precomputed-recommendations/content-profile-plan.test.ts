import { describe, expect, it } from "vitest"

import {
  readCompleteSelectedChunks,
  SelectedTranscriptError,
} from "./selected-transcript"
import { planContentProfile } from "./content-profile-plan"
import type { Chunk, SourceCatalog, Video } from "./source-generation"

const cutoff = "2026-10-06T20:48:05.001Z"

function video(): Video {
  return {
    id: "video-one",
    coreId: "core-one",
    slug: "route-one",
    locale: "en",
    title: "A complete story",
    description: "A story with two selected editions.",
    descriptionTruncated: false,
    keywords: ["hope", "family"],
    keywordsTruncated: true,
    bibleCitations: ["John 3:16"],
    bibleCitationsTruncated: false,
    parentVideoIds: [],
    childVideoIds: ["chapter-one"],
    transcriptLanguages: ["en", "fr", "de"],
    transcriptSelection: {
      policy: "english-per-edition-with-complete-fallback-v1",
      availableTranscriptCount: 3,
      incompleteTranscriptCount: 0,
      skippedEditionCount: 0,
      selected: [
        {
          transcriptId: "transcript-en",
          videoEditionId: "edition-a",
          language: "en",
          totalChunks: 2,
        },
        {
          transcriptId: "transcript-fr",
          videoEditionId: "edition-b",
          language: "fr",
          totalChunks: 1,
        },
      ],
    },
  }
}

const chunks: Chunk[] = [
  {
    id: "chunk-a",
    transcriptId: "transcript-en",
    language: "en",
    chunkIndex: 0,
    text: "First complete English passage.",
  },
  {
    id: "chunk-b",
    transcriptId: "transcript-en",
    language: "en",
    chunkIndex: 1,
    text: "Second complete English passage.",
  },
  {
    id: "chunk-c",
    transcriptId: "transcript-fr",
    language: "fr",
    chunkIndex: 0,
    text: "Un passage français complet.",
  },
]

function catalog(pages: Chunk[][]): SourceCatalog {
  return {
    async video() {
      throw new Error("unused")
    },
    async catalog() {
      throw new Error("unused")
    },
    async chunks({ afterChunkId }) {
      const index = afterChunkId
        ? pages.findIndex((page) => page.at(-1)?.id === afterChunkId) + 1
        : 0
      return {
        chunks: pages[index] ?? [],
        nextCursor:
          index + 1 < pages.length ? (pages[index]?.at(-1)?.id ?? null) : null,
      }
    },
  }
}

const identity = {
  modelId: "gpt-6-astra",
  backend: "codex_chatgpt_subscription",
  promptVersion: "profile-v1",
  schemaVersion: "profile-schema-v1",
}

describe("complete selected-content profile planning", () => {
  it("reads every selected English and non-English fallback chunk before planning", async () => {
    const selected = await readCompleteSelectedChunks(
      catalog([chunks.slice(0, 2), chunks.slice(2)]),
      video(),
      cutoff,
    )
    expect(selected.chunks.map((chunk) => chunk.id)).toEqual([
      "chunk-a",
      "chunk-b",
      "chunk-c",
    ])
    expect(selected.hasNonEnglish).toBe(true)
    const plan = planContentProfile({
      video: video(),
      chunks: selected.chunks,
      maxPartBytes: 1_000,
      ...identity,
    })
    expect(plan.selectedChunkCount).toBe(3)
    expect(plan.metadataOnly).toBe(false)
    expect(
      plan.parts.flatMap((part) =>
        part.input.fragments.map((fragment) => fragment.text),
      ),
    ).toEqual(chunks.map((chunk) => chunk.text))
    expect(plan.parts.every((part) => part.inputBytes <= 1_000)).toBe(true)
    expect(
      plan.parts.every(
        (part) =>
          part.inputBytes ===
          Buffer.byteLength(JSON.stringify(part.input), "utf8"),
      ),
    ).toBe(true)
    expect(plan.metadata.keywordsTruncated).toBe(true)
    expect(
      plan.metadata.transcriptSelection?.selected.map((item) => item.language),
    ).toEqual(["en", "fr"])
  })

  it.each([
    [
      "missing selected chunk",
      chunks.slice(0, 2),
      "selected_transcript_incomplete",
    ],
    [
      "foreign transcript",
      [...chunks.slice(0, 2), { ...chunks[2], transcriptId: "transcript-de" }],
      "selected_transcript_incomplete",
    ],
    [
      "wrong language",
      [...chunks.slice(0, 2), { ...chunks[2], language: "de" }],
      "selected_transcript_incomplete",
    ],
    [
      "duplicate index",
      [chunks[0], { ...chunks[1], chunkIndex: 0 }, chunks[2]],
      "selected_transcript_incomplete",
    ],
    [
      "out of order IDs",
      [chunks[1], chunks[0], chunks[2]],
      "chunk_order_changed",
    ],
  ] as const)(
    "refuses %s before any profile work",
    async (_name, bad, reason) => {
      await expect(
        readCompleteSelectedChunks(catalog([[...bad]]), video(), cutoff),
      ).rejects.toMatchObject({ code: "input_stale", reason })
      expect(() =>
        planContentProfile({
          video: video(),
          chunks: bad,
          maxPartBytes: 1_000,
          ...identity,
        }),
      ).toThrow(SelectedTranscriptError)
    },
  )

  it("rejects a cycling cursor rather than rereading a partial transcript forever", async () => {
    const looping: SourceCatalog = {
      ...catalog([]),
      async chunks() {
        return { chunks: [], nextCursor: "same-cursor" }
      },
    }
    await expect(
      readCompleteSelectedChunks(looping, video(), cutoff),
    ).rejects.toMatchObject({
      reason: "cursor_stalled",
    })
  })

  it("splits an oversized Unicode chunk on scalar boundaries without losing a character", () => {
    const one = {
      ...video(),
      transcriptSelection: {
        ...video().transcriptSelection!,
        selected: [
          {
            transcriptId: "transcript-en",
            videoEditionId: "edition-a",
            language: "en",
            totalChunks: 1,
          },
        ],
      },
    } satisfies Video
    const text = "é🙂 passage with full context. ".repeat(200)
    const longChunk = [{ ...chunks[0], text }]
    const plan = planContentProfile({
      video: one,
      chunks: longChunk,
      maxPartBytes: 1_000,
      ...identity,
    })
    expect(plan.parts.length).toBeGreaterThan(1)
    expect(plan.parts.every((part) => part.inputBytes <= 1_000)).toBe(true)
    const fragments = plan.parts.flatMap((part) => part.input.fragments)
    expect(fragments.map((fragment) => fragment.text).join("")).toBe(text)
    expect(
      fragments.every(
        (fragment) =>
          text.slice(fragment.startChar, fragment.endChar) === fragment.text,
      ),
    ).toBe(true)
    expect(plan.sourceTextBytes).toBe(Buffer.byteLength(text, "utf8"))
    expect(
      planContentProfile({
        video: one,
        chunks: longChunk,
        maxPartBytes: 1_000,
        ...identity,
      }).cacheKey,
    ).toBe(plan.cacheKey)
    expect(
      planContentProfile({
        video: one,
        chunks: longChunk,
        maxPartBytes: 2_000,
        ...identity,
      }).cacheKey,
    ).not.toBe(plan.cacheKey)
  })

  it("packs more than eight small complete chunks when the actual bytes fit", () => {
    const many = {
      ...video(),
      transcriptSelection: {
        ...video().transcriptSelection!,
        selected: [
          {
            transcriptId: "transcript-en",
            videoEditionId: "edition-a",
            language: "en",
            totalChunks: 12,
          },
        ],
      },
    } satisfies Video
    const small: Chunk[] = Array.from({ length: 12 }, (_, index) => ({
      ...chunks[0],
      id: `chunk-${String(index).padStart(2, "0")}`,
      chunkIndex: index,
      text: "hi",
    }))
    const plan = planContentProfile({
      video: many,
      chunks: small,
      maxPartBytes: 10_000,
      ...identity,
    })
    expect(plan.parts).toHaveLength(1)
    expect(plan.parts[0]?.input.fragments).toHaveLength(12)
  })

  it("keys on selected content, truncation flags and execution identity, not routes or GA", () => {
    const base = planContentProfile({
      video: video(),
      chunks,
      maxPartBytes: 1_000,
      ...identity,
    })
    const changed = (overrides: Partial<Video>) =>
      planContentProfile({
        video: { ...video(), ...overrides },
        chunks,
        maxPartBytes: 1_000,
        ...identity,
      }).cacheKey
    expect(
      changed({ slug: "new-route", transcriptLanguages: ["en", "fr", "es"] }),
    ).toBe(base.cacheKey)
    expect(
      changed({
        watchRouteIdentity: {
          basis: "current_catalog_cutoff_fenced",
          parentSlugs: ["new-parent"],
          playableAudioLanguageSlugs: ["es"],
          truncated: false,
        },
      }),
    ).toBe(base.cacheKey)
    expect(
      changed({
        transcriptSelection: {
          ...video().transcriptSelection!,
          availableTranscriptCount: 20,
        },
      }),
    ).toBe(base.cacheKey)
    expect(changed({ keywordsTruncated: false })).not.toBe(base.cacheKey)
    expect(changed({ descriptionTruncated: true })).not.toBe(base.cacheKey)
    expect(changed({ bibleCitationsTruncated: true })).not.toBe(base.cacheKey)
    expect(changed({ title: "Changed title" })).not.toBe(base.cacheKey)
    expect(
      changed({
        transcriptSelection: {
          ...video().transcriptSelection!,
          selected: [
            {
              ...video().transcriptSelection!.selected[0],
              videoEditionId: "new-edition",
            },
            video().transcriptSelection!.selected[1],
          ],
        },
      }),
    ).not.toBe(base.cacheKey)
    expect(
      planContentProfile({
        video: video(),
        chunks: [...chunks.slice(0, 2), { ...chunks[2], text: "Changed." }],
        maxPartBytes: 1_000,
        ...identity,
      }).cacheKey,
    ).not.toBe(base.cacheKey)
    for (const key of [
      "modelId",
      "backend",
      "promptVersion",
      "schemaVersion",
    ] as const)
      expect(
        planContentProfile({
          video: video(),
          chunks,
          maxPartBytes: 1_000,
          ...identity,
          [key]: `${identity[key]}-v2`,
        }).cacheKey,
      ).not.toBe(base.cacheKey)
    const mutable = video()
    const isolated = planContentProfile({
      video: mutable,
      chunks,
      maxPartBytes: 1_000,
      ...identity,
    })
    mutable.keywords.push("later mutation")
    expect(isolated.metadata.keywords).toEqual(["hope", "family"])
  })

  it("marks an explicit empty selection as metadata-only and emits no model parts", () => {
    const metadataOnly = {
      ...video(),
      transcriptSelection: {
        ...video().transcriptSelection!,
        selected: [],
      },
    } satisfies Video
    const plan = planContentProfile({
      video: metadataOnly,
      chunks: [],
      maxPartBytes: 1_000,
      ...identity,
    })
    expect(plan.metadataOnly).toBe(true)
    expect(plan.parts).toEqual([])
    expect(plan.selectedChunkCount).toBe(0)
  })

  it("requires explicit selection and a part budget that fits the exact envelope", () => {
    expect(() =>
      planContentProfile({
        video: { ...video(), transcriptSelection: undefined },
        chunks,
        maxPartBytes: 1_000,
        ...identity,
      }),
    ).toThrowError("selection_unavailable")
    expect(() =>
      planContentProfile({
        video: video(),
        chunks,
        maxPartBytes: 32,
        ...identity,
      }),
    ).toThrowError("part_budget_too_small")
  })
})
