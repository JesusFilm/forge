import { beforeEach, describe, expect, it, vi } from "vitest"
import type { PrismaClient } from "@prisma/client"
import type { Principal } from "@/auth/principal"

// -----------------------------------------------------------------------------
// Mocks (hoisted)
// -----------------------------------------------------------------------------

const { mastraGenerateMock } = vi.hoisted(() => ({
  mastraGenerateMock: vi.fn(),
}))

const { loadCandidatesMock } = vi.hoisted(() => ({
  loadCandidatesMock: vi.fn(),
}))

vi.mock("./experience-ai.service", () => ({
  loadExperienceAiVideoCandidates: loadCandidatesMock,
}))

vi.mock("@/mastra", () => ({
  getMastra: () => ({
    getAgentById: () => ({
      generate: mastraGenerateMock,
    }),
  }),
}))

import {
  streamChatTurn,
  type ChatStreamEvent,
} from "./experience-ai-chat.service"

const EDITOR: Principal = { id: "editor-1", role: "EDITOR" }
const OTHER_USER: Principal = { id: "stranger-1", role: "EDITOR" }

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

type FakePrismaOpts = {
  thread?: "missing" | "found"
  threadOwnerId?: string
  blocks?: unknown[]
  applyAfter?: {
    title?: string
    metaDescription?: string | null
    ogImageUrl?: string | null
    blocks?: unknown[]
  }
}

