import { beforeEach, describe, expect, it, vi } from "vitest"
import { EventEmitter } from "node:events"
import { PassThrough } from "node:stream"
import type { PrismaClient } from "@prisma/client"
import type { Principal } from "@/auth/principal"

const { envState } = vi.hoisted(() => ({
  envState: {
    EXPERIENCE_AI_ALLOW_CODEX_FALLBACK: true as boolean,
    OPENROUTER_API_KEY: undefined as string | undefined,
    OPENROUTER_EXPERIENCE_CHAT_MODEL: undefined as string | undefined,
    OPENROUTER_EXPERIENCE_CHAT_MODELS: undefined as string | undefined,
    OPENAI_API_KEY: undefined as string | undefined,
    OPENAI_BASE_URL: undefined as string | undefined,
  },
}))

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }))

const { runOllamaChatMock, runClaudeCodeChatMock } = vi.hoisted(() => ({
  runOllamaChatMock: vi.fn(),
  runClaudeCodeChatMock: vi.fn(),
}))

const { loadCandidatesMock } = vi.hoisted(() => ({
  loadCandidatesMock: vi.fn(),
}))

const { generateQualityDraftMock, QualityExperienceDraftErrorMock } =
  vi.hoisted(() => ({
    generateQualityDraftMock: vi.fn(),
    QualityExperienceDraftErrorMock: class QualityExperienceDraftError extends Error {
      constructor(
        readonly code: string,
        message: string,
        readonly attempts: unknown[] = [],
      ) {
        super(message)
        this.name = "QualityExperienceDraftError"
      }
    },
  }))

vi.mock("@/config/env", () => ({ env: envState }))
vi.mock("node:child_process", () => ({ spawn: spawnMock }))

vi.mock("./experience-ai.service", () => ({
  loadExperienceAiVideoCandidates: loadCandidatesMock,
}))

vi.mock("./experience-ai-quality-draft", () => ({
  generateQualityExperienceDraft: generateQualityDraftMock,
  QualityExperienceDraftError: QualityExperienceDraftErrorMock,
}))

vi.mock("./experience-ai-ollama", () => ({
  runOllamaChat: runOllamaChatMock,
}))

vi.mock("./experience-ai-claude-code", () => ({
  runClaudeCodeChat: runClaudeCodeChatMock,
}))

import {
  streamChatTurn,
  type ChatStreamEvent,
} from "./experience-ai-chat.service"

const EDITOR: Principal = { id: "editor-1", role: "EDITOR" }

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

type ProcStub = EventEmitter & {
  stdout: PassThrough
  stderr: PassThrough
  stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> }
  kill: ReturnType<typeof vi.fn>
}

function makeProc(): ProcStub {
  const proc = new EventEmitter() as ProcStub
  proc.stdout = new PassThrough()
  proc.stderr = new PassThrough()
  proc.stdin = { write: vi.fn(), end: vi.fn() }
  proc.kill = vi.fn()
  return proc
}

function emitLines(proc: ProcStub, lines: string[]) {
  for (const line of lines) {
    proc.stdout.write(Buffer.from(line + "\n"))
  }
}

function endProc(
  proc: ProcStub,
  code = 0,
  signal: NodeJS.Signals | null = null,
) {
  proc.stdout.end()
  proc.stderr.end()
  // Allow readline to flush "line" events before close fires.
  setImmediate(() => proc.emit("close", code, signal))
}

