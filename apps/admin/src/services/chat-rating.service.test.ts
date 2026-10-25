/**
 * U4 — chat-rating service tests.
 *
 * Uses Mastra's real `InMemoryStore` as the scores backend (no
 * hand-rolled mock of the storage shape — round-trip discipline per
 * `docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md`).
 * Prisma is mocked at the call shape needed for the service's
 * boundary checks (message lookup + thread lookup).
 */

import { describe, expect, it, vi, beforeEach } from "vitest"
import { Mastra } from "@mastra/core"
import { InMemoryStore } from "@mastra/core/storage"

import type { Principal } from "@/auth/principal"
import {
  clearRating,
  listRatingsForThread,
  submitRating,
  ForbiddenError,
  MessageNotFoundError,
  NotRatableError,
  CommentTooLongError,
  type ChatRatingDeps,
} from "./chat-rating.service"
import { CHAT_RATING_COMMENT_MAX_LENGTH } from "./chat-rating.constants"

const OWNER_ADMIN: Principal = { id: "admin-1", role: "ADMIN" }
// Second principal must also satisfy canEditExperienceLocale on the
// fixture's locale (ownerId='admin-1'). Another ADMIN is the simplest
// way; the permission ladder lets ADMIN edit any experience.
const OTHER_ADMIN: Principal = { id: "admin-2", role: "ADMIN" }

function buildMastraWithInMemoryStorage(): Mastra {
  return new Mastra({ storage: new InMemoryStore() })
}

type FakeMessageRow = {
  id: string
  producedBy: string | null
  threadId: string
}

type FakeThreadRow = {
  id: string
  experienceLocale: {
    status: "DRAFT" | "PUBLISHED" | "ARCHIVED"
    experience: { ownerId: string; archivedAt: Date | null }
  }
}

function makePrisma(opts: {
  messages?: FakeMessageRow[]
  thread?: FakeThreadRow | null
}) {
  const messages = opts.messages ?? []
  const thread = opts.thread ?? null
  return {
    experienceChatMessage: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const row = messages.find((m) => m.id === where.id)
        if (!row) return null
        return {
          id: row.id,
          producedBy: row.producedBy,
          threadId: row.threadId,
          thread: { experienceLocale: thread?.experienceLocale },
        }
      }),
      findMany: vi.fn(
        async ({
          where,
        }: {
          where: { threadId: string; producedBy: { not: null } }
        }) =>
          messages
            .filter(
              (m) => m.threadId === where.threadId && m.producedBy !== null,
            )
            .map((m) => ({ id: m.id, producedBy: m.producedBy })),
      ),
    },
    experienceChatThread: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        if (!thread || thread.id !== where.id) return null
        return { experienceLocale: thread.experienceLocale }
      }),
    },
  } as unknown as ChatRatingDeps["prisma"]
}

function defaultThread(): FakeThreadRow {
  return {
    id: "thread-1",
    experienceLocale: {
      status: "DRAFT",
      experience: { ownerId: "admin-1", archivedAt: null },
    },
  }
}

function makeDeps(overrides?: {
  prisma?: ChatRatingDeps["prisma"]
  principal?: Principal
}): ChatRatingDeps {
  return {
    prisma: overrides?.prisma ?? makePrisma({ thread: defaultThread() }),
    mastra: buildMastraWithInMemoryStorage(),
    principal: overrides?.principal ?? OWNER_ADMIN,
  }
}

