import { beforeEach, describe, expect, it, vi } from "vitest"
import type { PrismaClient } from "@prisma/client"
import type { Principal } from "@/auth/principal"
import { EventEmitter } from "node:events"

const { envState } = vi.hoisted(() => ({
  envState: {
    OPENROUTER_API_KEY: undefined as string | undefined,
    OPENAI_API_KEY: undefined as string | undefined,
    OPENAI_BASE_URL: undefined as string | undefined,
    EXPERIENCE_AI_ALLOW_CODEX_FALLBACK: false as boolean,
  },
}))

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
}))

const { generateExperienceEmbeddingMock } = vi.hoisted(() => ({
  generateExperienceEmbeddingMock: vi.fn(),
}))

const { generateOllamaEmbeddingMock } = vi.hoisted(() => ({
  generateOllamaEmbeddingMock: vi.fn(),
}))

vi.mock("@/config/env", () => ({
  env: envState,
}))

vi.mock("node:child_process", () => ({
  spawn: spawnMock,
}))

vi.mock("@/services/embeddings.service", () => ({
  generateExperienceEmbedding: generateExperienceEmbeddingMock,
}))

vi.mock("@/services/ollama-embedding.service", () => ({
  generateOllamaEmbedding: generateOllamaEmbeddingMock,
}))

import {
  buildExperienceAiMessages,
  generateExperienceAiDraft,
  loadExperienceAiVideoCandidates,
} from "./experience-ai.service"
import {
  buildDraftExperienceJsonSchema,
  DraftExperienceSchema,
} from "./experience-ai.schemas"

const EDITOR: Principal = { id: "editor-1", role: "EDITOR" }

type MockPrisma = PrismaClient & {
  experienceLocale: {
    findUnique: ReturnType<typeof vi.fn>
  }
  video: {
    findMany: ReturnType<typeof vi.fn>
  }
  videoLocale: {
    findMany: ReturnType<typeof vi.fn>
  }
  videoDub: {
    findMany: ReturnType<typeof vi.fn>
  }
  videoImage: {
    findMany: ReturnType<typeof vi.fn>
  }
  $transaction: ReturnType<typeof vi.fn>
}

function makePrisma(): MockPrisma {
  const experienceLocale = {
    findUnique: vi.fn(),
  }
  const video = {
    findMany: vi.fn(),
  }
  const videoLocale = {
    findMany: vi.fn(),
  }
  const videoDub = {
    findMany: vi.fn(),
  }
  const videoImage = {
    findMany: vi.fn(),
  }
  const tx = {
    $executeRawUnsafe: vi.fn(),
    $queryRaw: vi.fn().mockResolvedValue([]),
  }
  const $transaction = vi.fn((callback) => callback(tx))

  return {
    experienceLocale,
    video,
    videoLocale,
    videoDub,
    videoImage,
    $transaction,
  } as unknown as MockPrisma
}

function seedCatalog(prisma: MockPrisma) {
  prisma.video.findMany.mockResolvedValue([
    {
      id: "video-1",
      slug: "hope-story",
      label: "episode",
      updatedAt: new Date("2026-04-22T10:00:00Z"),
    },
    {
      id: "video-2",
      slug: "prayer-story",
      label: "segment",
      updatedAt: new Date("2026-04-21T10:00:00Z"),
    },
    {
      id: "video-3",
      slug: "fallback-story",
      label: null,
      updatedAt: new Date("2026-04-20T10:00:00Z"),
    },
  ])
  prisma.videoLocale.findMany.mockResolvedValue([
    {
      videoId: "video-1",
      locale: "en",
      title: "Hope Story",
      description: "A hopeful story",
      status: "PUBLISHED",
      updatedAt: new Date("2026-04-22T10:00:00Z"),
    },
    {
      videoId: "video-2",
      locale: "en",
      title: "Prayer Story",
      description: "A prayer story",
      status: "PUBLISHED",
      updatedAt: new Date("2026-04-21T10:00:00Z"),
    },
    {
      videoId: "video-3",
      locale: "en",
      title: "Fallback Story",
      description: null,
      status: "PUBLISHED",
      updatedAt: new Date("2026-04-20T10:00:00Z"),
    },
  ])
  prisma.videoDub.findMany.mockResolvedValue([
    {
      videoId: "video-1",
      hls: "https://example.com/hope.m3u8",
      dash: null,
      share: null,
      language: { bcp47: "en", iso3: "eng", slug: "english" },
      updatedAt: new Date("2026-04-22T10:00:00Z"),
    },
  ])
  prisma.videoImage.findMany.mockResolvedValue([
    {
      videoId: "video-1",
      url: "https://example.com/hope.jpg",
      createdAt: new Date("2026-04-22T10:00:00Z"),
    },
    {
      videoId: "video-2",
      url: null,
      createdAt: new Date("2026-04-21T10:00:00Z"),
    },
  ])
}

