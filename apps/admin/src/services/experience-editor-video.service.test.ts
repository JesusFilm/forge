import type { PrismaClient } from "@prisma/client"
import { describe, expect, it, vi } from "vitest"
import {
  applyIntentionalExperienceEditorDubChoice,
  createExperienceEditorDubChoice,
  deduplicateExperienceEditorDubs,
  editorDubStreamUrl,
  EMPTY_EXPERIENCE_EDITOR_DUB_INVENTORY,
  experienceEditorLanguageIdentity,
  EXPERIENCE_EDITOR_VIDEO_BATCH_SIZE,
  ExperienceEditorVideoInputError,
  ExperienceEditorVideoNotFoundError,
  loadExperienceEditorCollectionChildPage,
  loadExperienceEditorDubPage,
  validateExperienceEditorDubSelections,
  loadExperienceEditorVideoSummariesByIds,
  loadExperienceEditorVideoSummaryList,
  NOT_LOADED_EXPERIENCE_EDITOR_DUB_INVENTORY,
  resolveExperienceEditorDub,
  type ExperienceEditorDubCandidate,
} from "./experience-editor-video.service"

function dub(
  overrides: Partial<ExperienceEditorDubCandidate> &
    Pick<ExperienceEditorDubCandidate, "id">,
): ExperienceEditorDubCandidate {
  return {
    videoId: "video-1",
    languageId: "language-en",
    deletedAt: null,
    updatedAt: new Date("2026-09-14T12:00:00.000Z"),
    hls: null,
    dash: null,
    share: null,
    duration: null,
    lengthInMilliseconds: null,
    language: {
      id: "language-en",
      slug: "english",
      bcp47: "en",
      iso3: "eng",
      name: { en: "English" },
    },
    ...overrides,
  }
}

