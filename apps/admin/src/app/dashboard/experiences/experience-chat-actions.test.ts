import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Principal } from "@/auth/principal"
import { ForbiddenError } from "@/services/errors"
import {
  archiveThreadAction,
  createThreadAction,
  getMessagesAction,
  listThreadsAction,
  summarizeFirstPromptToTitle,
} from "./experience-chat-actions"

const OWNER: Principal = { id: "owner-1", role: "EDITOR" }
const STRANGER: Principal = { id: "stranger-1", role: "EDITOR" }

type Deps = ReturnType<typeof makeDeps>

function makeLocaleRow(
  overrides: { ownerId?: string; archivedAt?: Date | null } = {},
) {
  return {
    id: "locale-1",
    status: "DRAFT" as const,
    experienceId: "exp-1",
    experience: {
      ownerId: overrides.ownerId ?? OWNER.id,
      archivedAt: overrides.archivedAt ?? null,
    },
  }
}

function makeDeps(opts: { user?: Principal | null } = {}) {
  const localeRow = makeLocaleRow()
  return {
    prisma: {
      experienceLocale: {
        findUnique: vi.fn().mockResolvedValue(localeRow),
      },
      experienceChatThread: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      experienceChatMessage: {
        findMany: vi.fn(),
      },
    },
    user: opts.user === undefined ? OWNER : opts.user,
  }
}

describe("summarizeFirstPromptToTitle", () => {
  it("truncates a 100-word prompt to 6 words + ellipsis", () => {
    const prompt = Array.from({ length: 100 }, (_, i) => `word${i}`).join(" ")
    const title = summarizeFirstPromptToTitle(prompt)
    expect(title).toBe("word0 word1 word2 word3 word4 word5…")
  })

  it("returns the prompt unchanged if ≤ 6 words", () => {
    expect(summarizeFirstPromptToTitle("only three words")).toBe(
      "only three words",
    )
  })

  it("falls back to a default for empty input", () => {
    expect(summarizeFirstPromptToTitle("   ")).toBe("New conversation")
  })
})

describe("listThreadsAction", () => {
  let deps: Deps

  beforeEach(() => {
    deps = makeDeps()
  })

  it("filters out archived threads via the where clause", async () => {
    deps.prisma.experienceChatThread.findMany.mockResolvedValue([
      {
        id: "t-1",
        title: "Hi",
        createdAt: new Date("2026-01-01T00:00:00Z"),
        lastMessageAt: new Date("2026-01-02T00:00:00Z"),
      },
    ])

    const result = await listThreadsAction(deps, {
      experienceLocaleId: "locale-1",
    })

    expect(deps.prisma.experienceChatThread.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { experienceLocaleId: "locale-1", archivedAt: null },
        orderBy: { lastMessageAt: "desc" },
      }),
    )
    expect(result).toEqual([
      {
        id: "t-1",
        title: "Hi",
        createdAt: "2026-01-01T00:00:00.000Z",
        lastMessageAt: "2026-01-02T00:00:00.000Z",
      },
    ])
  })

  it("throws ForbiddenError when ABAC denies", async () => {
    deps = makeDeps({ user: STRANGER })
    await expect(
      listThreadsAction(deps, { experienceLocaleId: "locale-1" }),
    ).rejects.toBeInstanceOf(ForbiddenError)
    expect(deps.prisma.experienceChatThread.findMany).not.toHaveBeenCalled()
  })
})

