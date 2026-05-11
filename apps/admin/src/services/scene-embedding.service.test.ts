// Unit tests for indexEditionScenes.
//
// DB interactions are tested against a stub Prisma client that mirrors
// the call surface we use after Stage 3 (feat-117): $transaction +
// videoSceneLocale.deleteMany + tx.$executeRaw (bulk parent INSERT and
// bulk locale INSERT) + tx.$queryRaw (parent id-recovery SELECT). True
// end-to-end verification against a live Postgres with pgvector is
// covered by Unit 7's smoke test plus the Stage 3 manual prod smoke run.

import { describe, expect, it, vi, beforeEach } from "vitest"
import type { Principal } from "@/auth/principal"
import type { SceneAnalysisResult } from "@/services/manager-artifacts.service"

// Mock the BATCHED form (Stage 2): one provider call per
// (video, locale) target. The mock returns deterministic vectors so
// position-stable ordering is observable in tests.
//
// importOriginal forwards every export from the real module — including
// the real `EmbeddingsBatchError` class. Locally re-defining the class
// would create a structural duplicate with a different identity, so any
// future production code that branches on `instanceof EmbeddingsBatchError`
// would silently bypass the branch under this mock. Keep the real class.
vi.mock("@/services/embeddings.service", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/services/embeddings.service")>()
  return {
    ...actual,
    generateExperienceEmbeddings: vi.fn(async (inputs: readonly string[]) => ({
      model: "nvidia/llama-nemotron-embed-vl-1b-v2:free",
      dimensions: 2048,
      embeddings: inputs.map((_, idx) =>
        Array.from({ length: 2048 }, (__, i) => (idx + 1) * 0.1 + i * 0.0001),
      ),
    })),
  }
})

const { generateExperienceEmbeddings } =
  await import("@/services/embeddings.service")
const { indexEditionScenes } = await import("./scene-embedding.service")

const SYSTEM = { id: null, role: "SYSTEM" } as const satisfies Principal
const ADMIN = { id: "admin-1", role: "ADMIN" } as const satisfies Principal
const VIEWER = { id: "viewer-1", role: "VIEWER" } as const satisfies Principal

type StubPrismaTx = {
  videoSceneLocale: {
    deleteMany: ReturnType<typeof vi.fn>
  }
  $executeRaw: ReturnType<typeof vi.fn>
  $queryRaw: ReturnType<typeof vi.fn>
}