describe("chat-rating service — submitRating", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("happy path: submits 👍 for a multi-step-draft message and returns the new state", async () => {
    const deps = makeDeps({
      prisma: makePrisma({
        messages: [
          { id: "msg-1", producedBy: "multi-step-draft", threadId: "thread-1" },
        ],
        thread: defaultThread(),
      }),
    })

    const state = await submitRating(
      { messageId: "msg-1", score: 1, comment: "great" },
      deps,
    )

    expect(state).not.toBeNull()
    expect(state!.score).toBe(1)
    expect(state!.comment).toBe("great")
    expect(state!.updatedAt).toBeTruthy()
  })

  it("happy path: latest-wins for 👍 → 👎 toggle by the same user", async () => {
    const deps = makeDeps({
      prisma: makePrisma({
        messages: [
          { id: "msg-1", producedBy: "multi-step-draft", threadId: "thread-1" },
        ],
        thread: defaultThread(),
      }),
    })

    await submitRating({ messageId: "msg-1", score: 1 }, deps)
    // Small spacing so createdAt differs in the in-memory store's
    // millisecond-resolution timestamps.
    await new Promise((r) => setTimeout(r, 2))
    const flipped = await submitRating({ messageId: "msg-1", score: 0 }, deps)

    expect(flipped!.score).toBe(0)
  })

  it("rejects messages with an unknown producer id as NotRatableError", async () => {
    // After the scope reversal, experience-default-chat is ratable.
    // The only non-ratable signals are now (a) producedBy IS NULL
    // (historic rows from before migration 0017 — see the next test)
    // and (b) an unrecognised producer id that's not in the closed
    // RATABLE_PRODUCERS set. This test covers (b).
    const deps = makeDeps({
      prisma: makePrisma({
        messages: [
          {
            id: "msg-unknown",
            producedBy: "some-future-agent",
            threadId: "thread-1",
          },
        ],
        thread: defaultThread(),
      }),
    })

    await expect(
      submitRating({ messageId: "msg-unknown", score: 1 }, deps),
    ).rejects.toBeInstanceOf(NotRatableError)
  })

  it("accepts messages with producedBy='experience-default-chat' (send-button chat replies are ratable)", async () => {
    const deps = makeDeps({
      prisma: makePrisma({
        messages: [
          {
            id: "msg-chat",
            producedBy: "experience-default-chat",
            threadId: "thread-1",
          },
        ],
        thread: defaultThread(),
      }),
    })

    const state = await submitRating(
      { messageId: "msg-chat", score: 1, comment: "good reply" },
      deps,
    )
    expect(state).not.toBeNull()
    expect(state!.score).toBe(1)
  })

  it("rejects messages with producedBy=null (historic rows) as NotRatableError", async () => {
    const deps = makeDeps({
      prisma: makePrisma({
        messages: [{ id: "msg-old", producedBy: null, threadId: "thread-1" }],
        thread: defaultThread(),
      }),
    })

    await expect(
      submitRating({ messageId: "msg-old", score: 1 }, deps),
    ).rejects.toBeInstanceOf(NotRatableError)
  })

  it("rejects unknown messageId as MessageNotFoundError", async () => {
    const deps = makeDeps()
    await expect(
      submitRating({ messageId: "msg-missing", score: 1 }, deps),
    ).rejects.toBeInstanceOf(MessageNotFoundError)
  })

  it("rejects principals who cannot edit the locale as ForbiddenError", async () => {
    const deps = makeDeps({
      principal: { id: "viewer-1", role: "VIEWER" },
      prisma: makePrisma({
        messages: [
          { id: "msg-1", producedBy: "multi-step-draft", threadId: "thread-1" },
        ],
        thread: defaultThread(),
      }),
    })
    await expect(
      submitRating({ messageId: "msg-1", score: 1 }, deps),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it("rejects comments longer than the cap as CommentTooLongError", async () => {
    const deps = makeDeps({
      prisma: makePrisma({
        messages: [
          { id: "msg-1", producedBy: "multi-step-draft", threadId: "thread-1" },
        ],
        thread: defaultThread(),
      }),
    })

    const tooLong = "x".repeat(CHAT_RATING_COMMENT_MAX_LENGTH + 1)
    await expect(
      submitRating({ messageId: "msg-1", score: 1, comment: tooLong }, deps),
    ).rejects.toBeInstanceOf(CommentTooLongError)
  })

  it("normalises empty-string comment to null", async () => {
    const deps = makeDeps({
      prisma: makePrisma({
        messages: [
          { id: "msg-1", producedBy: "multi-step-draft", threadId: "thread-1" },
        ],
        thread: defaultThread(),
      }),
    })
    const state = await submitRating(
      { messageId: "msg-1", score: 1, comment: "   " },
      deps,
    )
    expect(state!.comment).toBeNull()
  })

  it("two raters on the same message each see only their own latest score", async () => {
    const prisma = makePrisma({
      messages: [
        { id: "msg-1", producedBy: "multi-step-draft", threadId: "thread-1" },
      ],
      thread: defaultThread(),
    })
    const mastra = buildMastraWithInMemoryStorage()

    const adminDeps: ChatRatingDeps = {
      prisma,
      mastra,
      principal: OWNER_ADMIN,
    }
    const editorDeps: ChatRatingDeps = {
      prisma,
      mastra,
      principal: OTHER_ADMIN,
    }

    await submitRating({ messageId: "msg-1", score: 1 }, adminDeps)
    const editorState = await submitRating(
      { messageId: "msg-1", score: 0 },
      editorDeps,
    )

    // Re-read the admin's state — should still be 👍, not the editor's 👎.
    const adminState = await submitRating(
      { messageId: "msg-1", score: 1 },
      adminDeps,
    )

    expect(editorState!.score).toBe(0)
    expect(adminState!.score).toBe(1)
  })
})

describe("chat-rating service — clearRating", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("clears a previously-rated message and returns null state", async () => {
    const deps = makeDeps({
      prisma: makePrisma({
        messages: [
          { id: "msg-1", producedBy: "multi-step-draft", threadId: "thread-1" },
        ],
        thread: defaultThread(),
      }),
    })
    await submitRating({ messageId: "msg-1", score: 1 }, deps)
    await new Promise((r) => setTimeout(r, 2))
    const after = await clearRating({ messageId: "msg-1" }, deps)
    expect(after).toBeNull()
  })

  it("rejects clearing non-ratable producers (unknown producer id)", async () => {
    const deps = makeDeps({
      prisma: makePrisma({
        messages: [
          {
            id: "msg-unknown",
            producedBy: "some-future-agent",
            threadId: "thread-1",
          },
        ],
        thread: defaultThread(),
      }),
    })
    await expect(
      clearRating({ messageId: "msg-unknown" }, deps),
    ).rejects.toBeInstanceOf(NotRatableError)
  })
})

describe("chat-rating service — listRatingsForThread", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns only ratable messages with active ratings", async () => {
    // Mixed thread: ratable workflow output + ratable chat reply +
    // unrated workflow output + non-ratable historic row + different
    // thread. The listing should include only entries with an active
    // rating for the active principal.
    const deps = makeDeps({
      prisma: makePrisma({
        messages: [
          { id: "msg-1", producedBy: "multi-step-draft", threadId: "thread-1" },
          {
            id: "msg-2",
            producedBy: "experience-default-chat",
            threadId: "thread-1",
          },
          { id: "msg-3", producedBy: "multi-step-draft", threadId: "thread-1" },
          // Historic row (pre-migration 0017) — still non-ratable.
          { id: "msg-historic", producedBy: null, threadId: "thread-1" },
          // Different thread:
          { id: "msg-x", producedBy: "multi-step-draft", threadId: "other" },
        ],
        thread: defaultThread(),
      }),
    })

    await submitRating({ messageId: "msg-1", score: 1, comment: "yes" }, deps)
    // msg-2 + msg-3 deliberately unrated.

    const states = await listRatingsForThread({ threadId: "thread-1" }, deps)
    expect(Object.keys(states).sort()).toEqual(["msg-1"])
    expect(states["msg-1"]!.score).toBe(1)
    expect(states["msg-1"]!.comment).toBe("yes")
  })

  it("returns empty object when the thread has only non-ratable historic messages", async () => {
    const deps = makeDeps({
      prisma: makePrisma({
        messages: [
          {
            id: "msg-historic",
            producedBy: null,
            threadId: "thread-1",
          },
        ],
        thread: defaultThread(),
      }),
    })
    const states = await listRatingsForThread({ threadId: "thread-1" }, deps)
    expect(states).toEqual({})
  })

  it("excludes messages whose latest record is cleared", async () => {
    const deps = makeDeps({
      prisma: makePrisma({
        messages: [
          { id: "msg-1", producedBy: "multi-step-draft", threadId: "thread-1" },
        ],
        thread: defaultThread(),
      }),
    })
    await submitRating({ messageId: "msg-1", score: 1 }, deps)
    await new Promise((r) => setTimeout(r, 2))
    await clearRating({ messageId: "msg-1" }, deps)

    const states = await listRatingsForThread({ threadId: "thread-1" }, deps)
    expect(states).toEqual({})
  })

  it("rejects principals who cannot edit the thread's locale", async () => {
    const deps = makeDeps({
      principal: { id: "viewer-1", role: "VIEWER" },
      prisma: makePrisma({
        messages: [],
        thread: defaultThread(),
      }),
    })
    await expect(
      listRatingsForThread({ threadId: "thread-1" }, deps),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it("returns empty object for an unknown thread (no leakage via 404)", async () => {
    const deps = makeDeps({
      prisma: makePrisma({ messages: [], thread: null }),
    })
    const states = await listRatingsForThread({ threadId: "thread-x" }, deps)
    expect(states).toEqual({})
  })
})
