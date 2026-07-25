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
import { ProviderNotConfiguredError } from "@/mastra/providers"

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

  const preImage = {
    id: "locale-1",
    experienceId: "exp-1",
    locale: "en",
    slug: "old-slug",
    title: "Old Title",
    metaDescription: "Old description",
    ogImageUrl: null,
    blocks: opts.blocks ?? [],
    status: "DRAFT",
    updatedAt: new Date("2026-04-15T12:00:00.000Z"),
    experience: {
      ownerId: opts.threadOwnerId ?? EDITOR.id,
      archivedAt: null,
    },
  }
  const afterRow = {
    id: "locale-1",
    experienceId: "exp-1",
    locale: "en",
    slug: "old-slug",
    title: opts.applyAfter?.title ?? "Old Title",
    metaDescription:
      opts.applyAfter?.metaDescription !== undefined
        ? opts.applyAfter.metaDescription
        : "Old description",
    ogImageUrl: opts.applyAfter?.ogImageUrl ?? null,
    blocks: opts.applyAfter?.blocks ?? opts.blocks ?? [],
    status: "DRAFT",
    publishedAt: null,
    updatedAt: new Date("2026-04-15T12:00:00.000Z"),
  }
  const locale = {
    // applyChatMutation reads the pre-image once (outside tx), then writes
    // via a plain `update` inside the locked tx (the FOR UPDATE + text
    // guard replaced the old updateMany-on-updatedAt path).
    findUniqueOrThrow: vi
      .fn()
      .mockResolvedValueOnce(preImage)
      .mockResolvedValue(afterRow),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    update: vi.fn().mockResolvedValue(afterRow),
  }

  const contentRevision = { create: vi.fn() }
  // applyChatMutation's optimistic-concurrency token: a full-precision
  // `updated_at::text` read (baseline outside tx, then the FOR UPDATE
  // locked read inside tx). Both resolve to the same value by default so
  // the guard passes.
  const $queryRaw = vi.fn().mockResolvedValue([{ u: "2026-04-15 12:00:00+00" }])
  const $transaction = vi.fn(async (fn: unknown) =>
    typeof fn === "function"
      ? (fn as (txc: unknown) => Promise<unknown>)({
          experienceLocale: locale,
          contentRevision,
          $queryRaw,
        })
      : fn,
  )

  return {
    experienceChatThread: thread,
    experienceChatMessage: message,
    experienceLocale: locale,
    contentRevision,
    $queryRaw,
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

  it("U2: stamps producedBy='experience-default-chat' on the assistant message (non-ratable producer)", async () => {
    mastraGenerateMock.mockResolvedValue(
      mastraEnvelope({ title: "Stamped" }, { reason: "rename" }),
    )
    const prisma = makeFakePrisma({ applyAfter: { title: "Stamped" } })

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
      data: { producedBy: string }
    }
    expect(args.data.producedBy).toBe("experience-default-chat")
  })

  it("recovers via jsonrepair when the model returns JSON with a trailing comma", async () => {
    // Small local models (gemma4:e4b) occasionally emit not-quite-valid
    // JSON — here a trailing comma after the last property. The service's
    // jsonrepair fallback must fix it, parse the envelope, and apply the
    // mutation rather than surfacing an error event.
    mastraGenerateMock.mockResolvedValue({
      text: '{"mutations":{"title":"Fixed",}}',
    })
    const prisma = makeFakePrisma({ applyAfter: { title: "Fixed" } })

    const events = await collect(
      streamChatTurn(
        { threadId: "thread-1", prompt: "rename the title" },
        { prisma, user: EDITOR },
      ),
    )

    expect(events.find((e) => e.type === "error")).toBeUndefined()
    expect(events.find((e) => e.type === "mutation_applied")).toBeDefined()
    expect(events.at(-1)?.type).toBe("done")
  })

  it("extracts the real envelope past brace-bearing prose and a leading fenced plan (multi-fence)", async () => {
    // The model emits a planning object in one fence, prose with a stray
    // brace, then the real envelope in a second fence. The shared
    // balanced-brace extractor must recover the LAST parseable object.
    mastraGenerateMock.mockResolvedValue({
      text: [
        "Here's my plan:",
        "```json",
        '{"plan":"hero then quote"}',
        "```",
        "Use the {topic} placeholder. Final draft:",
        "```json",
        '{"mutations":{"title":"From Multi-Fence"}}',
        "```",
      ].join("\n"),
    })
    const prisma = makeFakePrisma({
      applyAfter: { title: "From Multi-Fence" },
    })

    const events = await collect(
      streamChatTurn(
        { threadId: "thread-1", prompt: "draft it" },
        { prisma, user: EDITOR },
      ),
    )

    expect(events.find((e) => e.type === "error")).toBeUndefined()
    expect(events.find((e) => e.type === "mutation_applied")).toBeDefined()
    expect(events.at(-1)?.type).toBe("done")
  })

  it("coerces diff-shaped scalars under `mutations` ({before,after}) to flat strings (gateway/Qwen hybrid envelope)", async () => {
    // Regression guard for the gateway-model failure: the coding model
    // emits the legacy `mutations` wrapper but with diff-shaped scalar
    // VALUES (`title: { before, after }`). Before the translator's
    // mutations-branch unwrap, this hit `ChatMutationsSchema.title`
    // (z.string()) and produced `event=schema_violation … expected
    // string received object`, so the edit never applied. It must now
    // unwrap `.after` and apply cleanly — no error event.
    mastraGenerateMock.mockResolvedValue(
      mastraEnvelope({
        title: { before: "", after: "Updated Title" },
        metaDescription: { before: null, after: "New meta" },
      }),
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

    expect(events.find((e) => e.type === "error")).toBeUndefined()
    expect(events.find((e) => e.type === "mutation_applied")).toBeDefined()
    expect(events.at(-1)?.type).toBe("done")
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
    const err = new ProviderNotConfiguredError(
      "openrouter",
      "OPENROUTER_API_KEY",
    )
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

  it("forwards a composed abortSignal into Mastra's generate call (caller-cancel still aborts it)", async () => {
    // The service composes the caller's abortSignal with a wall-clock
    // budget timeout (AbortSignal.any), so generate() receives a NEW
    // composed signal — not the caller's signal by reference. Assert the
    // composition propagates: aborting the caller's controller aborts the
    // signal generate() was handed.
    let seenSignal: AbortSignal | undefined
    mastraGenerateMock.mockImplementation(
      async (_prompt: string, opts: { abortSignal?: AbortSignal }) => {
        seenSignal = opts.abortSignal
        return mastraEnvelope({ title: "Y" }, { reason: "y" })
      },
    )
    const prisma = makeFakePrisma({ applyAfter: { title: "Y" } })
    const controller = new AbortController()

    await collect(
      streamChatTurn(
        { threadId: "thread-1", prompt: "hi" },
        { prisma, user: EDITOR, abortSignal: controller.signal },
      ),
    )

    expect(seenSignal).toBeInstanceOf(AbortSignal)
    expect(seenSignal).not.toBe(controller.signal)
    expect(seenSignal!.aborted).toBe(false)
    controller.abort()
    expect(seenSignal!.aborted).toBe(true)
  })

  it("classifies an aborted-but-resolved-empty generate() as timeout (not provider_validation_failed)", async () => {
    // Production root cause: a from-scratch draft on the gateway model
    // runs ~37-45s, past the chat-turn budget. When the budget signal
    // fires, the AI SDK RESOLVES generate() with empty text rather than
    // rejecting — so the run reaches the success path with an empty
    // buffer. Without the abort guard this was misreported as
    // `provider_validation_failed` ("returned text without a JSON
    // object"; prod logs showed `stream_done buffer_length=0` +
    // `no_json_object head="" tail=""`). The guard must classify it as a
    // `timeout` instead. Here AbortSignal.timeout is faked to return an
    // already-aborted signal and generate() resolves with empty text.
    const realTimeout = AbortSignal.timeout
    const timeoutSpy = vi
      .spyOn(AbortSignal, "timeout")
      .mockImplementation(() => {
        const c = new AbortController()
        c.abort(new DOMException("timed out", "TimeoutError"))
        return c.signal
      })
    try {
      mastraGenerateMock.mockResolvedValue({ text: "" })
      const prisma = makeFakePrisma()

      const events = await collect(
        streamChatTurn(
          { threadId: "thread-1", prompt: "draft a full page" },
          { prisma, user: EDITOR },
        ),
      )

      const err = events.find((e) => e.type === "error")
      expect(err).toMatchObject({ type: "error", code: "timeout" })
    } finally {
      timeoutSpy.mockRestore()
      expect(AbortSignal.timeout).toBe(realTimeout)
    }
  })

  it("emits a timeout-classified error event when the chat-turn budget fires", async () => {
    // generate() waits on its (composed) abortSignal; we inject a tiny
    // budget by faking AbortSignal.timeout to abort synchronously, then
    // reject with the DOMException the timeout produces. The service must
    // classify the abort as a `timeout` error event (not `unknown`).
    const realTimeout = AbortSignal.timeout
    const timeoutSpy = vi
      .spyOn(AbortSignal, "timeout")
      .mockImplementation(() => {
        const c = new AbortController()
        c.abort(new DOMException("timed out", "TimeoutError"))
        return c.signal
      })
    try {
      mastraGenerateMock.mockImplementation(
        (_prompt: string, opts: { abortSignal?: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            const signal = opts.abortSignal
            const onAbort = () =>
              reject(
                (signal?.reason as Error | undefined) ??
                  new DOMException("aborted", "AbortError"),
              )
            if (signal?.aborted) onAbort()
            else signal?.addEventListener("abort", onAbort)
          }),
      )
      const prisma = makeFakePrisma()

      const events = await collect(
        streamChatTurn(
          { threadId: "thread-1", prompt: "hi" },
          { prisma, user: EDITOR },
        ),
      )

      const err = events.find((e) => e.type === "error")
      expect(err).toMatchObject({ type: "error", code: "timeout" })
    } finally {
      timeoutSpy.mockRestore()
      // Sanity: the real implementation is restored.
      expect(AbortSignal.timeout).toBe(realTimeout)
    }
  })
})