describe("experience editor dub semantics", () => {
  it("keeps editor eligibility independent of published state and prefers HLS within a dub", () => {
    const choice = createExperienceEditorDubChoice(
      dub({
        id: "dub-any-stream",
        published: false,
        hls: " https://media.example/video.m3u8 ",
        dash: "https://media.example/video.mpd",
        share: "https://media.example/video.mp4",
        lengthInMilliseconds: BigInt(125_900),
      }),
      "en",
    )

    expect(editorDubStreamUrl(dub({ id: "dash", dash: "dash-url" }))).toBe(
      "dash-url",
    )
    expect(choice).toMatchObject({
      key: "dub-any-stream",
      streamUrl: "https://media.example/video.m3u8",
      durationSeconds: 125,
    })
    expect(
      createExperienceEditorDubChoice(
        dub({ id: "deleted", deletedAt: new Date(), hls: "hls-url" }),
        "en",
      ),
    ).toBeNull()
    expect(
      createExperienceEditorDubChoice(dub({ id: "empty", hls: "  " }), "en"),
    ).toBeNull()
  })

  it("resolves language before a mismatched legacy stream, then legacy before locale fallback", () => {
    const english = dub({ id: "dub-en", hls: "en-hls" })
    const french = dub({
      id: "dub-fr",
      languageId: "language-fr",
      hls: "fr-hls",
      language: {
        id: "language-fr",
        slug: "french",
        bcp47: "fr",
        iso3: "fra",
        name: { en: "French" },
      },
    })

    expect(
      resolveExperienceEditorDub([english, french], "fr", {
        videoId: "video-1",
        languageId: "language-en",
        legacyStreamingUrl: "fr-hls",
      })?.id,
    ).toBe("dub-en")
    expect(
      resolveExperienceEditorDub([english, french], "en", {
        videoId: "video-1",
        languageId: null,
        legacyStreamingUrl: "fr-hls",
      })?.id,
    ).toBe("dub-fr")
    expect(resolveExperienceEditorDub([english, french], "fr", null)?.id).toBe(
      "dub-fr",
    )
  })

  it("uses locale before protocol fallback and stable ids for equal timestamps", () => {
    const localeDash = dub({
      id: "dub-fr-dash",
      languageId: "language-fr",
      dash: "fr-dash",
      language: {
        id: "language-fr",
        slug: "french",
        bcp47: "fr-CA",
        iso3: "fra",
        name: { en: "French" },
      },
    })
    const laterIdHls = dub({ id: "dub-z", hls: "z-hls" })
    const earlierIdHls = dub({ id: "dub-a", hls: "a-hls" })

    expect(
      resolveExperienceEditorDub(
        [laterIdHls, earlierIdHls, localeDash],
        "fr-CA",
        null,
      )?.id,
    ).toBe("dub-fr-dash")
    expect(
      resolveExperienceEditorDub(
        [laterIdHls, earlierIdHls, localeDash],
        "de",
        null,
      )?.id,
    ).toBe("dub-a")
  })

  it("deduplicates language identities by slug, bcp47, iso3, language id, then dub id", () => {
    const newer = dub({
      id: "dub-z-newer",
      hls: "newer-hls",
      updatedAt: new Date("2026-09-14T13:00:00.000Z"),
    })
    const older = dub({ id: "dub-a-older", hls: "older-hls" })
    const languageIdOnly = dub({
      id: "dub-id-only",
      languageId: "language-id-only",
      dash: "id-only-dash",
      language: {
        id: "language-id-only",
        slug: null,
        bcp47: null,
        iso3: null,
        name: {},
      },
    })
    const noLanguage = dub({
      id: "dub-no-language",
      languageId: null,
      share: "share-url",
      language: null,
    })

    expect(
      deduplicateExperienceEditorDubs(
        [older, noLanguage, languageIdOnly, newer],
        "en",
      ).map((choice) => choice.key),
    ).toEqual(["dub-z-newer", "dub-id-only", "dub-no-language"])
    expect(
      experienceEditorLanguageIdentity(
        dub({
          id: "dub-bcp47",
          languageId: "language-bcp47",
          language: {
            id: "language-bcp47",
            slug: null,
            bcp47: "PT-BR",
            iso3: "por",
            name: {},
          },
        }),
      ),
    ).toBe("pt-br")
    expect(
      experienceEditorLanguageIdentity(
        dub({
          id: "dub-iso3",
          languageId: "language-iso3",
          language: {
            id: "language-iso3",
            slug: null,
            bcp47: null,
            iso3: "SPA",
            name: {},
          },
        }),
      ),
    ).toBe("spa")
  })

  it("distinguishes an omitted inventory from a loaded empty page", () => {
    expect(NOT_LOADED_EXPERIENCE_EDITOR_DUB_INVENTORY).toEqual({
      status: "not-loaded",
    })
    expect(EMPTY_EXPERIENCE_EDITOR_DUB_INVENTORY).toEqual({
      status: "loaded",
      choices: [],
      nextCursor: null,
    })
  })

  it("keeps background fallback read-only and resets clips only for an intentional language change", () => {
    const english = createExperienceEditorDubChoice(
      dub({ id: "dub-en", hls: "en-hls" }),
      "en",
    )!
    const french = createExperienceEditorDubChoice(
      dub({
        id: "dub-fr",
        languageId: "language-fr",
        hls: "fr-hls",
        language: {
          id: "language-fr",
          slug: "french",
          bcp47: "fr",
          iso3: "fra",
          name: { en: "French" },
        },
      }),
      "en",
    )!
    const authored = {
      languageId: "language-en",
      streamingUrl: "legacy-en-url",
      clipStartSeconds: 12,
      clipEndSeconds: 34,
      title: "Keep me",
    }

    resolveExperienceEditorDub([dub({ id: "dub-en", hls: "en-hls" })], "en", {
      videoId: "video-1",
      languageId: authored.languageId,
      legacyStreamingUrl: authored.streamingUrl,
    })
    expect(authored).toEqual({
      languageId: "language-en",
      streamingUrl: "legacy-en-url",
      clipStartSeconds: 12,
      clipEndSeconds: 34,
      title: "Keep me",
    })
    expect(applyIntentionalExperienceEditorDubChoice(authored, english)).toBe(
      authored,
    )
    expect(applyIntentionalExperienceEditorDubChoice(authored, french)).toEqual(
      {
        languageId: "language-fr",
        streamingUrl: undefined,
        clipStartSeconds: 0,
        clipEndSeconds: undefined,
        title: "Keep me",
      },
    )
  })
})