function makeMockPrisma(opts?: {
  thread?: unknown
  blocks?: unknown
  applyResult?: unknown
  messages?: unknown[]
}) {
  const thread = {
    findUnique: vi.fn().mockResolvedValue(
      opts?.thread ?? {
        id: "thread-1",
        experienceLocaleId: "locale-1",
        experienceLocale: {
          id: "locale-1",
          experienceId: "exp-1",
          locale: "en",
          title: "Old Title",
          metaDescription: "Old description",
          ogImageUrl: null,
          blocks: opts?.blocks ?? [],
          status: "DRAFT",
          experience: { ownerId: EDITOR.id, archivedAt: null },
        },
      },
    ),
    update: vi.fn().mockResolvedValue({}),
  }
  const message = {
    create: vi.fn(async ({ data }) => ({
      id: data.role === "ASSISTANT" ? "msg-assistant" : "msg-user",
      ...data,
    })),
    findMany: vi.fn().mockResolvedValue(opts?.messages ?? []),
  }
  const locale = {
    findUniqueOrThrow: vi.fn().mockResolvedValue({
      id: "locale-1",
      experienceId: "exp-1",
      locale: "en",
      slug: "old-slug",
      isHomepage: false,
      pathSegment: null,
      title: "Old Title",
      metaDescription: "Old description",
      ogTitle: null,
      ogDescription: null,
      ogImageUrl: null,
      blocks: opts?.blocks ?? [],
      status: "DRAFT",
      publishedAt: null,
      createdAt: new Date("2026-05-01T00:00:00Z"),
      updatedAt: new Date("2026-05-01T00:00:00Z"),
      experience: { ownerId: EDITOR.id, archivedAt: null, isTemplate: false },
    }),
    update: vi.fn(
      async ({ data }) =>
        opts?.applyResult ?? {
          id: "locale-1",
          experienceId: "exp-1",
          locale: "en",
          slug: "old-slug",
          title: data.title ?? "Old Title",
          metaDescription:
            data.metaDescription !== undefined
              ? data.metaDescription
              : "Old description",
          ogImageUrl: data.ogImageUrl ?? null,
          blocks: data.blocks ?? opts?.blocks ?? [],
          status: "DRAFT",
          publishedAt: null,
        },
    ),
  }
  const contentRevision = { create: vi.fn() }
  const txClients = {
    experienceLocale: locale,
    contentRevision,
  }
  const $transaction = vi.fn(async (fn) =>
    typeof fn === "function" ? fn(txClients) : fn,
  )

  return {
    experienceChatThread: thread,
    experienceChatMessage: message,
    experienceLocale: locale,
    contentRevision,
    $transaction,
  } as unknown as PrismaClient & {
    experienceChatThread: typeof thread
    experienceChatMessage: typeof message
    experienceLocale: typeof locale
    contentRevision: typeof contentRevision
  }
}

async function collectEvents(
  iter: AsyncIterable<ChatStreamEvent>,
  cap = 50,
): Promise<ChatStreamEvent[]> {
  const out: ChatStreamEvent[] = []
  for await (const ev of iter) {
    out.push(ev)
    if (out.length >= cap) break
  }
  return out
}

// -----------------------------------------------------------------------------
// Test setup
// -----------------------------------------------------------------------------

beforeEach(() => {
  envState.EXPERIENCE_AI_ALLOW_CODEX_FALLBACK = true
  spawnMock.mockReset()
  runOllamaChatMock.mockReset()
  runClaudeCodeChatMock.mockReset()
  loadCandidatesMock.mockReset()
  loadCandidatesMock.mockResolvedValue([
    {
      ref: "v01",
      videoId: "video-1",
      slug: "hope-story",
      title: "Hope Story",
      description: null,
      previewImageUrl: null,
      previewStreamUrl: null,
      label: null,
    },
  ])
  generateQualityDraftMock.mockReset()
  generateQualityDraftMock.mockResolvedValue({
    title: "Generated Title",
    metaDescription: "Generated description",
    blocks: [{ t: "text", contentParagraphs: ["Generated block"] }],
    review: {
      scriptureNotes: ["Matthew 11:28-30 anchors the page."],
      researchNotes: [],
      theologyReview: { status: "passed", notes: [] },
      referenceLedger: [
        {
          sourceKind: "scripture",
          claim: "Jesus invites weary people to come to him.",
          reference: "Matthew 11:28-30",
        },
      ],
    },
    imageDirection: "Warm portrait-oriented hero imagery.",
    provider: {
      kind: "openrouter-free",
      model: "model-a",
      usedModel: "model-a",
      attempts: [{ model: "model-a", status: "succeeded" }],
    },
  })
})

// -----------------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------------