function makeFakePrisma(opts: FakePrismaOpts = {}) {
  const thread = {
    findUnique: vi.fn(async () => {
      if (opts.thread === "missing") return null
      return {
        id: "thread-1",
        experienceLocaleId: "locale-1",
        experienceLocale: {
          id: "locale-1",
          experienceId: "exp-1",
          locale: "en",
          title: "Old Title",
          metaDescription: "Old description",
          ogImageUrl: null,
          blocks: opts.blocks ?? [],
          status: "DRAFT",
          experience: {
            ownerId: opts.threadOwnerId ?? EDITOR.id,
            archivedAt: null,
          },
        },
      }
    }),
    update: vi.fn().mockResolvedValue({}),
  }

  const message = {
    create: vi.fn(async ({ data }: { data: { role: string } }) => ({
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
      title: "Old Title",
      metaDescription: "Old description",
      ogImageUrl: null,
      blocks: opts.blocks ?? [],
      status: "DRAFT",
      experience: {
        ownerId: opts.threadOwnerId ?? EDITOR.id,
        archivedAt: null,
      },
    }),
    update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
      id: "locale-1",
      experienceId: "exp-1",
      locale: "en",
      slug: "old-slug",
      title:
        opts.applyAfter?.title ??
        (typeof data.title === "string" ? data.title : "Old Title"),
      metaDescription:
        opts.applyAfter?.metaDescription !== undefined
          ? opts.applyAfter.metaDescription
          : (data.metaDescription ?? "Old description"),
      ogImageUrl: opts.applyAfter?.ogImageUrl ?? null,
      blocks: opts.applyAfter?.blocks ?? data.blocks ?? opts.blocks ?? [],
      status: "DRAFT",
      publishedAt: null,
    })),
  }

  const contentRevision = { create: vi.fn() }
  const $transaction = vi.fn(async (fn: unknown) =>
    typeof fn === "function"
      ? (fn as (txc: unknown) => Promise<unknown>)({
          experienceLocale: locale,
          contentRevision,
        })
      : fn,
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

async function collect(
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

/** Build the standard `mastra.getAgentById("...").generate(...)` happy-path response. */
function mastraEnvelope(
  mutations: Record<string, unknown>,
  extras: Record<string, unknown> = {},
) {
  return { text: JSON.stringify({ mutations, ...extras }) }
}

beforeEach(() => {
  mastraGenerateMock.mockReset()
  loadCandidatesMock.mockReset()
  loadCandidatesMock.mockResolvedValue([])
})

// -----------------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------------

describe("streamChatTurn — happy path", () => {
  it("yields token_delta events and a mutation_applied + done envelope from a Mastra response", async () => {
    mastraGenerateMock.mockResolvedValue(
      mastraEnvelope({ title: "Updated Title" }, { reason: "rename header" }),
    )
    const prisma = makeFakePrisma({
      applyAfter: { title: "Updated Title" },
    })

    const events = await collect(
      streamChatTurn(
        { threadId: "thread-1", prompt: "rename the title" },
        { prisma, user: EDITOR },
      ),
    )

    expect(events.some((e) => e.type === "token_delta")).toBe(true)
    const applied = events.find((e) => e.type === "mutation_applied")
    expect(applied).toBeDefined()
    const done = events.at(-1)
    expect(done?.type).toBe("done")
    expect(mastraGenerateMock).toHaveBeenCalledTimes(1)
  })

  it("persists the assistant message with providerKind='mastra'", async () => {
    mastraGenerateMock.mockResolvedValue(
      mastraEnvelope({ title: "Updated" }, { reason: "rename" }),
    )
    const prisma = makeFakePrisma({ applyAfter: { title: "Updated" } })

    await collect(
      streamChatTurn(
        { threadId: "thread-1", prompt: "hi" },
        { prisma, user: EDITOR },
      ),
    )

    const assistantCall = prisma.experienceChatMessage.create.mock.calls.find(
      (c: unknown[]) => {
        const args = c[0] as { data: { role: string } }
        return args.data.role === "ASSISTANT"
      },
    )
    expect(assistantCall).toBeDefined()
    const args = assistantCall![0] as unknown as {
      data: { providerKind: string }
    }
    expect(args.data.providerKind).toBe("mastra")
  })
})

describe("streamChatTurn — error paths", () => {
  it("yields thread_not_found when the thread doesn't exist", async () => {
    const prisma = makeFakePrisma({ thread: "missing" })
    const events = await collect(
      streamChatTurn(
        { threadId: "missing", prompt: "hi" },
        { prisma, user: EDITOR },
      ),
    )
    const err = events.find((e) => e.type === "error")
    expect(err).toMatchObject({ type: "error", code: "thread_not_found" })
    expect(mastraGenerateMock).not.toHaveBeenCalled()
  })

  it("yields forbidden when ABAC rejects the principal", async () => {
    const prisma = makeFakePrisma({ threadOwnerId: "someone-else" })
    const events = await collect(
      streamChatTurn(
        { threadId: "thread-1", prompt: "hi" },
        { prisma, user: OTHER_USER },
      ),
    )
    const err = events.find((e) => e.type === "error")
    expect(err).toMatchObject({ type: "error", code: "forbidden" })
    expect(mastraGenerateMock).not.toHaveBeenCalled()
  })

  it("yields slug_change_rejected when Mastra proposes a slug mutation", async () => {
    mastraGenerateMock.mockResolvedValue(
      mastraEnvelope({ slug: "new-slug" }, { reason: "rename" }),
    )
    const prisma = makeFakePrisma()
    const events = await collect(
      streamChatTurn(
        { threadId: "thread-1", prompt: "change slug" },
        { prisma, user: EDITOR },
      ),
    )
    const err = events.find((e) => e.type === "error")
    expect(err).toMatchObject({ type: "error", code: "slug_change_rejected" })
  })

  it("yields schema_violation when Mastra returns text without a JSON object", async () => {
    mastraGenerateMock.mockResolvedValue({
      text: "I'm sorry, I can't help with that.",
    })
    const prisma = makeFakePrisma()
    const events = await collect(
      streamChatTurn(
        { threadId: "thread-1", prompt: "hi" },
        { prisma, user: EDITOR },
      ),
    )
    const err = events.find((e) => e.type === "error")
    expect(err?.type).toBe("error")
    expect(err && "code" in err ? err.code : null).toBe(
      "provider_validation_failed",
    )
  })

  it("yields cross_locale_unconfirmed when mutation affects another locale and operator hasn't confirmed", async () => {
    mastraGenerateMock.mockResolvedValue(
      mastraEnvelope(
        { title: "Hola" },
        { reason: "translate", localesAffected: ["en", "es"] },
      ),
    )
    const prisma = makeFakePrisma()
    const events = await collect(
      streamChatTurn(
        { threadId: "thread-1", prompt: "translate to es" },
        { prisma, user: EDITOR },
      ),
    )
    const err = events.find((e) => e.type === "error")
    expect(err).toMatchObject({
      type: "error",
      code: "cross_locale_unconfirmed",
    })
  })

  it("proceeds when cross-locale write is confirmed", async () => {
    mastraGenerateMock.mockResolvedValue(
      mastraEnvelope(
        { title: "Hola" },
        { reason: "translate", localesAffected: ["en", "es"] },
      ),
    )
    const prisma = makeFakePrisma({ applyAfter: { title: "Hola" } })
    const events = await collect(
      streamChatTurn(
        {
          threadId: "thread-1",
          prompt: "translate to es",
          confirmedAcrossLocales: true,
        },
        { prisma, user: EDITOR },
      ),
    )
    expect(events.some((e) => e.type === "mutation_applied")).toBe(true)
    expect(events.at(-1)?.type).toBe("done")
  })

  it("yields error when the Mastra agent throws", async () => {
    mastraGenerateMock.mockRejectedValue(new Error("openrouter offline"))
    const prisma = makeFakePrisma()
    const events = await collect(
      streamChatTurn(
        { threadId: "thread-1", prompt: "hi" },
        { prisma, user: EDITOR },
      ),
    )
    const err = events.find((e) => e.type === "error")
    expect(err?.type).toBe("error")
  })

  it("classifies ProviderNotConfiguredError as provider_not_configured", async () => {
    const err = new Error("OPENROUTER_API_KEY is required")
    err.name = "ProviderNotConfiguredError"
    mastraGenerateMock.mockRejectedValue(err)
    const prisma = makeFakePrisma()
    const events = await collect(
      streamChatTurn(
        { threadId: "thread-1", prompt: "hi" },
        { prisma, user: EDITOR },
      ),
    )
    const errEv = events.find((e) => e.type === "error")
    expect(errEv).toMatchObject({
      type: "error",
      code: "provider_not_configured",
    })
  })
})

describe("streamChatTurn — Mastra integration", () => {
  it("calls Mastra's experience-default-chat agent (not a per-provider adapter)", async () => {
    mastraGenerateMock.mockResolvedValue(
      mastraEnvelope({ title: "X" }, { reason: "x" }),
    )
    const prisma = makeFakePrisma({ applyAfter: { title: "X" } })

    await collect(
      streamChatTurn(
        { threadId: "thread-1", prompt: "hi" },
        { prisma, user: EDITOR },
      ),
    )

    expect(mastraGenerateMock).toHaveBeenCalledTimes(1)
    const [prompt, opts] = mastraGenerateMock.mock.calls[0]
    expect(typeof prompt).toBe("string")
    expect(opts).toMatchObject({})
  })

  it("forwards the abortSignal into Mastra's generate call", async () => {
    mastraGenerateMock.mockResolvedValue(
      mastraEnvelope({ title: "Y" }, { reason: "y" }),
    )
    const prisma = makeFakePrisma({ applyAfter: { title: "Y" } })
    const controller = new AbortController()

    await collect(
      streamChatTurn(
        { threadId: "thread-1", prompt: "hi" },
        { prisma, user: EDITOR, abortSignal: controller.signal },
      ),
    )

    const [, opts] = mastraGenerateMock.mock.calls[0]
    expect(opts.abortSignal).toBe(controller.signal)
  })
})