type SummarySelection = {
  videoId: string
  coreId: string
  slug: string
  label: null
  videoSource: null
  updatedAt: Date
  title: string
  description: null
  previewImageUrl: null
  playableLanguageCount: bigint
  defaultDubId: string | null
  chipDubIds: string[]
  authoredDubIds: string[]
  childCount: bigint
  collectionPreviewItems: unknown[]
  hasGrounding: boolean
}

function summarySelection(
  videoId: string,
  overrides: Partial<SummarySelection> = {},
): SummarySelection {
  return {
    videoId,
    coreId: `core-${videoId}`,
    slug: `slug-${videoId}`,
    label: null,
    videoSource: null,
    updatedAt: new Date("2026-09-14T12:00:00.000Z"),
    title: `Title ${videoId}`,
    description: null,
    previewImageUrl: null,
    playableLanguageCount: 0n,
    defaultDubId: null,
    chipDubIds: [],
    authoredDubIds: [],
    childCount: 0n,
    collectionPreviewItems: [],
    hasGrounding: false,
    ...overrides,
  }
}

function summaryDb(
  selections: SummarySelection[] | SummarySelection[][],
  hydratedDubs: ExperienceEditorDubCandidate[] = [],
) {
  const pages = Array.isArray(selections[0])
    ? (selections as SummarySelection[][])
    : [selections as SummarySelection[]]
  const raw = vi.fn()
  for (const page of pages) raw.mockResolvedValueOnce(page)
  const hydrate = vi.fn().mockImplementation(async ({ where }) => {
    const ids = new Set(where.id.in as string[])
    return hydratedDubs
      .filter((item) => ids.has(item.id))
      .map((item) => ({
        ...item,
        language: item.language
          ? { ...item.language, countryLanguages: [] }
          : null,
      }))
  })
  return {
    db: {
      $queryRaw: raw,
      videoDub: { findMany: hydrate },
    } as unknown as PrismaClient,
    hydrate,
    raw,
  }
}

function sqlText(raw: ReturnType<typeof vi.fn>, call = 0) {
  const query = raw.mock.calls[call]?.[0] as
    | { strings?: readonly string[] }
    | undefined
  return query?.strings?.join("?") ?? ""
}