describe("streamChatTurn — happy path", () => {
  it.skip("routes empty-canvas creation prompts through the guided brief workflow [brief-flow disabled]", async () => {
    const prisma = makeMockPrisma()

    const events = await collectEvents(
      streamChatTurn(
        { threadId: "thread-1", prompt: "Generate AI draft about hope" },
        { prisma, user: EDITOR },
      ),
    )

    expect(loadCandidatesMock).not.toHaveBeenCalled()
    expect(generateQualityDraftMock).not.toHaveBeenCalled()
    expect(spawnMock).not.toHaveBeenCalled()
    expect(prisma.experienceLocale.update).not.toHaveBeenCalled()
    expect(events).toEqual([
      expect.objectContaining({
        type: "brief_update",
        messageId: "msg-assistant",
        brief: expect.objectContaining({
          topicOrPassage: "hope",
        }),
        missingFields: expect.arrayContaining(["language"]),
        confirmationRequired: false,
      }),
      { type: "done", messageId: "msg-assistant" },
    ])
  })

  it("uses normal chat routing for plain empty-canvas prompts without creation intent", async () => {
    const prisma = makeMockPrisma()
    const proc = makeProc()
    spawnMock.mockReturnValue(proc)

    queueMicrotask(() => {
      emitLines(proc, [
        JSON.stringify({
          mutations: { title: "Honest Questions" },
          reason: "set starter title",
        }),
      ])
    })

    await collectEvents(
      streamChatTurn(
        {
          threadId: "thread-1",
          prompt: "Meet Jesus with honest questions about doubt",
        },
        { prisma, user: EDITOR },
      ),
    )

    expect(generateQualityDraftMock).not.toHaveBeenCalled()
    expect(spawnMock).toHaveBeenCalled()
  })

  it.skip("generates an OpenRouter-backed quality draft after a complete brief is confirmed [brief-flow disabled]", async () => {
    const brief = {
      topicOrPassage: "Matthew 11:28-30",
      language: "English",
      audience: "young adults",
      desiredOutcome: "Help readers trust Jesus with weariness.",
      tone: "Warm and invitational",
      pageType: "Experience page",
      scriptureEmphasis: "Center the page on Matthew 11:28-30.",
      ctaOrNextStep: "Invite readers to pray.",
    }
    const prisma = makeMockPrisma({
      messages: [
        {
          role: "ASSISTANT",
          content: "Confirm this brief.",
          mutationsApplied: {
            kind: "editorial_brief",
            status: "confirmation_required",
            brief,
            missingFields: [],
          },
        },
      ],
    })

    const events = await collectEvents(
      streamChatTurn(
        {
          threadId: "thread-1",
          prompt: "Generate from this brief",
          confirmedBrief: true,
        },
        { prisma, user: EDITOR },
      ),
    )

    expect(loadCandidatesMock).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        locale: "en",
        prompt: expect.stringContaining("Matthew 11:28-30"),
      }),
    )
    expect(generateQualityDraftMock).toHaveBeenCalledWith(
      expect.objectContaining({
        brief,
        locale: "en",
        candidates: expect.any(Array),
      }),
    )
    expect(spawnMock).not.toHaveBeenCalled()
    expect(events).toEqual([
      expect.objectContaining({
        type: "mutation_proposal",
        messageId: "msg-assistant",
        draft: expect.objectContaining({
          title: "Generated Title",
          metaDescription: "Generated description",
        }),
        review: expect.objectContaining({
          scriptureNotes: ["Matthew 11:28-30 anchors the page."],
        }),
      }),
      { type: "done", messageId: "msg-assistant" },
    ])
  })

  it("returns to normal chat routing after a quality draft closes the brief", async () => {
    const brief = {
      topicOrPassage: "Matthew 11:28-30",
      language: "English",
      audience: "young adults",
      desiredOutcome: "Help readers trust Jesus with weariness.",
      tone: "Warm and invitational",
      pageType: "Experience page",
      scriptureEmphasis: "Center the page on Matthew 11:28-30.",
      ctaOrNextStep: "Invite readers to pray.",
    }
    const prisma = makeMockPrisma({
      blocks: [{ t: "text", contentParagraphs: ["Existing draft"] }],
      messages: [
        {
          role: "ASSISTANT",
          content: "Confirm this brief.",
          mutationsApplied: {
            kind: "editorial_brief",
            status: "confirmation_required",
            brief,
            missingFields: [],
          },
        },
        {
          role: "ASSISTANT",
          content: "Generated a quality-first draft for review.",
          mutationsApplied: {
            kind: "quality_draft",
            brief,
          },
        },
      ],
    })
    const proc = makeProc()
    spawnMock.mockReturnValue(proc)

    queueMicrotask(() => {
      emitLines(proc, [
        JSON.stringify({
          mutations: { title: "Sharper Title" },
          reason: "refined title",
        }),
      ])
    })

    const events = await collectEvents(
      streamChatTurn(
        {
          threadId: "thread-1",
          prompt: "Make the title sharper",
        },
        { prisma, user: EDITOR },
      ),
    )

    expect(generateQualityDraftMock).not.toHaveBeenCalled()
    expect(spawnMock).toHaveBeenCalled()
    expect(
      events.find((event) => event.type === "mutation_applied"),
    ).toBeDefined()
  })

  it("yields token_delta, mutation_applied, done and persists assistant message", async () => {
    const prisma = makeMockPrisma({ blocks: [{ t: "text" }] })
    const proc = makeProc()
    spawnMock.mockReturnValue(proc)

    queueMicrotask(() => {
      emitLines(proc, [
        "Hello",
        "world",
        JSON.stringify({
          mutations: { title: "New Title" },
          reason: "set title",
        }),
      ])
    })

    const events = await collectEvents(
      streamChatTurn(
        { threadId: "thread-1", prompt: "Make the title pop" },
        { prisma, user: EDITOR },
      ),
    )

    const types = events.map((e) => e.type)
    expect(types).toContain("token_delta")
    expect(types).toContain("mutation_applied")
    expect(types).toContain("done")

    const tokens = events
      .filter((e) => e.type === "token_delta")
      .map((e) => (e as { text: string }).text)
    expect(tokens).toEqual(expect.arrayContaining(["Hello", "world"]))

    // USER message persisted before codex spawn, plus ASSISTANT after.
    const calls = prisma.experienceChatMessage.create.mock.calls.map(
      (c) => c[0].data.role,
    )
    expect(calls).toEqual(["USER", "ASSISTANT"])

    expect(prisma.experienceChatThread.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "thread-1" } }),
    )
  })

  it("applies mutation through the service layer with revisedByKind=AI", async () => {
    const prisma = makeMockPrisma({ blocks: [{ t: "text" }] })
    const proc = makeProc()
    spawnMock.mockReturnValue(proc)

    queueMicrotask(() => {
      emitLines(proc, [
        JSON.stringify({
          mutations: { title: "Better Title" },
          reason: "tightened hook",
        }),
      ])
    })

    await collectEvents(
      streamChatTurn(
        { threadId: "thread-1", prompt: "rename" },
        { prisma, user: EDITOR },
      ),
    )

    expect(prisma.contentRevision.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          revisedByKind: "AI",
          reason: "tightened hook",
        }),
      }),
    )
    expect(prisma.experienceLocale.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "locale-1" },
        data: expect.objectContaining({ title: "Better Title" }),
      }),
    )
  })
})