function seedEmptyLocale(prisma: MockPrisma) {
  prisma.experienceLocale.findUnique.mockResolvedValue({
    id: "locale-1",
    blocks: [],
    experience: {
      ownerId: EDITOR.id,
      archivedAt: null,
    },
  })
}

describe("loadExperienceAiVideoCandidates", () => {
  beforeEach(() => {
    generateExperienceEmbeddingMock.mockReset()
    generateExperienceEmbeddingMock.mockRejectedValue(
      new Error("not configured"),
    )
    generateOllamaEmbeddingMock.mockReset()
    generateOllamaEmbeddingMock.mockRejectedValue(new Error("not running"))
  })

  it("returns bounded candidates with stable aliases in ranked order", async () => {
    const prisma = makePrisma()
    seedCatalog(prisma)

    const candidates = await loadExperienceAiVideoCandidates(prisma, {
      locale: "en",
      prompt: "hope and prayer",
      limit: 2,
    })

    expect(candidates).toHaveLength(2)
    expect(candidates[0]).toMatchObject({
      ref: "v01",
      videoId: "video-1",
      title: "Hope Story",
      previewImageUrl: "https://example.com/hope.jpg",
      previewStreamUrl: "https://example.com/hope.m3u8",
    })
    expect(candidates[1]).toMatchObject({
      ref: "v02",
      videoId: "video-2",
    })
  })

  it("does not fall back to another language for candidate copy", async () => {
    const prisma = makePrisma()
    seedCatalog(prisma)
    prisma.videoLocale.findMany.mockResolvedValue([
      {
        videoId: "video-1",
        locale: "es",
        title: "Historia de esperanza",
        description: "Una historia esperanzadora",
        status: "PUBLISHED",
        updatedAt: new Date("2026-04-22T10:00:00Z"),
      },
      {
        videoId: "video-2",
        locale: "en",
        title: "Prayer Story",
        description: "A prayer story",
        status: "PUBLISHED",
        updatedAt: new Date("2026-04-21T10:00:00Z"),
      },
    ])

    const candidates = await loadExperienceAiVideoCandidates(prisma, {
      locale: "en",
      prompt: "hope and prayer",
      limit: 3,
    })

    expect(candidates.map((candidate) => candidate.videoId)).toEqual([
      "video-2",
    ])
    expect(candidates[0]).toMatchObject({
      title: "Prayer Story",
      description: "A prayer story",
    })
  })

  it("uses a matching-language dub for preview streams", async () => {
    const prisma = makePrisma()
    seedCatalog(prisma)
    prisma.videoDub.findMany.mockResolvedValue([
      {
        videoId: "video-1",
        hls: "https://example.com/spanish.m3u8",
        dash: null,
        share: null,
        language: { bcp47: "es", iso3: "spa", slug: "spanish" },
        updatedAt: new Date("2026-04-23T10:00:00Z"),
      },
      {
        videoId: "video-1",
        hls: "https://example.com/english.m3u8",
        dash: null,
        share: null,
        language: { bcp47: "en", iso3: "eng", slug: "english" },
        updatedAt: new Date("2026-04-22T10:00:00Z"),
      },
    ])

    const candidates = await loadExperienceAiVideoCandidates(prisma, {
      locale: "en",
      prompt: "hope",
      limit: 1,
    })

    expect(candidates[0]?.previewStreamUrl).toBe(
      "https://example.com/english.m3u8",
    )
  })

  it("uses scene/transcript vector hits before token ranking", async () => {
    const prisma = makePrisma()
    seedCatalog(prisma)
    generateExperienceEmbeddingMock.mockResolvedValue({
      model: "text-embedding-3-small",
      dimensions: 1536,
      embedding: Array.from({ length: 1536 }, () => 0.01),
    })
    prisma.$transaction.mockImplementationOnce(async (callback) =>
      callback({
        $executeRawUnsafe: vi.fn(),
        $queryRaw: vi.fn().mockResolvedValue([
          { videoId: "video-2", distance: 0.1 },
          { videoId: "video-1", distance: 0.2 },
        ]),
      }),
    )

    const candidates = await loadExperienceAiVideoCandidates(prisma, {
      locale: "en",
      prompt: "hope and prayer",
      limit: 2,
    })

    expect(generateExperienceEmbeddingMock).toHaveBeenCalledWith(
      "hope and prayer",
    )
    expect(prisma.video.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: { in: ["video-2", "video-1"] },
          deletedAt: null,
        },
      }),
    )
    expect(candidates.map((candidate) => candidate.videoId)).toEqual([
      "video-2",
      "video-1",
    ])
  })

  it("uses the local Ollama vector index when primary embeddings are unavailable", async () => {
    const prisma = makePrisma()
    seedCatalog(prisma)
    generateOllamaEmbeddingMock.mockResolvedValue(
      Array.from({ length: 768 }, () => 0.01),
    )
    prisma.$transaction.mockImplementationOnce(async (callback) =>
      callback({
        $executeRawUnsafe: vi.fn(),
        $queryRaw: vi.fn().mockResolvedValue([
          { videoId: "video-2", distance: 0.1 },
          { videoId: "video-1", distance: 0.2 },
        ]),
      }),
    )

    const candidates = await loadExperienceAiVideoCandidates(prisma, {
      locale: "en",
      prompt: "Jesus",
      limit: 2,
    })

    expect(generateOllamaEmbeddingMock).toHaveBeenCalledWith("Jesus")
    expect(candidates.map((candidate) => candidate.videoId)).toEqual([
      "video-2",
      "video-1",
    ])
  })
})

