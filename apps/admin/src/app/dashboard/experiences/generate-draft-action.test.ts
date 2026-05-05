import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Principal } from "@/auth/principal"
import * as experienceAiService from "@/services/experience-ai/experience-ai.service"
import { BlocksSchema } from "@/domain/blocks"
import { runGenerateDraftAction, USER_MESSAGES } from "./generate-draft-action"

const ADMIN: Principal = { id: "admin-1", role: "ADMIN" }

type WriteSpies = {
  experienceLocaleUpdate: ReturnType<typeof vi.fn>
  experienceLocaleUpsert: ReturnType<typeof vi.fn>
  experienceUpdate: ReturnType<typeof vi.fn>
  contentRevisionCreate: ReturnType<typeof vi.fn>
  contentRevisionUpdate: ReturnType<typeof vi.fn>
}

type DepsWithSpies = ReturnType<typeof mockDeps> & {
  prisma: {
    contentRevision: {
      findFirst: ReturnType<typeof vi.fn>
    }
  }
  writeSpies: WriteSpies
}

function mockDeps(overrides?: {
  blocks?: unknown
  user?: Principal | null
  draftSnapshot?: unknown | null
}): DepsWithSpies {
  const writeSpies: WriteSpies = {
    experienceLocaleUpdate: vi.fn(),
    experienceLocaleUpsert: vi.fn(),
    experienceUpdate: vi.fn(),
    contentRevisionCreate: vi.fn(),
    contentRevisionUpdate: vi.fn(),
  }

  return {
    prisma: {
      experienceLocale: {
        findUnique: vi.fn().mockResolvedValue({
          id: "locale-1",
          status: "DRAFT",
          blocks: overrides?.blocks ?? [],
          experienceId: "exp-1",
          experience: {
            ownerId: "admin-1",
            archivedAt: null,
          },
        }),
        update: writeSpies.experienceLocaleUpdate,
        upsert: writeSpies.experienceLocaleUpsert,
      },
      experience: {
        update: writeSpies.experienceUpdate,
      },
      contentRevision: {
        findFirst: vi
          .fn()
          .mockResolvedValue(
            overrides?.draftSnapshot
              ? { snapshot: overrides.draftSnapshot }
              : null,
          ),
        create: writeSpies.contentRevisionCreate,
        update: writeSpies.contentRevisionUpdate,
      },
      video: {
        findMany: vi.fn(),
      },
      videoLocale: {
        findMany: vi.fn(),
      },
      videoDub: {
        findMany: vi.fn(),
      },
      videoImage: {
        findMany: vi.fn(),
      },
    },
    user: overrides?.user ?? ADMIN,
    writeSpies,
  } as unknown as DepsWithSpies
}