describe("bounded experience editor video summaries", () => {
  it("selects counts and winners in SQL, then hydrates only the bounded chosen Dub ids", async () => {
    const english = dub({ id: "dub-default", hls: "default-hls" })
    const french = dub({
      id: "dub-chip-fr",
      languageId: "language-fr",
      dash: "fr-dash",
      language: {
        id: "language-fr",
        slug: "french",
        bcp47: "fr",
        iso3: "fra",
        name: { en: "French" },
      },
    })
    const authored = dub({
      id: "dub-authored",
      languageId: "language-es",
      share: "es-share",
      language: {
        id: "language-es",
        slug: "spanish",
        bcp47: "es",
        iso3: "spa",
        name: { en: "Spanish" },
      },
    })
    const { db, hydrate, raw } = summaryDb(
      [
        summarySelection("video-1", {
          playableLanguageCount: 143_000n,
          defaultDubId: english.id,
          chipDubIds: [english.id, french.id],
          authoredDubIds: [authored.id],
        }),
      ],
      [english, french, authored],
    )

    const result = await loadExperienceEditorVideoSummaryList(db, {
      videoIds: ["video-1"],
      locale: "en",
      authoredSelectors: [
        {
          videoId: "video-1",
          languageId: "language-es",
          legacyStreamingUrl: null,
        },
      ],
    })

    expect(raw).toHaveBeenCalledOnce()
    expect(hydrate).toHaveBeenCalledOnce()
    expect(hydrate.mock.calls[0]?.[0].where.id.in).toEqual([
      "dub-default",
      "dub-chip-fr",
      "dub-authored",
    ])
    expect(result[0]).toMatchObject({
      playableLanguageCount: 143_000,
      defaultDub: { key: "dub-default" },
      authoredDubs: [{ key: "dub-authored" }],
      dubInventory: { status: "not-loaded" },
    })
    expect(sqlText(raw)).toMatch(/language_winners AS MATERIALIZED/)
    expect(sqlText(raw)).toMatch(/count\(\*\)::bigint AS language_count/)
    expect(sqlText(raw)).toMatch(
      /row_number\(\) OVER \([\s\S]*PARTITION BY e\.video_id, e\.language_identity[\s\S]*e\.updated_at DESC NULLS LAST, e\.id ASC/,
    )
    expect(sqlText(raw)).not.toMatch(/d\.published/)
  })

  it("keeps Dub hydration constant when the aggregate inventory grows", async () => {
    for (const count of [1_000n, 100_000n]) {
      const selected = dub({ id: "dub-selected", hls: "selected-hls" })
      const { db, hydrate } = summaryDb(
        [
          summarySelection("video-1", {
            playableLanguageCount: count,
            defaultDubId: selected.id,
            chipDubIds: [selected.id],
          }),
        ],
        [selected],
      )
      await loadExperienceEditorVideoSummariesByIds(db, {
        videoIds: ["video-1"],
        locale: "en",
      })
      expect(hydrate.mock.calls[0]?.[0].where.id.in).toHaveLength(1)
    }
  })

  it("returns only existing exact ids in requested order and deduplicates first occurrence", async () => {
    const { db, raw } = summaryDb([
      summarySelection("video-3"),
      summarySelection("video-1"),
    ])

    const result = await loadExperienceEditorVideoSummariesByIds(db, {
      videoIds: ["video-3", "missing", "video-1", "video-3"],
      locale: "en",
    })

    expect(result.map((item) => item.key)).toEqual(["video-3", "video-1"])
    const query = raw.mock.calls[0]?.[0] as { values?: unknown[] }
    expect(JSON.parse(String(query.values?.[0]))).toEqual([
      { video_id: "video-3", requested_order: 0 },
      { video_id: "missing", requested_order: 1 },
      { video_id: "video-1", requested_order: 2 },
    ])
  })

  it("keeps multiple authored languages for one video in selector order", async () => {
    const english = dub({ id: "dub-en", hls: "en-hls" })
    const french = dub({
      id: "dub-fr",
      languageId: "language-fr",
      hls: "fr-hls",
      language: {
        id: "language-fr",
        slug: "french",
        bcp47: "fr",
        iso3: "fra",
        name: { en: "French" },
      },
    })
    const { db, raw } = summaryDb(
      [
        summarySelection("video-1", {
          authoredDubIds: [french.id, english.id],
          playableLanguageCount: 2n,
        }),
      ],
      [english, french],
    )
    const selectors = [
      {
        videoId: "video-1",
        languageId: "language-fr",
        legacyStreamingUrl: null,
      },
      {
        videoId: "video-1",
        languageId: "language-en",
        legacyStreamingUrl: null,
      },
    ]

    const [result] = await loadExperienceEditorVideoSummariesByIds(db, {
      videoIds: ["video-1"],
      locale: "en",
      authoredSelectors: selectors,
    })

    expect(result?.authoredDubs.map((choice) => choice.key)).toEqual([
      "dub-fr",
      "dub-en",
    ])
    const query = raw.mock.calls[0]?.[0] as { values?: unknown[] }
    expect(JSON.parse(String(query.values?.[1]))).toEqual([
      {
        video_id: "video-1",
        language_id: "language-fr",
        legacy_streaming_url: null,
        selector_order: 0,
      },
      {
        video_id: "video-1",
        language_id: "language-en",
        legacy_streaming_url: null,
        selector_order: 1,
      },
    ])
  })

  it("splits more than 100 ids into bounded batches without changing order", async () => {
    const ids = Array.from(
      { length: EXPERIENCE_EDITOR_VIDEO_BATCH_SIZE + 2 },
      (_, index) => `video-${index}`,
    )
    const { db, raw, hydrate } = summaryDb([
      ids
        .slice(0, EXPERIENCE_EDITOR_VIDEO_BATCH_SIZE)
        .map((id) => summarySelection(id)),
      ids
        .slice(EXPERIENCE_EDITOR_VIDEO_BATCH_SIZE)
        .map((id) => summarySelection(id)),
    ])

    const result = await loadExperienceEditorVideoSummariesByIds(db, {
      videoIds: ids,
      locale: "en",
    })

    expect(raw).toHaveBeenCalledTimes(2)
    expect(hydrate).not.toHaveBeenCalled()
    expect(result.map((item) => item.key)).toEqual(ids)
    for (const [query] of raw.mock.calls) {
      const requested = JSON.parse(String(query.values?.[0])) as unknown[]
      expect(requested.length).toBeLessThanOrEqual(
        EXPERIENCE_EDITOR_VIDEO_BATCH_SIZE,
      )
    }
  })

  it("represents a zero-playable video as a loaded summary with omitted inventory", async () => {
    const { db, hydrate } = summaryDb([summarySelection("video-empty")])

    const [result] = await loadExperienceEditorVideoSummariesByIds(db, {
      videoIds: ["video-empty"],
      locale: "en",
    })

    expect(hydrate).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      key: "video-empty",
      playableLanguageCount: 0,
      dubs: "No dubs",
      defaultDub: null,
      authoredDubs: [],
      dubInventory: { status: "not-loaded" },
    })
  })
})