function buildStubPrisma(opts?: {
  prunedCount?: number
  parentRows?: ReadonlyArray<{ id: string; scene_index: number }>
  parentRowsFor?: (sceneIndexes: number[]) => ReadonlyArray<{
    id: string
    scene_index: number
  }>
  /** Bulk INSERT row-counts in call order (parent, then locale, then any subsequent). */
  executeRawAffected?: ReadonlyArray<number>
}) {
  const videoSceneLocaleDeleteMany = vi.fn(async () => ({
    count: opts?.prunedCount ?? 0,
  }))

  // Bulk INSERTs return the affected-row count (Prisma `$executeRaw`
  // returns a number). Default: 1 affected row per call so SQL-shape
  // tests don't need explicit values; tests that assert
  // `embeddingsWritten` provide explicit overrides.
  const affected = opts?.executeRawAffected ?? []
  let executeRawCallIdx = 0
  const executeRaw = vi.fn(async () => {
    const v = affected[executeRawCallIdx] ?? 1
    executeRawCallIdx += 1
    return v
  })

  // The follow-up SELECT recovers `scene_index → id` for every incoming
  // sceneIndex. Default: derive ids from the captured bound text[]
  // literal so tests don't need to re-state the input set. The literal
  // is the second-to-last bound value before the editionId.
  const queryRaw = vi.fn(async (...args: unknown[]) => {
    if (opts?.parentRows) return opts.parentRows
    if (opts?.parentRowsFor) {
      // Args layout: [TemplateStringsArray, editionId, sceneIndexLiteral]
      const literal = args[2] as string | undefined
      if (typeof literal === "string") {
        const inner = literal.slice(1, -1) // strip braces
        const indexes = inner
          .split(",")
          .map((s) => s.replace(/"/g, ""))
          .map((s) => Number(s))
          .filter((n) => Number.isFinite(n))
        return opts.parentRowsFor(indexes)
      }
    }
    // Fallback: synthesize {id, scene_index} pairs by parsing the bound
    // literal from the second positional argument (the toPgArray result).
    const literal = args[2] as string | undefined
    if (typeof literal === "string") {
      const inner = literal.slice(1, -1)
      const indexes = inner
        .split(",")
        .map((s) => s.replace(/"/g, ""))
        .map((s) => Number(s))
        .filter((n) => Number.isFinite(n))
      return indexes.map((idx) => ({ id: `parent-${idx}`, scene_index: idx }))
    }
    return []
  })

  const tx: StubPrismaTx = {
    videoSceneLocale: {
      deleteMany: videoSceneLocaleDeleteMany,
    },
    $executeRaw: executeRaw,
    $queryRaw: queryRaw,
  }

  const prisma = {
    $transaction: vi.fn(
      async (
        fn: (tx: StubPrismaTx) => Promise<void>,
        _opts?: { timeout?: number },
      ) => {
        return fn(tx)
      },
    ),
    ...tx,
  }

  return {
    prisma: prisma as unknown as import("@prisma/client").PrismaClient,
    tx,
    videoSceneLocaleDeleteMany,
    executeRaw,
    queryRaw,
  }
}

const ARTIFACT: SceneAnalysisResult = {
  scenes: [
    {
      sceneIndex: 0,
      startSeconds: 0,
      endSeconds: 10,
      chapterTitle: "Intro",
      description: "Opening shot on a desert road.",
      themes: ["journey"],
      bibleVerses: [],
      demographics: ["adult"],
      spiritualContext: [],
    },
    {
      sceneIndex: 1,
      startSeconds: 10,
      endSeconds: null,
      chapterTitle: null,
      description: "A man kneels to pray at sunset.",
      themes: ["prayer", "solitude"],
      bibleVerses: ["Matthew 6:6"],
      demographics: [],
      spiritualContext: ["devotion"],
    },
  ],
}

describe("indexEditionScenes", () => {
  beforeEach(() => {
    vi.mocked(generateExperienceEmbeddings).mockClear()
  })

  it("rejects principals that cannot write derived columns", async () => {
    const { prisma } = buildStubPrisma()
    await expect(
      indexEditionScenes(prisma, {
        editionId: "edition-1",
        videoId: "video-1",
        coreId: "core-1",
        locale: "en",
        user: VIEWER,
        loadedArtifact: ARTIFACT,
      }),
    ).rejects.toMatchObject({
      name: "SceneIndexError",
      code: "forbidden",
    })
  })

  it("throws missing_cms_video_id when no artifact or id is provided", async () => {
    const { prisma } = buildStubPrisma()
    await expect(
      indexEditionScenes(prisma, {
        editionId: "edition-1",
        videoId: "video-1",
        coreId: "core-1",
        locale: "en",
        user: SYSTEM,
      }),
    ).rejects.toMatchObject({ code: "missing_cms_video_id" })
  })

  it("returns zero counts for an empty artifact without touching the DB", async () => {
    const { prisma, executeRaw, queryRaw } = buildStubPrisma()
    const result = await indexEditionScenes(prisma, {
      editionId: "edition-1",
      videoId: "video-1",
      coreId: "core-1",
      locale: "en",
      user: SYSTEM,
      loadedArtifact: { scenes: [] },
    })
    expect(result.scenesIndexed).toBe(0)
    expect(result.embeddingsWritten).toBe(0)
    expect(executeRaw).not.toHaveBeenCalled()
    expect(queryRaw).not.toHaveBeenCalled()
    // Empty artifact short-circuits BEFORE the provider call too —
    // no point paying for an empty batch.
    expect(generateExperienceEmbeddings).not.toHaveBeenCalled()
  })

  it("throws duplicate_scene_index when an artifact repeats sceneIndex", async () => {
    const { prisma } = buildStubPrisma()
    await expect(
      indexEditionScenes(prisma, {
        editionId: "edition-1",
        videoId: "video-1",
        coreId: "core-1",
        locale: "en",
        user: SYSTEM,
        loadedArtifact: {
          scenes: [
            { ...ARTIFACT.scenes[0]!, sceneIndex: 0 },
            { ...ARTIFACT.scenes[1]!, sceneIndex: 0 },
          ],
        },
      }),
    ).rejects.toMatchObject({ code: "duplicate_scene_index" })
  })

  it("throws empty_description when a scene has no text", async () => {
    const { prisma } = buildStubPrisma()
    await expect(
      indexEditionScenes(prisma, {
        editionId: "edition-1",
        videoId: "video-1",
        coreId: "core-1",
        locale: "en",
        user: SYSTEM,
        loadedArtifact: {
          scenes: [{ ...ARTIFACT.scenes[0]!, description: "   " }],
        },
      }),
    ).rejects.toMatchObject({ code: "empty_description" })
  })

  it("issues exactly ONE batched provider call per target with scene descriptions in order", async () => {
    // Stage 2 contract: one provider call per (video, locale) instead
    // of one per scene. Body.input must be the descriptions in scene-
    // index order so the response's `embeddings[i]` corresponds to
    // `scenes[i]`.
    const { prisma } = buildStubPrisma()
    await indexEditionScenes(prisma, {
      editionId: "edition-1",
      videoId: "video-1",
      coreId: "core-1",
      locale: "en",
      user: ADMIN,
      loadedArtifact: ARTIFACT,
    })

    expect(generateExperienceEmbeddings).toHaveBeenCalledTimes(1)
    expect(generateExperienceEmbeddings).toHaveBeenCalledWith([
      "Opening shot on a desert road.",
      "A man kneels to pray at sunset.",
    ])
  })

  it("collapses per-target writes to: 1 deleteMany + 1 parent INSERT + 1 parent SELECT + 1 locale INSERT (Stage 3)", async () => {
    // Stage 3 (feat-117) contract: per-row upserts collapse to a small
    // CONSTANT number of bulk statements regardless of scenes.length.
    const { prisma, videoSceneLocaleDeleteMany, executeRaw, queryRaw } =
      buildStubPrisma({ executeRawAffected: [2, 2] })

    const result = await indexEditionScenes(prisma, {
      editionId: "edition-1",
      videoId: "video-1",
      coreId: "core-1",
      locale: "en",
      user: ADMIN,
      loadedArtifact: ARTIFACT,
    })

    expect(result.scenesIndexed).toBe(2)
    expect(result.embeddingsWritten).toBe(2)
    expect(result.scenesSkipped).toBe(0)
    expect(result.scenesPruned).toBe(0)
    expect(result.locale).toBe("en")
    expect(generateExperienceEmbeddings).toHaveBeenCalledTimes(1)
    expect(videoSceneLocaleDeleteMany).toHaveBeenCalledTimes(1)
    // EXACTLY 2 $executeRaw calls: parent INSERT + locale INSERT.
    expect(executeRaw).toHaveBeenCalledTimes(2)
    // EXACTLY 1 $queryRaw call: parent id-recovery SELECT.
    expect(queryRaw).toHaveBeenCalledTimes(1)
  })

  it("R1 parent-INSERT SQL invariants — INSERT INTO video_scene + ON CONFLICT DO NOTHING + follow-up SELECT", async () => {
    const { prisma, executeRaw, queryRaw } = buildStubPrisma()
    await indexEditionScenes(prisma, {
      editionId: "edition-1",
      videoId: "video-1",
      coreId: "core-1",
      locale: "en",
      user: SYSTEM,
      loadedArtifact: ARTIFACT,
    })
    // First $executeRaw is the parent INSERT.
    const [parentStrings] = executeRaw.mock.calls[0] as unknown as [
      readonly string[],
      ...unknown[],
    ]
    const parentSql = parentStrings.join("?")
    expect(parentSql).toContain("INSERT INTO video_scene")
    expect(parentSql).toContain("unnest(")
    expect(parentSql).toContain("::text[]")
    expect(parentSql).toMatch(
      /ON\s+CONFLICT\s*\(\s*video_edition_id\s*,\s*scene_index\s*\)\s*DO\s+NOTHING/i,
    )

    // The follow-up SELECT recovers ids for both new and pre-existing parents.
    const [selectStrings] = queryRaw.mock.calls[0] as unknown as [
      readonly string[],
      ...unknown[],
    ]
    const selectSql = selectStrings.join("?")
    expect(selectSql).toMatch(
      /SELECT\s+id\s*,\s*scene_index\s+FROM\s+video_scene/i,
    )
    expect(selectSql).toContain("video_edition_id =")
    expect(selectSql).toContain("scene_index = ANY(")
  })

  it("R1 locale-INSERT SQL invariants — Way A vector cast + text[] casts + ON CONFLICT DO UPDATE + EXCLUDED.embedding", async () => {
    const { prisma, executeRaw } = buildStubPrisma()
    await indexEditionScenes(prisma, {
      editionId: "edition-1",
      videoId: "video-1",
      coreId: "core-1",
      locale: "en",
      user: SYSTEM,
      loadedArtifact: ARTIFACT,
    })
    // Second $executeRaw is the locale INSERT.
    const [strings] = executeRaw.mock.calls[1] as unknown as [
      readonly string[],
      ...unknown[],
    ]
    const sql = strings.join("?")
    expect(sql).toContain("INSERT INTO video_scene_locale")
    expect(sql).toContain("unnest(")
    expect(sql).toContain("::text[]")
    // Way A vector cast — per-row at the SELECT seam, NOT
    // `::vector(2048)[]` on the parameter.
    expect(sql).toContain("::vector(2048)")
    expect(sql).not.toMatch(/::vector\(2048\)\[\]/)
    // Way A text[] unfold for the multi-value PG-array columns.
    expect(sql).toContain("jsonb_array_elements_text")
    expect(sql).toMatch(
      /ON\s+CONFLICT\s*\(\s*video_scene_id\s*,\s*locale\s*\)/i,
    )
    expect(sql).toMatch(/DO\s+UPDATE\s+SET/i)
    expect(sql).toContain("EXCLUDED.embedding")
  })

  it("bind-count regression — parent INSERT and locale INSERT bind a CONSTANT number of params regardless of scenes.length (Stage 3 — feat-117)", async () => {
    // Way A discipline + array-bind pattern: each parallel array binds
    // as ONE positional parameter, so the placeholder count is fixed.
    // A regression to per-row binding (one parameter per scene) would
    // make the bind count grow with N — this test catches it.
    const makeArtifact = (n: number): SceneAnalysisResult => ({
      scenes: Array.from({ length: n }, (_, i) => ({
        sceneIndex: i,
        startSeconds: i * 5,
        endSeconds: (i + 1) * 5,
        chapterTitle: i === 0 ? "Intro" : null,
        description: `Scene ${i} description text.`,
        themes: ["t"],
        bibleVerses: [],
        demographics: [],
        spiritualContext: [],
      })),
    })

    const runWith = async (n: number) => {
      const { prisma, executeRaw } = buildStubPrisma()
      await indexEditionScenes(prisma, {
        editionId: "edition-1",
        videoId: "video-1",
        coreId: "core-1",
        locale: "en",
        user: SYSTEM,
        loadedArtifact: makeArtifact(n),
      })
      const parentCall = executeRaw.mock.calls[0] as unknown as [
        readonly string[],
        ...unknown[],
      ]
      const localeCall = executeRaw.mock.calls[1] as unknown as [
        readonly string[],
        ...unknown[],
      ]
      return {
        parentBindCount: parentCall.length - 1,
        localeBindCount: localeCall.length - 1,
      }
    }

    const small = await runWith(3)
    const large = await runWith(30)

    // Constant bind counts independent of input size.
    expect(small.parentBindCount).toBe(large.parentBindCount)
    expect(small.localeBindCount).toBe(large.localeBindCount)
  })

  it("embedding count mismatch from provider throws BEFORE $executeRaw (length check between provider response and scenes.length)", async () => {
    // Inject a length mismatch: the provider mock returns ONE vector
    // for a TWO-scene artifact. The service's construction-time check
    // throws SceneIndexError("artifact_invalid") and $executeRaw is
    // never invoked.
    vi.mocked(generateExperienceEmbeddings).mockResolvedValueOnce({
      model: "nvidia/llama-nemotron-embed-vl-1b-v2:free",
      dimensions: 2048,
      embeddings: [Array.from({ length: 2048 }, () => 0.5)],
    })

    const { prisma, executeRaw, queryRaw } = buildStubPrisma()
    await expect(
      indexEditionScenes(prisma, {
        editionId: "edition-1",
        videoId: "video-1",
        coreId: "core-1",
        locale: "en",
        user: SYSTEM,
        loadedArtifact: ARTIFACT,
      }),
    ).rejects.toMatchObject({ code: "artifact_invalid" })
    // The bulk INSERTs MUST NOT have run — preflight is the regression
    // guard against PG18's silent NULL-pad on unnest mismatch.
    expect(executeRaw).not.toHaveBeenCalled()
    expect(queryRaw).not.toHaveBeenCalled()
  })

  it("vector position stability — embeddings[i] is bound at position i in the locale INSERT vector array (Stage 2 carry-through)", async () => {
    // The batched provider returns one vector per input in input order;
    // the indexer must thread `embeddings[i]` into the bulk INSERT for
    // `scenes[i]`. A bug that swapped indices would silently land the
    // wrong vector on the wrong scene with no other test catching it.
    const v0 = Array.from({ length: 2048 }, () => 0.111) // for scene 0
    const v1 = Array.from({ length: 2048 }, () => 0.222) // for scene 1
    vi.mocked(generateExperienceEmbeddings).mockResolvedValueOnce({
      model: "nvidia/llama-nemotron-embed-vl-1b-v2:free",
      dimensions: 2048,
      embeddings: [v0, v1],
    })

    const { prisma, executeRaw } = buildStubPrisma()
    await indexEditionScenes(prisma, {
      editionId: "edition-1",
      videoId: "video-1",
      coreId: "core-1",
      locale: "en",
      user: SYSTEM,
      loadedArtifact: ARTIFACT,
    })

    // The locale INSERT is the second $executeRaw call. The vector
    // array literal is one of its bound parameters — find by shape:
    // `{"[0.111,...]","[0.222,...]"}`.
    const localeCall = executeRaw.mock.calls[1] as unknown as [
      readonly string[],
      ...unknown[],
    ]
    const VECTOR_ARRAY_LITERAL_SHAPE = /^\{".*"\}$/
    const ARRAY_OF_VECTORS = /\[[0-9.,-]+\]/g
    const findVectorArrayLiteral = (call: unknown[]): string => {
      for (let i = 1; i < call.length; i += 1) {
        const v = call[i]
        if (
          typeof v === "string" &&
          VECTOR_ARRAY_LITERAL_SHAPE.test(v) &&
          v.includes("[") &&
          v.includes("0.111")
        ) {
          return v
        }
      }
      throw new Error(
        `no vector array literal in locale-INSERT call: ${call.slice(1).map((x) => (typeof x === "string" ? x.slice(0, 80) : x))}`,
      )
    }
    const literal = findVectorArrayLiteral(localeCall)
    const vectors = literal.match(ARRAY_OF_VECTORS) ?? []
    expect(vectors.length).toBe(2)
    expect(vectors[0]).toContain("0.111")
    expect(vectors[0]).not.toContain("0.222")
    expect(vectors[1]).toContain("0.222")
    expect(vectors[1]).not.toContain("0.111")
  })

  it("rejects a null (unauthenticated) principal with forbidden", async () => {
    const { prisma } = buildStubPrisma()
    await expect(
      indexEditionScenes(prisma, {
        editionId: "edition-1",
        videoId: "video-1",
        coreId: "core-1",
        locale: "en",
        user: null,
        loadedArtifact: ARTIFACT,
      }),
    ).rejects.toMatchObject({ code: "forbidden" })
  })

  it("reports scenesPruned when the transaction deletes stale locale rows", async () => {
    const { prisma } = buildStubPrisma({ prunedCount: 3 })

    const result = await indexEditionScenes(prisma, {
      editionId: "edition-1",
      videoId: "video-1",
      coreId: "core-1",
      locale: "en",
      user: SYSTEM,
      loadedArtifact: ARTIFACT,
    })

    expect(result.scenesPruned).toBe(3)
  })

  it("propagates a batched-provider failure as a thrown error (fail-fast for the whole target)", async () => {
    // Stage 2 trade-off: the provider's per-scene fan-out is replaced
    // with one batched call. A length-mismatch / dimension-mismatch /
    // request-failed surface as `EmbeddingsBatchError` and must abort
    // the whole `(video, locale)` target rather than partial-write.
    // The workflow's per-target catch demotes this to a `failed`
    // outcome (covered in workflow tests).
    const { prisma, executeRaw, queryRaw } = buildStubPrisma()
    vi.mocked(generateExperienceEmbeddings).mockRejectedValueOnce(
      new Error("provider 503"),
    )

    await expect(
      indexEditionScenes(prisma, {
        editionId: "edition-1",
        videoId: "video-1",
        coreId: "core-1",
        locale: "en",
        user: SYSTEM,
        loadedArtifact: ARTIFACT,
      }),
    ).rejects.toThrow("provider 503")

    // No partial DB writes — the transaction never opened.
    expect(executeRaw).not.toHaveBeenCalled()
    expect(queryRaw).not.toHaveBeenCalled()
  })

  it("mixed insert + update fixture — half new scenes (no pre-existing), half pre-existing rows recovered via follow-up SELECT", async () => {
    // Mixed fixture: parent INSERT runs with ON CONFLICT DO NOTHING.
    // The follow-up SELECT must surface ids for BOTH the freshly-
    // inserted and the pre-existing parents — otherwise the locale
    // INSERT would be missing the pre-existing parents' ids.
    const artifact: SceneAnalysisResult = {
      scenes: [
        { ...ARTIFACT.scenes[0]!, sceneIndex: 0 }, // pre-existing
        {
          ...ARTIFACT.scenes[0]!,
          sceneIndex: 1,
          description: "fresh scene 1",
        }, // new
        { ...ARTIFACT.scenes[0]!, sceneIndex: 2 }, // pre-existing
      ],
    }
    const { prisma, executeRaw, queryRaw } = buildStubPrisma({
      // Simulate: only the freshly-inserted scene_index=1 was created
      // by the bulk INSERT (parents 0 and 2 already existed). The
      // follow-up SELECT returns ids for ALL three.
      parentRowsFor: (indexes) =>
        indexes.map((idx) => ({
          id: idx === 1 ? "parent-fresh-1" : `parent-existing-${idx}`,
          scene_index: idx,
        })),
      executeRawAffected: [1, 3], // 1 parent inserted, 3 locales upserted
    })

    const result = await indexEditionScenes(prisma, {
      editionId: "edition-1",
      videoId: "video-1",
      coreId: "core-1",
      locale: "en",
      user: SYSTEM,
      loadedArtifact: artifact,
    })

    expect(result.scenesIndexed).toBe(3)
    // The locale INSERT writes for ALL three scenes (pre-existing + new).
    expect(result.embeddingsWritten).toBe(3)
    // Parent SELECT was queried with all 3 incoming sceneIndexes.
    expect(queryRaw).toHaveBeenCalledTimes(1)
    // The locale INSERT (call index 1) bound an array of three video_scene_id
    // values; capture and assert all three parent ids appear.
    const localeCall = executeRaw.mock.calls[1] as unknown as [
      readonly string[],
      ...unknown[],
    ]
    const allBound = localeCall.slice(1).map((v) => String(v))
    const joined = allBound.join("|")
    expect(joined).toContain("parent-existing-0")
    expect(joined).toContain("parent-fresh-1")
    expect(joined).toContain("parent-existing-2")
  })

  it("skips the S3 read when loadedArtifact is supplied (Stage 2 per-(video, edition) cache)", async () => {
    const managerArtifactsModule =
      await import("@/services/manager-artifacts.service")
    const s3ReadSpy = vi.spyOn(
      managerArtifactsModule,
      "readSceneAnalysisArtifact",
    )

    const { prisma } = buildStubPrisma()
    await indexEditionScenes(prisma, {
      editionId: "edition-1",
      videoId: "video-1",
      coreId: "core-1",
      locale: "en",
      user: SYSTEM,
      loadedArtifact: ARTIFACT,
    })

    expect(s3ReadSpy).not.toHaveBeenCalled()
  })

  it("R1 multi-value text[] columns escape cleanly through Way A unfold (embedded quotes, backslashes, empty arrays, single-element)", async () => {
    // The themes/bibleVerses/etc. payload is bound via JSON.stringify
    // and unfolded inside the SQL via `jsonb_array_elements_text(... )`.
    // The bound JSON literal must survive embedded double quotes,
    // backslashes, empty arrays, and single-element arrays without
    // breaking either the JSON parser or the surrounding `text[]`
    // array-literal envelope. We assert on the BOUND PARAMETERS rather
    // than re-implementing the round-trip — a real DB integration test
    // covers the full SELECT-side parse.
    const artifact: SceneAnalysisResult = {
      scenes: [
        {
          ...ARTIFACT.scenes[0]!,
          sceneIndex: 0,
          themes: ['theme with "quote"'],
          bibleVerses: ["a\\b\\c"],
          demographics: [], // empty array
          spiritualContext: ["only"], // single element
        },
      ],
    }
    const { prisma, executeRaw } = buildStubPrisma()
    await indexEditionScenes(prisma, {
      editionId: "edition-1",
      videoId: "video-1",
      coreId: "core-1",
      locale: "en",
      user: SYSTEM,
      loadedArtifact: artifact,
    })

    const localeCall = executeRaw.mock.calls[1] as unknown as [
      readonly string[],
      ...unknown[],
    ]
    const allBound = localeCall
      .slice(1)
      .map((v) => (typeof v === "string" ? v : ""))
    // The themes JSON literal is one of the bound text[] parameters;
    // its element parses as JSON and contains the embedded quote.
    const found = allBound.find(
      (s) => s.includes("theme with") && s.includes("quote"),
    )
    expect(found, `themes JSON not present in bound params`).toBeDefined()
    // Empty-array case appears as JSON "[]".
    const foundEmpty = allBound.find((s) => s.includes('"[]"'))
    expect(
      foundEmpty,
      `empty-array JSON literal not present in bound params`,
    ).toBeDefined()
  })

  it("throws artifact_invalid when the parent SELECT misses a sceneIndex (and never runs the locale INSERT)", async () => {
    // Defensive guard test: the parent INSERT + follow-up SELECT must
    // surface ids for ALL incoming sceneIndexes. If a row goes missing
    // (concurrent delete, RLS view, planner bug), the indexer must fail
    // BEFORE attempting the locale INSERT — otherwise it would land
    // locale rows pointing at the wrong parent. The parent INSERT runs
    // (executeRaw call 0); the locale INSERT (call 1) must never fire.
    const { prisma, executeRaw } = buildStubPrisma({
      // Return parent rows for sceneIndex=0 only; sceneIndex=1 is missing.
      parentRowsFor: (indexes) =>
        indexes
          .filter((idx) => idx === 0)
          .map((idx) => ({ id: `parent-${idx}`, scene_index: idx })),
    })

    await expect(
      indexEditionScenes(prisma, {
        editionId: "edition-1",
        videoId: "video-1",
        coreId: "core-1",
        locale: "en",
        user: SYSTEM,
        loadedArtifact: ARTIFACT,
      }),
    ).rejects.toMatchObject({
      name: "SceneIndexError",
      code: "artifact_invalid",
      message: expect.stringMatching(/parent video_scene id not found/),
    })

    // Parent INSERT did fire; locale INSERT (call index 1) must NOT have.
    expect(executeRaw).toHaveBeenCalledTimes(1)
  })

  it("passes the 30s timeout option to $transaction", async () => {
    const { prisma } = buildStubPrisma()
    await indexEditionScenes(prisma, {
      editionId: "edition-1",
      videoId: "video-1",
      coreId: "core-1",
      locale: "en",
      user: SYSTEM,
      loadedArtifact: ARTIFACT,
    })
    const txMock = prisma.$transaction as unknown as ReturnType<typeof vi.fn>
    expect(txMock).toHaveBeenCalledTimes(1)
    const [, opts] = txMock.mock.calls[0]!
    expect(opts).toMatchObject({ timeout: 30_000 })
  })

  it("remaps Prisma runtime errors to SceneIndexError('storage_failed') without leaking the raw message (Fix 2 — feat-117 review)", async () => {
    const vectorLiteral = `[${new Array(2048).fill(0.42).join(",")}]`
    class FakePrismaError extends Error {
      readonly code = "P2010"
      constructor(message: string) {
        super(message)
        this.name = "PrismaClientKnownRequestError"
      }
    }
    const rawMessage = `Raw query failed. Code: \`P2010\`. Message: \`ERROR: malformed vector literal ${vectorLiteral}\``

    const { prisma } = buildStubPrisma()
    ;(
      prisma.$transaction as unknown as ReturnType<typeof vi.fn>
    ).mockImplementationOnce(async () => {
      throw new FakePrismaError(rawMessage)
    })

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    try {
      const thrown = await indexEditionScenes(prisma, {
        editionId: "edition-1",
        videoId: "video-1",
        coreId: "core-1",
        locale: "en",
        user: SYSTEM,
        loadedArtifact: ARTIFACT,
      }).catch((e) => e)

      expect((thrown as { name?: string }).name).toBe("SceneIndexError")
      expect((thrown as { code: string }).code).toBe("storage_failed")
      // The raw vector literal MUST NOT appear in the sanitized message.
      expect((thrown as Error).message).not.toContain("0.42")
      expect((thrown as Error).message).not.toContain(vectorLiteral)
      // The stable Prisma code SHOULD appear so operators can grep.
      expect((thrown as Error).message).toContain("P2010")
      expect(errorSpy).toHaveBeenCalledTimes(1)
      const [payload] = errorSpy.mock.calls[0]!
      const parsed = JSON.parse(String(payload))
      expect(parsed).toMatchObject({
        event: "scene_index_storage_error",
        code: "P2010",
      })
    } finally {
      errorSpy.mockRestore()
    }
  })
})