describe("runGenerateDraftAction", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("rejects non-empty canonical canvases with CANVAS_NOT_EMPTY", async () => {
    const aiSpy = vi.spyOn(experienceAiService, "generateExperienceAiDraft")
    const deps = mockDeps({ blocks: [{ t: "text" }] })
    const result = await runGenerateDraftAction(deps, {
      localeId: "locale-1",
      locale: "en",
      prompt: "forgiveness",
    })

    expect(result).toEqual({
      ok: false,
      code: "CANVAS_NOT_EMPTY",
      error: USER_MESSAGES.CANVAS_NOT_EMPTY,
    })
    expect(aiSpy).not.toHaveBeenCalled()
  })

  it("rejects when a DRAFT revision has non-empty content even if canonical is empty", async () => {
    const aiSpy = vi.spyOn(experienceAiService, "generateExperienceAiDraft")
    const deps = mockDeps({
      blocks: [],
      draftSnapshot: {
        v: 1,
        data: { blocks: [{ t: "text", heading: "WIP" }] },
      },
    })
    const result = await runGenerateDraftAction(deps, {
      localeId: "locale-1",
      locale: "en",
      prompt: "forgiveness",
    })

    expect(result).toEqual({
      ok: false,
      code: "CANVAS_NOT_EMPTY",
      error: USER_MESSAGES.CANVAS_NOT_EMPTY,
    })
    expect(aiSpy).not.toHaveBeenCalled()
  })

  it("rejects users who cannot edit the locale", async () => {
    const result = await runGenerateDraftAction(
      mockDeps({ user: { id: "viewer-1", role: "VIEWER" } }),
      {
        localeId: "locale-1",
        locale: "en",
        prompt: "forgiveness",
      },
    )

    expect(result).toEqual({
      ok: false,
      code: "FORBIDDEN",
      error: USER_MESSAGES.FORBIDDEN,
    })
  })

  it("returns a draft on success", async () => {
    vi.spyOn(
      experienceAiService,
      "generateExperienceAiDraft",
    ).mockResolvedValueOnce({
      title: "Forgiven and Free",
      metaDescription: "A generated draft",
      blocks: [{ t: "text", heading: "Hello" }],
    })

    const result = await runGenerateDraftAction(mockDeps(), {
      localeId: "locale-1",
      locale: "en",
      prompt: "forgiveness",
      currentTitle: "Hint",
    })

    expect(result).toEqual({
      ok: true,
      draft: {
        title: "Forgiven and Free",
        metaDescription: "A generated draft",
        blocks: [{ t: "text", heading: "Hello" }],
      },
    })
    expect(JSON.parse(JSON.stringify(result))).toEqual(result)
  })

  it("maps typed service errors to editor-safe messages", async () => {
    vi.spyOn(
      experienceAiService,
      "generateExperienceAiDraft",
    ).mockRejectedValueOnce(
      new experienceAiService.ExperienceAiGenerationError(
        "NO_CANDIDATES",
        "no candidates",
      ),
    )

    const result = await runGenerateDraftAction(mockDeps(), {
      localeId: "locale-1",
      locale: "en",
      prompt: "forgiveness",
    })

    expect(result).toEqual({
      ok: false,
      code: "NO_CANDIDATES",
      error: USER_MESSAGES.NO_CANDIDATES,
    })
  })

  it("collapses unknown errors into a generic message", async () => {
    vi.spyOn(
      experienceAiService,
      "generateExperienceAiDraft",
    ).mockRejectedValueOnce(new Error("boom"))

    const result = await runGenerateDraftAction(mockDeps(), {
      localeId: "locale-1",
      locale: "en",
      prompt: "forgiveness",
    })

    expect(result).toEqual({
      ok: false,
      code: "UNKNOWN",
      error: USER_MESSAGES.UNKNOWN,
    })
  })

  it("integration: returns a BlocksSchema-valid draft, calls no Prisma writes, and respects catalog refs", async () => {
    const candidates = [
      {
        ref: "v01" as const,
        videoId: "video-1",
        slug: "hope-story",
        title: "Hope Story",
        description: "A hopeful story",
        previewImageUrl: "https://example.com/hope.jpg",
        previewStreamUrl: "https://example.com/hope.m3u8",
        label: null,
      },
      {
        ref: "v02" as const,
        videoId: "video-2",
        slug: "prayer-story",
        title: "Prayer Story",
        description: "A prayer story",
        previewImageUrl: null,
        previewStreamUrl: "https://example.com/prayer.m3u8",
        label: null,
      },
    ]

    // Hand-written normalized fixture mirroring Unit 1's structural
    // shape: videoHero + section wrapping a cross-block navigation
    // carousel and a media collection. videoIds and streamingUrls all
    // trace to the candidate set above by construction.
    const normalizedFixture = {
      title: "Hope for the Journey",
      metaDescription: "A first draft.",
      blocks: [
        {
          t: "videoHero" as const,
          sectionKey: "ai-s01",
          videoId: "video-1",
          streamingUrl: "https://example.com/hope.m3u8",
          ctaLabel: "Watch",
          headingSource: "videoTitle" as const,
        },
        {
          t: "section" as const,
          sectionKey: "ai-s02",
          content: [
            {
              t: "navigationCarousel" as const,
              items: [{ contentId: "ai-s01", title: "Watch the story" }],
            },
            {
              t: "videoCarousel" as const,
              items: [
                {
                  videoId: "video-2",
                  streamingUrl: "https://example.com/prayer.m3u8",
                  titleOverride: "Prayer",
                },
              ],
            },
          ],
        },
      ],
    }

    const draftSpy = vi
      .spyOn(experienceAiService, "generateExperienceAiDraft")
      .mockResolvedValue(normalizedFixture)

    const deps = mockDeps()
    const result = await runGenerateDraftAction(deps, {
      localeId: "locale-1",
      locale: "en",
      prompt: "hope",
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected ok result")

    // R3 / R9 — BlocksSchema-valid output.
    expect(BlocksSchema.safeParse(result.draft.blocks).success).toBe(true)

    // R6 — every videoId traces to a candidate; every persisted streamingUrl
    // matches a candidate previewStreamUrl.
    const candidateVideoIds = new Set(candidates.map((c) => c.videoId))
    const candidateStreamUrls = new Set(
      candidates
        .map((c) => c.previewStreamUrl)
        .filter((url): url is string => Boolean(url)),
    )
    const json = JSON.stringify(result.draft.blocks)
    for (const match of json.matchAll(/"videoId"\s*:\s*"([^"]+)"/g)) {
      expect(candidateVideoIds.has(match[1])).toBe(true)
    }
    for (const match of json.matchAll(/"streamingUrl"\s*:\s*"([^"]+)"/g)) {
      expect(candidateStreamUrls.has(match[1])).toBe(true)
    }

    // R5 — ephemeral. No Prisma write entry point should fire.
    expect(deps.writeSpies.experienceLocaleUpdate).not.toHaveBeenCalled()
    expect(deps.writeSpies.experienceLocaleUpsert).not.toHaveBeenCalled()
    expect(deps.writeSpies.experienceUpdate).not.toHaveBeenCalled()
    expect(deps.writeSpies.contentRevisionCreate).not.toHaveBeenCalled()
    expect(deps.writeSpies.contentRevisionUpdate).not.toHaveBeenCalled()

    draftSpy.mockRestore()
  })
})