describe("bounded experience editor language and collection pages", () => {
  function pageDb(rawPages: unknown[]) {
    const raw = vi.fn()
    for (const page of rawPages) raw.mockResolvedValueOnce(page)
    return {
      db: {
        $queryRaw: raw,
        video: { findFirst: vi.fn().mockResolvedValue({ id: "video-1" }) },
        videoDub: { findMany: vi.fn() },
      } as unknown as PrismaClient,
      raw,
    }
  }

  const dubRow = (id: string, languageId: string, label: string) => ({
    id,
    videoId: "video-1",
    languageId,
    languageSlug: label.toLowerCase(),
    bcp47: label.slice(0, 2).toLowerCase(),
    iso3: label.slice(0, 3).toLowerCase(),
    languageName: label,
    hls: `${id}.m3u8`,
    dash: null,
    share: null,
    duration: 120,
    lengthInMilliseconds: null,
    updatedAt: new Date("2026-09-14T12:00:00.000Z"),
    languageIdentity: languageId,
    sortLabel: label.toLowerCase(),
  })

  it("defaults to 50, clamps above 100, and rejects invalid page sizes", async () => {
    const { db, raw } = pageDb([[]])
    await loadExperienceEditorDubPage(db, { videoId: "video-1", locale: "en" })
    expect((raw.mock.calls[0]?.[0] as { values?: unknown[] }).values).toContain(
      51,
    )

    const clamped = pageDb([[]])
    await loadExperienceEditorDubPage(clamped.db, {
      videoId: "video-1",
      locale: "en",
      pageSize: 500,
    })
    expect(
      (clamped.raw.mock.calls[0]?.[0] as { values?: unknown[] }).values,
    ).toContain(101)

    for (const pageSize of [0, -1, 1.5]) {
      await expect(
        loadExperienceEditorDubPage(db, {
          videoId: "video-1",
          locale: "en",
          pageSize,
        }),
      ).rejects.toBeInstanceOf(ExperienceEditorVideoInputError)
    }
  })

  it("returns an off-page selected choice separately and binds cursors to video and normalized search", async () => {
    const rows = Array.from({ length: 3 }, (_, index) =>
      dubRow(`dub-${index}`, `language-${index}`, `Language ${index}`),
    )
    const { db } = pageDb([rows, [dubRow("selected", "selected-lang", "Zulu")]])
    const first = await loadExperienceEditorDubPage(db, {
      videoId: "video-1",
      locale: "en",
      query: "  LANGUAGE ",
      pageSize: 2,
      selectedLanguageId: "selected-lang",
    })
    expect(first.choices.map((choice) => choice.key)).toEqual([
      "dub-0",
      "dub-1",
    ])
    expect(first.selectedChoice?.key).toBe("selected")
    expect(first.nextCursor).toEqual(expect.any(String))

    await expect(
      loadExperienceEditorDubPage(pageDb([[]]).db, {
        videoId: "video-2",
        locale: "en",
        query: "different",
        cursor: first.nextCursor,
      }),
    ).rejects.toBeInstanceOf(ExperienceEditorVideoInputError)
  })

  it("searches before take by localized label, codes, and duration text", async () => {
    const { db, raw } = pageDb([[]])
    await loadExperienceEditorDubPage(db, {
      videoId: "video-1",
      locale: "es",
      query: "12:34",
    })
    const sql = sqlText(raw)
    expect(sql).toMatch(/language_locale/)
    expect(sql).toMatch(/bcp47/)
    expect(sql).toMatch(/iso3/)
    expect(sql).toMatch(/duration_text/)
    expect(sql.indexOf("search_text")).toBeLessThan(sql.indexOf("LIMIT"))
  })

  it("returns stable bounded collection pages using nullable order, creation time, and relation id", async () => {
    const relations = Array.from({ length: 3 }, (_, index) => ({
      relationId: `relation-${index}`,
      childId: `child-${index}`,
      order: index === 2 ? null : 1,
      createdAt: new Date("2026-09-14T12:00:00.000Z").toISOString(),
    }))
    const { db, raw } = pageDb([[{ relationRows: relations, total: 3n }]])
    raw.mockResolvedValueOnce([
      summarySelection("child-0"),
      summarySelection("child-1"),
    ])
    const page = await loadExperienceEditorCollectionChildPage(db, {
      parentVideoId: "video-1",
      locale: "en",
      pageSize: 2,
    })
    expect(page.items.map((item) => item.key)).toEqual(["child-0", "child-1"])
    expect(page.total).toBe(3)
    expect(page.nextCursor).toEqual(expect.any(String))
    expect(sqlText(raw)).toMatch(/order ASC NULLS LAST/)
    expect(sqlText(raw)).toMatch(/created_at ASC/)
    expect(sqlText(raw)).toMatch(/relation\.id ASC/)
  })

  it("fails missing videos before exposing options", async () => {
    const { db, raw } = pageDb([])
    vi.mocked(db.video.findFirst).mockResolvedValueOnce(null)
    await expect(
      loadExperienceEditorDubPage(db, { videoId: "missing", locale: "en" }),
    ).rejects.toBeInstanceOf(ExperienceEditorVideoNotFoundError)
    expect(raw).not.toHaveBeenCalled()
  })
})

describe("experience editor selection validation", () => {
  it("validates in batches of at most 100 and distinguishes retained unavailable selections", async () => {
    const raw = vi.fn().mockResolvedValue([])
    const db = { $queryRaw: raw } as unknown as PrismaClient
    const selectors = Array.from({ length: 101 }, (_, index) => ({
      videoId: `video-${index}`,
      languageId: `language-${index}`,
      legacyStreamingUrl: null,
    }))
    const result = await validateExperienceEditorDubSelections(db, {
      selectors,
      previousSelectors: [selectors[0]!],
      locale: "en",
    })
    expect(raw).toHaveBeenCalledTimes(2)
    for (const [query] of raw.mock.calls) {
      const input = JSON.parse(String(query.values?.[0])) as unknown[]
      expect(input.length).toBeLessThanOrEqual(100)
    }
    expect(result.unavailable[0]).toMatchObject({ preExisting: true })
    expect(result.unavailable[100]).toMatchObject({ preExisting: false })
  })
})