describe("generateExperienceAiDraft", () => {
  beforeEach(() => {
    envState.OPENROUTER_API_KEY = undefined
    envState.OPENAI_API_KEY = undefined
    envState.OPENAI_BASE_URL = undefined
    envState.EXPERIENCE_AI_ALLOW_CODEX_FALLBACK = false
    generateExperienceEmbeddingMock.mockReset()
    generateExperienceEmbeddingMock.mockRejectedValue(
      new Error("not configured"),
    )
    generateOllamaEmbeddingMock.mockReset()
    generateOllamaEmbeddingMock.mockRejectedValue(new Error("not running"))
    vi.unstubAllGlobals()
    spawnMock.mockReset()
  })

  it("throws NOT_CONFIGURED when no provider env is present and the codex gate is off", async () => {
    const prisma = makePrisma()
    seedCatalog(prisma)
    seedEmptyLocale(prisma)
    // Codex gate is off by default — pickProvider returns null without
    // ever spawning the CLI.

    await expect(
      generateExperienceAiDraft(prisma, {
        experienceLocaleId: "locale-1",
        locale: "en",
        prompt: "A story of hope",
        user: EDITOR,
      }),
    ).rejects.toMatchObject({
      code: "NOT_CONFIGURED",
    })
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it("throws NOT_CONFIGURED with codex gate on when the codex CLI is unavailable", async () => {
    const prisma = makePrisma()
    seedCatalog(prisma)
    seedEmptyLocale(prisma)
    envState.EXPERIENCE_AI_ALLOW_CODEX_FALLBACK = true
    const proc = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter
      stderr: EventEmitter
      stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> }
    }
    proc.stdout = new EventEmitter()
    proc.stderr = new EventEmitter()
    proc.stdin = { write: vi.fn(), end: vi.fn() }
    spawnMock.mockImplementation(() => {
      queueMicrotask(() => {
        const error = Object.assign(new Error("spawn codex ENOENT"), {
          code: "ENOENT",
        })
        proc.emit("error", error)
      })
      return proc
    })

    await expect(
      generateExperienceAiDraft(prisma, {
        experienceLocaleId: "locale-1",
        locale: "en",
        prompt: "A story of hope",
        user: EDITOR,
      }),
    ).rejects.toMatchObject({
      code: "NOT_CONFIGURED",
    })
  })

  it("falls back to codex when the gate is on and no API key is present", async () => {
    envState.EXPERIENCE_AI_ALLOW_CODEX_FALLBACK = true
    const prisma = makePrisma()
    seedCatalog(prisma)
    seedEmptyLocale(prisma)
    const proc = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter
      stderr: EventEmitter
      stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> }
    }
    proc.stdout = new EventEmitter()
    proc.stderr = new EventEmitter()
    proc.stdin = { write: vi.fn(), end: vi.fn() }
    spawnMock.mockImplementation(() => {
      queueMicrotask(() => {
        proc.stdout.emit(
          "data",
          Buffer.from(
            JSON.stringify({
              title: "Hope for the Journey",
              metaDescription: "A short first draft.",
              blocks: [
                {
                  t: "videoHero",
                  sectionRef: "s01",
                  candidateRef: "v01",
                  ctaLabel: "Watch",
                },
                {
                  t: "section",
                  sectionRef: "s02",
                  content: [{ t: "text", heading: "Start here" }],
                },
              ],
            }),
          ),
        )
        proc.emit("close", 0, null)
      })
      return proc
    })

    const draft = await generateExperienceAiDraft(prisma, {
      experienceLocaleId: "locale-1",
      locale: "en",
      prompt: "A story of hope",
      user: EDITOR,
    })

    expect(spawnMock).toHaveBeenCalledWith(
      "codex",
      ["exec", "-m", "gpt-5.4", "--sandbox", "read-only", "-"],
      expect.objectContaining({
        stdio: ["pipe", "pipe", "pipe"],
      }),
    )
    expect(draft.title).toBe("Hope for the Journey")
    expect(draft.blocks[0]).toMatchObject({
      t: "videoHero",
      videoId: "video-1",
    })
  })

  it("throws UPSTREAM_ERROR on provider failures", async () => {
    const prisma = makePrisma()
    seedCatalog(prisma)
    seedEmptyLocale(prisma)
    envState.OPENROUTER_API_KEY = "test-openrouter-key"
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("upstream error", { status: 503 }))
    vi.stubGlobal("fetch", fetchMock)

    await expect(
      generateExperienceAiDraft(prisma, {
        experienceLocaleId: "locale-1",
        locale: "en",
        prompt: "A story of hope",
        user: EDITOR,
      }),
    ).rejects.toMatchObject({
      code: "UPSTREAM_ERROR",
    })
  })

  it("throws SCHEMA_MISMATCH when the provider output is structurally invalid", async () => {
    const prisma = makePrisma()
    seedCatalog(prisma)
    seedEmptyLocale(prisma)
    envState.OPENROUTER_API_KEY = "test-openrouter-key"
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    title: "Draft",
                  }),
                },
              },
            ],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      ),
    )

    await expect(
      generateExperienceAiDraft(prisma, {
        experienceLocaleId: "locale-1",
        locale: "en",
        prompt: "A story of hope",
        user: EDITOR,
      }),
    ).rejects.toMatchObject({
      code: "SCHEMA_MISMATCH",
    })
  })

  it("throws NORMALIZATION_ERROR when the model references an unknown candidate", async () => {
    const prisma = makePrisma()
    seedCatalog(prisma)
    seedEmptyLocale(prisma)
    envState.OPENROUTER_API_KEY = "test-openrouter-key"
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    title: "Draft",
                    metaDescription: "Draft",
                    blocks: [
                      {
                        t: "videoHero",
                        candidateRef: "v99",
                      },
                      {
                        t: "section",
                        sectionRef: "s02",
                        content: [{ t: "text", heading: "Start" }],
                      },
                    ],
                  }),
                },
              },
            ],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      ),
    )

    await expect(
      generateExperienceAiDraft(prisma, {
        experienceLocaleId: "locale-1",
        locale: "en",
        prompt: "A story of hope",
        user: EDITOR,
      }),
    ).rejects.toMatchObject({
      code: "NORMALIZATION_ERROR",
    })
  })

  it("returns a normalized draft when the provider response is valid", async () => {
    const prisma = makePrisma()
    seedCatalog(prisma)
    seedEmptyLocale(prisma)
    envState.OPENROUTER_API_KEY = "test-openrouter-key"
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  title: "Hope for the Journey",
                  metaDescription: "A short first draft.",
                  blocks: [
                    {
                      t: "videoHero",
                      sectionRef: "s01",
                      candidateRef: "v01",
                      ctaLabel: "Watch",
                    },
                    {
                      t: "section",
                      sectionRef: "s02",
                      content: [
                        {
                          t: "text",
                          sectionRef: "s03",
                          heading: "Start here",
                        },
                        {
                          t: "navigationCarousel",
                          items: [{ targetRef: "s03", title: "Start here" }],
                        },
                      ],
                    },
                  ],
                }),
              },
            },
          ],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    )
    vi.stubGlobal("fetch", fetchMock)

    const draft = await generateExperienceAiDraft(prisma, {
      experienceLocaleId: "locale-1",
      locale: "en",
      prompt: "A story of hope",
      user: EDITOR,
    })

    expect(fetchMock).toHaveBeenCalled()
    expect(draft.title).toBe("Hope for the Journey")
    expect(draft.blocks[0]).toMatchObject({
      t: "videoHero",
      sectionKey: "ai-s01",
      videoId: "video-1",
    })
    expect(draft.blocks[1]).toMatchObject({
      t: "section",
      sectionKey: "ai-s02",
    })
    const section = draft.blocks[1] as Extract<
      (typeof draft.blocks)[number],
      { t: "section" }
    >
    expect(section.content[0]).toMatchObject({
      t: "text",
      sectionKey: "ai-s03",
    })
    expect(section.content[1]).toMatchObject({
      t: "navigationCarousel",
      items: [{ contentId: "ai-s03" }],
    })
  })

  it("repairs duplicate section refs from the provider", async () => {
    const prisma = makePrisma()
    seedCatalog(prisma)
    seedEmptyLocale(prisma)
    envState.OPENROUTER_API_KEY = "test-openrouter-key"
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    title: "Forgiveness After Failure",
                    metaDescription: "A short first draft.",
                    blocks: [
                      {
                        t: "text",
                        sectionRef: "s04",
                        heading: "Start again",
                      },
                      {
                        t: "videoHero",
                        sectionRef: "s04",
                        candidateRef: "v01",
                        ctaLabel: "Watch",
                      },
                      {
                        t: "navigationCarousel",
                        items: [{ targetRef: "s04", title: "Start again" }],
                      },
                    ],
                  }),
                },
              },
            ],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      ),
    )

    const draft = await generateExperienceAiDraft(prisma, {
      experienceLocaleId: "locale-1",
      locale: "en",
      prompt: "forgiveness after failure",
      user: EDITOR,
    })

    expect(draft.blocks[0]).toMatchObject({
      t: "text",
      sectionKey: "ai-s04",
    })
    expect(draft.blocks[1]).toMatchObject({
      t: "videoHero",
      sectionKey: "ai-s04-1",
    })
    expect(draft.blocks[2]).toMatchObject({
      t: "navigationCarousel",
      items: [{ contentId: "ai-s04" }],
    })
  })
})

