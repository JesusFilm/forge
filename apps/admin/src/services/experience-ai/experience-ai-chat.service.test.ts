import { beforeEach, describe, expect, it, vi } from "vitest"
import { EventEmitter } from "node:events"
import { PassThrough } from "node:stream"
import type { PrismaClient } from "@prisma/client"
import type { Principal } from "@/auth/principal"

const { envState } = vi.hoisted(() => ({
  envState: {
    EXPERIENCE_AI_ALLOW_CODEX_FALLBACK: true as boolean,
    OPENROUTER_API_KEY: undefined as string | undefined,
    OPENAI_API_KEY: undefined as string | undefined,
    OPENAI_BASE_URL: undefined as string | undefined,
  },
}))

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }))

const { generateDraftMock, loadCandidatesMock } = vi.hoisted(() => ({
  generateDraftMock: vi.fn(),
  loadCandidatesMock: vi.fn(),
}))

vi.mock("@/config/env", () => ({ env: envState }))
vi.mock("node:child_process", () => ({ spawn: spawnMock }))

vi.mock("./experience-ai.service", () => ({
  generateExperienceAiDraft: generateDraftMock,
  loadExperienceAiVideoCandidates: loadCandidatesMock,
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
    findMany: vi.fn().mockResolvedValue([]),
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
  generateDraftMock.mockResolvedValue({
    title: "Generated Title",
    metaDescription: "Generated description",
    blocks: [{ type: "text", text: "Generated block" }],
  })
})

// -----------------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------------

describe("streamChatTurn — happy path", () => {
  it("routes empty-canvas creation prompts through the draft generator and yields a staged proposal", async () => {
    const prisma = makeMockPrisma()

    const events = await collectEvents(
      streamChatTurn(
        { threadId: "thread-1", prompt: "Generate AI draft about hope" },
        { prisma, user: EDITOR },
      ),
    )

    expect(generateDraftMock).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        experienceLocaleId: "locale-1",
        locale: "en",
        prompt: "Generate AI draft about hope",
      }),
    )
    expect(spawnMock).not.toHaveBeenCalled()
    expect(prisma.experienceLocale.update).not.toHaveBeenCalled()
    expect(events).toEqual([
      expect.objectContaining({
        type: "mutation_proposal",
        messageId: "msg-assistant",
        draft: expect.objectContaining({
          title: "Generated Title",
          metaDescription: "Generated description",
          blocks: [{ type: "text", text: "Generated block" }],
        }),
      }),
      { type: "done", messageId: "msg-assistant" },
    ])
  })

  it("treats a plain empty-canvas editorial prompt as first-draft generation", async () => {
    const prisma = makeMockPrisma()

    await collectEvents(
      streamChatTurn(
        {
          threadId: "thread-1",
          prompt: "Meet Jesus with honest questions about doubt",
        },
        { prisma, user: EDITOR },
      ),
    )

    expect(generateDraftMock).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        prompt: "Meet Jesus with honest questions about doubt",
      }),
    )
    expect(spawnMock).not.toHaveBeenCalled()
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