describe("streamChatTurn — failure modes", () => {
  it("emits empty_response when stdout closes with no lines", async () => {
    const prisma = makeMockPrisma({ blocks: [{ t: "text" }] })
    const proc = makeProc()
    spawnMock.mockReturnValue(proc)

    queueMicrotask(() => {
      endProc(proc, 0)
    })

    const events = await collectEvents(
      streamChatTurn(
        { threadId: "thread-1", prompt: "hi" },
        { prisma, user: EDITOR },
      ),
    )
    expect(events.find((e) => e.type === "error")).toMatchObject({
      type: "error",
      code: "empty_response",
    })
  })

  it("emits invalid_json when stdout has garbage and exits zero", async () => {
    const prisma = makeMockPrisma({ blocks: [{ t: "text" }] })
    const proc = makeProc()
    spawnMock.mockReturnValue(proc)

    queueMicrotask(() => {
      emitLines(proc, ["not-json"])
      endProc(proc, 0)
    })

    const events = await collectEvents(
      streamChatTurn(
        { threadId: "thread-1", prompt: "hi" },
        { prisma, user: EDITOR },
      ),
    )
    expect(events.find((e) => e.type === "error")).toMatchObject({
      code: "invalid_json",
    })
  })

  it("emits slug_change_rejected when envelope contains slug", async () => {
    const prisma = makeMockPrisma({ blocks: [{ t: "text" }] })
    const proc = makeProc()
    spawnMock.mockReturnValue(proc)

    queueMicrotask(() => {
      emitLines(proc, [
        JSON.stringify({ mutations: { slug: "new-slug" }, reason: "x" }),
      ])
    })

    const events = await collectEvents(
      streamChatTurn(
        { threadId: "thread-1", prompt: "hi" },
        { prisma, user: EDITOR },
      ),
    )
    expect(events.find((e) => e.type === "error")).toMatchObject({
      code: "slug_change_rejected",
    })
    expect(prisma.experienceLocale.update).not.toHaveBeenCalled()
  })

  it("emits schema_violation on unknown top-level keys", async () => {
    const prisma = makeMockPrisma({ blocks: [{ t: "text" }] })
    const proc = makeProc()
    spawnMock.mockReturnValue(proc)

    queueMicrotask(() => {
      emitLines(proc, [
        JSON.stringify({
          mutations: { title: "x" },
          weirdField: 1,
        }),
      ])
    })

    const events = await collectEvents(
      streamChatTurn(
        { threadId: "thread-1", prompt: "hi" },
        { prisma, user: EDITOR },
      ),
    )
    expect(events.find((e) => e.type === "error")).toMatchObject({
      code: "schema_violation",
    })
  })

  it("emits cross_locale_unconfirmed when localesAffected widens unconfirmed", async () => {
    const prisma = makeMockPrisma({ blocks: [{ t: "text" }] })
    const proc = makeProc()
    spawnMock.mockReturnValue(proc)

    queueMicrotask(() => {
      emitLines(proc, [
        JSON.stringify({
          mutations: { title: "x" },
          localesAffected: ["en", "es"],
        }),
      ])
    })

    const events = await collectEvents(
      streamChatTurn(
        { threadId: "thread-1", prompt: "hi" },
        { prisma, user: EDITOR },
      ),
    )
    expect(events.find((e) => e.type === "error")).toMatchObject({
      code: "cross_locale_unconfirmed",
    })
    expect(prisma.experienceLocale.update).not.toHaveBeenCalled()
  })

  it("applies the mutation when cross-locale write is confirmed", async () => {
    const prisma = makeMockPrisma({ blocks: [{ t: "text" }] })
    const proc = makeProc()
    spawnMock.mockReturnValue(proc)

    queueMicrotask(() => {
      emitLines(proc, [
        JSON.stringify({
          mutations: { title: "x" },
          localesAffected: ["en", "es"],
        }),
      ])
    })

    const events = await collectEvents(
      streamChatTurn(
        {
          threadId: "thread-1",
          prompt: "hi",
          confirmedAcrossLocales: true,
        },
        { prisma, user: EDITOR },
      ),
    )
    expect(events.find((e) => e.type === "mutation_applied")).toBeDefined()
    expect(prisma.experienceLocale.update).toHaveBeenCalled()
  })

  it("emits codex_unavailable on ENOENT", async () => {
    const prisma = makeMockPrisma({ blocks: [{ t: "text" }] })
    const proc = makeProc()
    spawnMock.mockReturnValue(proc)

    setImmediate(() => {
      const err = Object.assign(new Error("spawn codex ENOENT"), {
        code: "ENOENT",
      })
      proc.emit("error", err)
    })

    const events = await collectEvents(
      streamChatTurn(
        { threadId: "thread-1", prompt: "hi" },
        { prisma, user: EDITOR },
      ),
    )
    expect(events.find((e) => e.type === "error")).toMatchObject({
      code: "codex_unavailable",
    })
  })

  it("emits codex_unavailable on non-zero exit before envelope", async () => {
    const prisma = makeMockPrisma({ blocks: [{ t: "text" }] })
    const proc = makeProc()
    spawnMock.mockReturnValue(proc)

    queueMicrotask(() => {
      proc.stderr.emit("data", Buffer.from("auth error"))
      emitLines(proc, ["partial output"])
      endProc(proc, 1)
    })

    const events = await collectEvents(
      streamChatTurn(
        { threadId: "thread-1", prompt: "hi" },
        { prisma, user: EDITOR },
      ),
    )
    expect(events.find((e) => e.type === "error")).toMatchObject({
      code: "codex_unavailable",
    })
  })

  it("emits cancelled when abortSignal fires", async () => {
    const prisma = makeMockPrisma({ blocks: [{ t: "text" }] })
    const proc = makeProc()
    spawnMock.mockReturnValue(proc)

    const controller = new AbortController()

    // Spawn but never resolve — abort drives the outcome.
    queueMicrotask(() => {
      emitLines(proc, ["thinking..."])
      controller.abort()
    })

    const events = await collectEvents(
      streamChatTurn(
        { threadId: "thread-1", prompt: "hi" },
        { prisma, user: EDITOR, abortSignal: controller.signal },
      ),
    )
    expect(events.find((e) => e.type === "error")).toMatchObject({
      code: "cancelled",
    })
    expect(proc.kill).toHaveBeenCalledWith("SIGTERM")
  })

  it.skip("emits provider errors from confirmed quality-draft generation [brief-flow disabled]", async () => {
    const brief = {
      topicOrPassage: "Matthew 11:28-30",
      language: "English",
      audience: "young adults",
      desiredOutcome: "Help readers trust Jesus with weariness.",
      tone: "Warm and invitational",
      pageType: "Experience page",
      scriptureEmphasis: "Center the page on Matthew 11:28-30.",
      ctaOrNextStep: "Invite readers to pray.",
    }
    const prisma = makeMockPrisma({
      messages: [
        {
          role: "ASSISTANT",
          content: "Confirm this brief.",
          mutationsApplied: {
            kind: "editorial_brief",
            status: "confirmation_required",
            brief,
            missingFields: [],
          },
        },
      ],
    })
    generateQualityDraftMock.mockRejectedValueOnce(
      new QualityExperienceDraftErrorMock(
        "provider_rate_limited",
        "All free models are rate limited",
      ),
    )

    const events = await collectEvents(
      streamChatTurn(
        {
          threadId: "thread-1",
          prompt: "Generate from this brief",
          confirmedBrief: true,
        },
        { prisma, user: EDITOR },
      ),
    )

    expect(events.find((e) => e.type === "error")).toMatchObject({
      code: "provider_rate_limited",
    })
    expect(spawnMock).not.toHaveBeenCalled()
  })
})