describe("createThreadAction", () => {
  let deps: Deps

  beforeEach(() => {
    deps = makeDeps()
  })

  it("creates a thread row with auto-summarized title", async () => {
    deps.prisma.experienceChatThread.create.mockResolvedValue({
      id: "t-2",
      title: "expand the intro a bit and…",
      createdAt: new Date("2026-02-01T00:00:00Z"),
      lastMessageAt: new Date("2026-02-01T00:00:00Z"),
    })

    const result = await createThreadAction(deps, {
      experienceLocaleId: "locale-1",
      firstPrompt:
        "expand the intro a bit and add a stronger CTA at the bottom please",
    })

    expect(deps.prisma.experienceChatThread.create).toHaveBeenCalledWith({
      data: {
        experienceLocaleId: "locale-1",
        title: "expand the intro a bit and…",
        createdByUserId: OWNER.id,
      },
      select: expect.any(Object),
    })
    expect(result.id).toBe("t-2")
  })

  it("throws ForbiddenError when ABAC denies", async () => {
    deps = makeDeps({ user: STRANGER })
    await expect(
      createThreadAction(deps, {
        experienceLocaleId: "locale-1",
        firstPrompt: "anything",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })
})

describe("archiveThreadAction", () => {
  let deps: Deps

  beforeEach(() => {
    deps = makeDeps()
    deps.prisma.experienceChatThread.findUnique.mockResolvedValue({
      id: "t-3",
      experienceLocaleId: "locale-1",
      experienceLocale: makeLocaleRow(),
    })
  })

  it("sets archivedAt", async () => {
    deps.prisma.experienceChatThread.update.mockResolvedValue({
      id: "t-3",
      archivedAt: new Date("2026-03-01T00:00:00Z"),
    })

    const result = await archiveThreadAction(deps, { threadId: "t-3" })

    expect(deps.prisma.experienceChatThread.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "t-3" },
        data: { archivedAt: expect.any(Date) },
      }),
    )
    expect(result.id).toBe("t-3")
    expect(result.archivedAt).toBe("2026-03-01T00:00:00.000Z")
  })

  it("throws ForbiddenError when ABAC denies", async () => {
    deps = makeDeps({ user: STRANGER })
    deps.prisma.experienceChatThread.findUnique.mockResolvedValue({
      id: "t-3",
      experienceLocaleId: "locale-1",
      experienceLocale: makeLocaleRow(),
    })
    await expect(
      archiveThreadAction(deps, { threadId: "t-3" }),
    ).rejects.toBeInstanceOf(ForbiddenError)
    expect(deps.prisma.experienceChatThread.update).not.toHaveBeenCalled()
  })
})

describe("getMessagesAction", () => {
  let deps: Deps

  beforeEach(() => {
    deps = makeDeps()
    deps.prisma.experienceChatThread.findUnique.mockResolvedValue({
      id: "t-4",
      experienceLocaleId: "locale-1",
      experienceLocale: makeLocaleRow(),
    })
  })

  it("returns messages ordered by createdAt ASC", async () => {
    deps.prisma.experienceChatMessage.findMany.mockResolvedValue([
      {
        id: "m-1",
        role: "USER",
        content: "hi",
        createdAt: new Date("2026-04-01T00:00:00Z"),
        snapshotDiff: null,
        mutationsApplied: null,
      },
      {
        id: "m-2",
        role: "ASSISTANT",
        content: "Mutation applied.",
        createdAt: new Date("2026-04-01T00:00:01Z"),
        snapshotDiff: { scalars: { title: { before: "x", after: "y" } } },
        mutationsApplied: { mutations: { title: "y" } },
      },
    ])

    const result = await getMessagesAction(deps, { threadId: "t-4" })

    expect(deps.prisma.experienceChatMessage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { threadId: "t-4" },
        orderBy: { createdAt: "asc" },
      }),
    )
    expect(result.map((r) => r.id)).toEqual(["m-1", "m-2"])
    expect(result[1].snapshotDiff).toEqual({
      scalars: { title: { before: "x", after: "y" } },
    })
  })

  it("throws ForbiddenError when ABAC denies", async () => {
    deps = makeDeps({ user: STRANGER })
    deps.prisma.experienceChatThread.findUnique.mockResolvedValue({
      id: "t-4",
      experienceLocaleId: "locale-1",
      experienceLocale: makeLocaleRow(),
    })
    await expect(
      getMessagesAction(deps, { threadId: "t-4" }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })
})