describe("rule-witness log", () => {
  beforeEach(() => {
    envState.OPENROUTER_API_KEY = undefined
    envState.OPENAI_API_KEY = undefined
    envState.OPENAI_BASE_URL = undefined
    envState.EXPERIENCE_AI_ALLOW_CODEX_FALLBACK = false
    generateExperienceEmbeddingMock.mockReset()
    generateExperienceEmbeddingMock.mockRejectedValue(
      new Error("not configured"),
    )
    generateOllamaEmbeddingMock.mockReset()
    generateOllamaEmbeddingMock.mockRejectedValue(new Error("not running"))
    vi.unstubAllGlobals()
    spawnMock.mockReset()
  })

  it("emits exactly one draft_generated line on success and never includes prompt or candidate metadata", async () => {
    const prisma = makePrisma()
    seedCatalog(prisma)
    seedEmptyLocale(prisma)
    envState.OPENROUTER_API_KEY = "test-openrouter-key"
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    title: "Hope for the Journey",
                    metaDescription: "A short first draft.",
                    blocks: [
                      {
                        t: "videoHero",
                        sectionRef: "s01",
                        candidateRef: "v01",
                        ctaLabel: "Watch",
                      },
                      {
                        t: "section",
                        sectionRef: "s02",
                        content: [{ t: "text", heading: "Start here" }],
                      },
                    ],
                  }),
                },
              },
            ],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      ),
    )

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {})

    await generateExperienceAiDraft(prisma, {
      experienceLocaleId: "locale-1",
      locale: "en",
      prompt: "Sensitive operator prompt about hope",
      user: EDITOR,
      experienceId: "exp-1",
    })

    const witnessLines = logSpy.mock.calls
      .map((args) => args[0])
      .filter(
        (entry): entry is string =>
          typeof entry === "string" && entry.includes('"draft_generated"'),
      )
    expect(witnessLines).toHaveLength(1)
    const payload = JSON.parse(witnessLines[0]) as Record<string, unknown>
    expect(payload).toMatchObject({
      service: "experience-ai",
      event: "draft_generated",
      experienceId: "exp-1",
      experienceLocaleId: "locale-1",
      locale: "en",
      providerKind: "openrouter",
      rulesSatisfied: {
        catalogOnly: true,
        localeMatchedDubs: true,
        blocksSchemaParsed: true,
        ephemeralAction: true,
      },
    })
    expect(typeof payload.candidateCount).toBe("number")
    expect(typeof payload.blockCount).toBe("number")
    expect(typeof payload.durationMs).toBe("number")

    // No operator prompt or candidate metadata may leak into the log.
    const serialized = JSON.stringify(payload)
    expect(serialized).not.toContain("Sensitive operator prompt")
    expect(serialized).not.toMatch(/"prompt"\s*:/)
    expect(serialized).not.toMatch(/"query"\s*:/)
    expect(serialized).not.toMatch(/"title"\s*:/)
    expect(serialized).not.toMatch(/"description"\s*:/)
    expect(serialized).not.toMatch(/"url"\s*:/)
    expect(serialized).not.toContain("Hope Story")
    expect(serialized).not.toContain("hope.m3u8")

    logSpy.mockRestore()
  })
})