describe("streamChatTurn — auth + lookup", () => {
  it("emits forbidden when ABAC denies the locale", async () => {
    // Different owner + non-ADMIN principal → canEditExperienceLocale → false
    const prisma = makeMockPrisma()
    prisma.experienceChatThread.findUnique.mockResolvedValueOnce({
      id: "thread-1",
      experienceLocaleId: "locale-1",
      experienceLocale: {
        id: "locale-1",
        experienceId: "exp-1",
        locale: "en",
        title: "T",
        metaDescription: null,
        ogImageUrl: null,
        blocks: [],
        status: "DRAFT",
        experience: { ownerId: "different-user", archivedAt: null },
      },
    })

    const events = await collectEvents(
      streamChatTurn(
        { threadId: "thread-1", prompt: "hi" },
        { prisma, user: EDITOR },
      ),
    )

    expect(events.find((e) => e.type === "error")).toMatchObject({
      code: "forbidden",
    })
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it("emits thread_not_found when the thread is missing", async () => {
    const prisma = makeMockPrisma()
    prisma.experienceChatThread.findUnique.mockResolvedValueOnce(null)

    const events = await collectEvents(
      streamChatTurn(
        { threadId: "missing", prompt: "hi" },
        { prisma, user: EDITOR },
      ),
    )

    expect(events.find((e) => e.type === "error")).toMatchObject({
      code: "thread_not_found",
    })
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it("emits codex_unavailable when the codex gate is off", async () => {
    envState.EXPERIENCE_AI_ALLOW_CODEX_FALLBACK = false
    const prisma = makeMockPrisma({ blocks: [{ t: "text" }] })

    const events = await collectEvents(
      streamChatTurn(
        { threadId: "thread-1", prompt: "hi" },
        { prisma, user: EDITOR },
      ),
    )
    expect(events.find((e) => e.type === "error")).toMatchObject({
      code: "codex_unavailable",
    })
    expect(spawnMock).not.toHaveBeenCalled()
  })
})

// -----------------------------------------------------------------------------
// U7: provider routing for chat-turn (post-brief envelope path)
// -----------------------------------------------------------------------------

describe("streamChatTurn — provider routing", () => {
  it("provider='ollama' routes chat-turn through runOllamaChat, not Codex spawn", async () => {
    const prisma = makeMockPrisma({ blocks: [{ t: "text" }] })
    runOllamaChatMock.mockResolvedValue({
      kind: "envelope",
      raw: { mutations: { title: "From Ollama" } },
    })

    const events = await collectEvents(
      streamChatTurn(
        { threadId: "thread-1", prompt: "hi", provider: "ollama" },
        { prisma, user: EDITOR },
      ),
    )

    expect(runOllamaChatMock).toHaveBeenCalledTimes(1)
    expect(spawnMock).not.toHaveBeenCalled()
    expect(runClaudeCodeChatMock).not.toHaveBeenCalled()

    const applied = events.find((e) => e.type === "mutation_applied")
    expect(applied).toBeDefined()

    expect(prisma.experienceChatMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          role: "ASSISTANT",
          providerKind: "ollama-gemma4",
        }),
      }),
    )
  })

  it("provider='claude-code' routes chat-turn through runClaudeCodeChat", async () => {
    const prisma = makeMockPrisma({ blocks: [{ t: "text" }] })
    runClaudeCodeChatMock.mockResolvedValue({
      kind: "envelope",
      raw: { mutations: { metaDescription: "From Claude" } },
    })

    await collectEvents(
      streamChatTurn(
        { threadId: "thread-1", prompt: "hi", provider: "claude-code" },
        { prisma, user: EDITOR },
      ),
    )

    expect(runClaudeCodeChatMock).toHaveBeenCalledTimes(1)
    expect(spawnMock).not.toHaveBeenCalled()
    expect(runOllamaChatMock).not.toHaveBeenCalled()

    // The schemaJson is the chat envelope JSON Schema — assert the
    // adapter was called with it so future drift in either side breaks.
    const callArgs = runClaudeCodeChatMock.mock.calls[0]![0]
    expect(callArgs).toMatchObject({
      prompt: expect.any(String),
      schemaJson: expect.objectContaining({ type: "object" }),
      onToken: expect.any(Function),
    })

    expect(prisma.experienceChatMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          role: "ASSISTANT",
          providerKind: "claude-code",
        }),
      }),
    )
  })

  it("provider='codex' routes chat-turn through Codex spawn (explicit pick)", async () => {
    const prisma = makeMockPrisma({ blocks: [{ t: "text" }] })
    const proc = makeProc()
    spawnMock.mockReturnValue(proc)

    queueMicrotask(() => {
      emitLines(proc, ['{"mutations":{"title":"Explicit Codex"}}'])
      endProc(proc, 0)
    })

    const events = await collectEvents(
      streamChatTurn(
        { threadId: "thread-1", prompt: "hi", provider: "codex" },
        { prisma, user: EDITOR },
      ),
    )

    expect(spawnMock).toHaveBeenCalledTimes(1)
    expect(runOllamaChatMock).not.toHaveBeenCalled()
    expect(runClaudeCodeChatMock).not.toHaveBeenCalled()

    expect(events.find((e) => e.type === "mutation_applied")).toBeDefined()
    expect(prisma.experienceChatMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          role: "ASSISTANT",
          providerKind: "codex",
        }),
      }),
    )
  })

  it("provider omitted falls back to Codex chat-turn (R8 invariant)", async () => {
    const prisma = makeMockPrisma({ blocks: [{ t: "text" }] })
    const proc = makeProc()
    spawnMock.mockReturnValue(proc)

    queueMicrotask(() => {
      emitLines(proc, ['{"mutations":{"title":"Default"}}'])
      endProc(proc, 0)
    })

    await collectEvents(
      streamChatTurn(
        { threadId: "thread-1", prompt: "hi" },
        { prisma, user: EDITOR },
      ),
    )

    expect(spawnMock).toHaveBeenCalledTimes(1)
    expect(runOllamaChatMock).not.toHaveBeenCalled()
    expect(runClaudeCodeChatMock).not.toHaveBeenCalled()
  })

  it("surfaces adapter errors verbatim without falling back to a sibling channel", async () => {
    const prisma = makeMockPrisma({ blocks: [{ t: "text" }] })
    runOllamaChatMock.mockResolvedValue({
      kind: "error",
      code: "provider_unavailable",
      message: "ollama down",
    })

    const events = await collectEvents(
      streamChatTurn(
        { threadId: "thread-1", prompt: "hi", provider: "ollama" },
        { prisma, user: EDITOR },
      ),
    )

    expect(events.find((e) => e.type === "error")).toMatchObject({
      code: "provider_unavailable",
    })
    expect(spawnMock).not.toHaveBeenCalled()
    expect(runClaudeCodeChatMock).not.toHaveBeenCalled()
  })
})