describe("buildExperienceAiMessages", () => {
  const candidates = [
    {
      ref: "v01" as const,
      videoId: "video-1",
      slug: "hope-story",
      title: "Hope Story",
      description: null,
      previewImageUrl: null,
      previewStreamUrl: null,
      label: null,
    },
  ]

  it("includes the editorial brief, structural template, and shape-only few-shot for English", () => {
    const messages = buildExperienceAiMessages({
      prompt: "A story of hope",
      locale: "en",
      candidates,
    })
    const system = messages.find((message) => message.role === "system")
    expect(system).toBeDefined()
    const content = system?.content ?? ""
    // Editorial brief markers
    expect(content).toMatch(/editorial/i)
    // Structural template markers
    expect(content).toMatch(/videoHero/)
    expect(content).toMatch(/section/)
    expect(content).toMatch(/navigationCarousel|mediaCollection/)
    // Shape-only few-shot label
    expect(content.toLowerCase()).toContain("shape only")
    // Locale guidance
    expect(content).toMatch(/English/i)
    // Invariants restated
    expect(content).toMatch(/candidateRef/)
  })

  it("emits Spanish-specific copy guidance when locale is es", () => {
    const messages = buildExperienceAiMessages({
      prompt: "Una historia de esperanza",
      locale: "es",
      candidates,
    })
    const system = messages.find((message) => message.role === "system")
    const content = system?.content ?? ""
    expect(content).toMatch(/es\b|Spanish|español/i)
    // Must NOT default-tag the prompt as English when locale is es
    expect(content).not.toMatch(/Write all generated copy in English/)
  })
})

describe("DraftExperienceSchema block floor", () => {
  it("rejects a draft with a single block (min floor is 2)", () => {
    const result = DraftExperienceSchema.safeParse({
      title: "T",
      metaDescription: "M",
      blocks: [
        {
          t: "videoHero",
          candidateRef: "v01",
        },
      ],
    })
    expect(result.success).toBe(false)
  })

  it("accepts a draft with two blocks", () => {
    const result = DraftExperienceSchema.safeParse({
      title: "T",
      metaDescription: "M",
      blocks: [
        { t: "videoHero", candidateRef: "v01" },
        {
          t: "section",
          content: [{ t: "text", heading: "Hi" }],
        },
      ],
    })
    expect(result.success).toBe(true)
  })
})

describe("buildDraftExperienceJsonSchema", () => {
  it("aligns blocks.minItems with the Zod floor of 2", () => {
    const schema = buildDraftExperienceJsonSchema() as Record<string, unknown>
    const properties = schema.properties as Record<string, unknown> | undefined
    const blocks = properties?.blocks as { minItems?: number } | undefined
    expect(blocks?.minItems).toBe(2)
  })
})
