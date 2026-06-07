import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Principal } from "@/auth/principal"
import { BlocksSchema } from "@/domain/blocks"

// -----------------------------------------------------------------------------
// Hoisted mocks
// -----------------------------------------------------------------------------

const {
  workflowStartMock,
  workflowCreateRunMock,
  getWorkflowByIdMock,
  getMastraMock,
  loadCandidatesMock,
  normalizeMock,
} = vi.hoisted(() => ({
  workflowStartMock: vi.fn(),
  workflowCreateRunMock: vi.fn(),
  getWorkflowByIdMock: vi.fn(),
  getMastraMock: vi.fn(),
  loadCandidatesMock: vi.fn(),
  normalizeMock: vi.fn(),
}))

vi.mock("@/mastra", () => ({
  getMastra: getMastraMock,
}))

vi.mock("@/services/experience-ai/experience-ai.service", () => ({
  loadExperienceAiVideoCandidates: loadCandidatesMock,
  normalizeExperienceDraft: normalizeMock,
}))

// Import AFTER mocks are registered.
import { runGenerateDraftAction, USER_MESSAGES } from "./generate-draft-action"
import { WorkflowStepError } from "@/mastra/workflows/multi-step-draft-workflow"
import { TIME_BUDGET_MS } from "@/mastra/budgets"

const ADMIN: Principal = { id: "admin-1", role: "ADMIN" }

type WriteSpies = {
  experienceLocaleUpdate: ReturnType<typeof vi.fn>
  experienceLocaleUpsert: ReturnType<typeof vi.fn>
  experienceUpdate: ReturnType<typeof vi.fn>
  contentRevisionCreate: ReturnType<typeof vi.fn>
  contentRevisionUpdate: ReturnType<typeof vi.fn>
}

type GenerateDraftDeps = Parameters<typeof runGenerateDraftAction>[0]

type DepsWithSpies = GenerateDraftDeps & {
  prisma: GenerateDraftDeps["prisma"] & {
    contentRevision: GenerateDraftDeps["prisma"]["contentRevision"] & {
      findFirst: ReturnType<typeof vi.fn>
    }
  }
  writeSpies: WriteSpies & {
    chatMessageCreate: ReturnType<typeof vi.fn>
    chatThreadUpdate: ReturnType<typeof vi.fn>
  }
}

function mockDeps(overrides?: {
  blocks?: unknown
  user?: Principal | null
  draftSnapshot?: unknown | null
  chatMessageCreateImpl?: (args: unknown) => unknown
  /**
   * The locale a persisted thread claims it belongs to. Defaults to
   * "locale-1" (matching the authorized locale) so happy-path
   * persistence tests pass the thread-locale ABAC cross-check. Set to a
   * mismatching id (or null) to exercise the cross-check rejection.
   */
  threadExperienceLocaleId?: string | null
}): DepsWithSpies {
  const chatMessageCreate = vi
    .fn()
    .mockImplementation(
      overrides?.chatMessageCreateImpl ??
        (async () => ({ id: "msg-persisted-1" })),
    )
  const chatThreadUpdate = vi.fn().mockResolvedValue(undefined)

  const writeSpies: DepsWithSpies["writeSpies"] = {
    experienceLocaleUpdate: vi.fn(),
    experienceLocaleUpsert: vi.fn(),
    experienceUpdate: vi.fn(),
    contentRevisionCreate: vi.fn(),
    contentRevisionUpdate: vi.fn(),
    chatMessageCreate,
    chatThreadUpdate,
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
      experienceChatMessage: {
        create: chatMessageCreate,
      },
      experienceChatThread: {
        findUnique: vi.fn().mockResolvedValue(
          overrides?.threadExperienceLocaleId === null
            ? null
            : {
                experienceLocaleId:
                  overrides?.threadExperienceLocaleId ?? "locale-1",
              },
        ),
        update: chatThreadUpdate,
      },
      video: { findMany: vi.fn() },
      videoLocale: { findMany: vi.fn() },
      videoDub: { findMany: vi.fn() },
      videoImage: { findMany: vi.fn() },
    },
    user: overrides?.user ?? ADMIN,
    writeSpies,
  } as unknown as DepsWithSpies
}

const VALID_DRAFT = {
  title: "Hope for the journey",
  metaDescription: "A short reflection.",
  blocks: [
    {
      t: "text" as const,
      heading: "Hope is anchored",
      contentParagraphs: ["Anchored in unchanging truth."],
    },
    {
      t: "card" as const,
      title: "Hope is anchored",
      description: "Discover what scripture says about hope.",
    },
  ],
}

const NORMALIZED_FIXTURE = {
  title: VALID_DRAFT.title,
  metaDescription: VALID_DRAFT.metaDescription,
  blocks: VALID_DRAFT.blocks,
}

function primeHappyPath() {
  loadCandidatesMock.mockResolvedValue([
    { videoId: "v1", title: "Hope Story", slug: "hope" },
  ])
  normalizeMock.mockReturnValue(NORMALIZED_FIXTURE)
  workflowStartMock.mockResolvedValue({
    status: "success",
    result: { draft: VALID_DRAFT },
  })
  workflowCreateRunMock.mockResolvedValue({ start: workflowStartMock })
  getWorkflowByIdMock.mockReturnValue({ createRun: workflowCreateRunMock })
  getMastraMock.mockReturnValue({ getWorkflowById: getWorkflowByIdMock })
}

describe("runGenerateDraftAction (U5 — workflow-backed)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    primeHappyPath()
  })

  it("rejects non-empty canonical canvases with CANVAS_NOT_EMPTY and does NOT invoke the workflow", async () => {
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
    expect(workflowStartMock).not.toHaveBeenCalled()
    expect(loadCandidatesMock).not.toHaveBeenCalled()
  })

  it("rejects when a DRAFT revision has non-empty content even if canonical is empty", async () => {
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

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("unreachable")
    expect(result.code).toBe("CANVAS_NOT_EMPTY")
    expect(workflowStartMock).not.toHaveBeenCalled()
  })

  it("rejects users who cannot edit the locale (FORBIDDEN); workflow not invoked", async () => {
    const result = await runGenerateDraftAction(
      mockDeps({ user: { id: "viewer-1", role: "VIEWER" } }),
      { localeId: "locale-1", locale: "en", prompt: "forgiveness" },
    )

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("unreachable")
    expect(result.code).toBe("FORBIDDEN")
    expect(workflowStartMock).not.toHaveBeenCalled()
  })

  it("returns NO_CANDIDATES when the candidate loader yields an empty array", async () => {
    loadCandidatesMock.mockResolvedValueOnce([])

    const result = await runGenerateDraftAction(mockDeps(), {
      localeId: "locale-1",
      locale: "en",
      prompt: "forgiveness",
    })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("unreachable")
    expect(result.code).toBe("NO_CANDIDATES")
    expect(workflowStartMock).not.toHaveBeenCalled()
  })

  it("invokes multi-step-draft workflow on the happy path and returns the normalized draft", async () => {
    const result = await runGenerateDraftAction(mockDeps(), {
      localeId: "locale-1",
      locale: "en",
      prompt: "hope",
      currentTitle: "Hint",
    })

    expect(result).toEqual({
      ok: true,
      draft: {
        title: NORMALIZED_FIXTURE.title,
        metaDescription: NORMALIZED_FIXTURE.metaDescription,
        blocks: NORMALIZED_FIXTURE.blocks,
      },
    })

    expect(getMastraMock).toHaveBeenCalled()
    expect(getWorkflowByIdMock).toHaveBeenCalledWith("multi-step-draft")
    expect(workflowCreateRunMock).toHaveBeenCalledTimes(1)
    expect(workflowStartMock).toHaveBeenCalledTimes(1)

    const startArgs = workflowStartMock.mock.calls[0][0] as {
      inputData: { prompt: string; locale: string; candidates: unknown[] }
    }
    expect(startArgs.inputData.locale).toBe("en")
    expect(startArgs.inputData.prompt).toContain("hope")
    expect(startArgs.inputData.prompt).toContain("Hint")
    expect(startArgs.inputData.candidates).toHaveLength(1)

    // The action calls normalize against the workflow's draft + candidates.
    expect(normalizeMock).toHaveBeenCalledWith(
      VALID_DRAFT,
      expect.arrayContaining([expect.objectContaining({ videoId: "v1" })]),
    )
  })

  it("maps WorkflowStepError(schema_mismatch) to SCHEMA_MISMATCH", async () => {
    workflowStartMock.mockResolvedValueOnce({
      status: "failed",
      error: new WorkflowStepError("draft", "schema_mismatch", "boom"),
    })

    const result = await runGenerateDraftAction(mockDeps(), {
      localeId: "locale-1",
      locale: "en",
      prompt: "hope",
    })

    expect(result).toEqual({
      ok: false,
      code: "SCHEMA_MISMATCH",
      error: USER_MESSAGES.SCHEMA_MISMATCH,
    })
  })

  it("maps WorkflowStepError(agent_error) to UPSTREAM_ERROR", async () => {
    workflowStartMock.mockResolvedValueOnce({
      status: "failed",
      error: new WorkflowStepError("critique", "agent_error", "boom"),
    })

    const result = await runGenerateDraftAction(mockDeps(), {
      localeId: "locale-1",
      locale: "en",
      prompt: "hope",
    })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("unreachable")
    expect(result.code).toBe("UPSTREAM_ERROR")
  })

  it("maps WorkflowStepError(timeout) to UPSTREAM_ERROR", async () => {
    workflowStartMock.mockResolvedValueOnce({
      status: "failed",
      error: new WorkflowStepError("plan", "timeout", "aborted"),
    })

    const result = await runGenerateDraftAction(mockDeps(), {
      localeId: "locale-1",
      locale: "en",
      prompt: "hope",
    })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("unreachable")
    expect(result.code).toBe("UPSTREAM_ERROR")
  })

  it("classifies an OPENROUTER_API_KEY-missing-shaped agent_error as NOT_CONFIGURED", async () => {
    workflowStartMock.mockResolvedValueOnce({
      status: "failed",
      error: new WorkflowStepError(
        "draft",
        "agent_error",
        "OPENROUTER_API_KEY is missing — provider not configured",
      ),
    })

    const result = await runGenerateDraftAction(mockDeps(), {
      localeId: "locale-1",
      locale: "en",
      prompt: "hope",
    })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("unreachable")
    expect(result.code).toBe("NOT_CONFIGURED")
  })

  it("collapses unknown thrown errors into UNKNOWN", async () => {
    workflowStartMock.mockRejectedValueOnce(new Error("boom"))

    const result = await runGenerateDraftAction(mockDeps(), {
      localeId: "locale-1",
      locale: "en",
      prompt: "hope",
    })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("unreachable")
    expect(result.code).toBe("UNKNOWN")
  })

  it("returns UPSTREAM_ERROR if the workflow exceeds the wall-clock budget", async () => {
    // Workflow never resolves — the action's Promise.race against
    // TIME_BUDGET_MS.multiStepWorkflow should reject as timeout.
    workflowStartMock.mockImplementationOnce(() => new Promise(() => {}))

    vi.useFakeTimers()
    try {
      const promise = runGenerateDraftAction(mockDeps(), {
        localeId: "locale-1",
        locale: "en",
        prompt: "hope",
      })
      await vi.advanceTimersByTimeAsync(TIME_BUDGET_MS.multiStepWorkflow + 100)
      const result = await promise

      expect(result.ok).toBe(false)
      if (result.ok) throw new Error("unreachable")
      expect(result.code).toBe("UPSTREAM_ERROR")
    } finally {
      vi.useRealTimers()
    }
  })

  it("best-effort cancels the orphaned run handle on a wall-clock timeout", async () => {
    // The run handle exposes Mastra's `cancel()`; on timeout the action
    // must invoke it so the workflow stops burning LLM calls. The cancel
    // is fire-and-forget — a slow/failed cancel must not change the
    // returned UPSTREAM_ERROR.
    const cancelMock = vi.fn().mockResolvedValue(undefined)
    workflowStartMock.mockImplementationOnce(() => new Promise(() => {}))
    workflowCreateRunMock.mockResolvedValueOnce({
      start: workflowStartMock,
      cancel: cancelMock,
      runId: "run-timeout-1",
    })

    vi.useFakeTimers()
    try {
      const promise = runGenerateDraftAction(mockDeps(), {
        localeId: "locale-1",
        locale: "en",
        prompt: "hope",
      })
      await vi.advanceTimersByTimeAsync(TIME_BUDGET_MS.multiStepWorkflow + 100)
      const result = await promise

      expect(result.ok).toBe(false)
      if (result.ok) throw new Error("unreachable")
      expect(result.code).toBe("UPSTREAM_ERROR")
      expect(cancelMock).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it("integration: returns a BlocksSchema-valid draft and calls no Prisma writes", async () => {
    const candidates = [
      {
        videoId: "video-1",
        slug: "hope-story",
        title: "Hope Story",
      },
      {
        videoId: "video-2",
        slug: "prayer-story",
        title: "Prayer Story",
      },
    ]

    const normalizedFixture = {
      title: "Hope for the Journey",
      metaDescription: "A first draft.",
      blocks: [
        {
          t: "videoHero" as const,
          sectionKey: "ai-s01",
          useRouteVideo: false,
          videoId: "video-1",
          streamingUrl: "https://example.com/hope.m3u8",
          ctaLabel: "Watch",
          headingSource: "videoTitle" as const,
        },
        {
          t: "section" as const,
          sectionKey: "ai-s02",
          dynamicBackgroundImage: false,
          staticOverlay: false,
          content: [
            {
              t: "navigationCarousel" as const,
              items: [{ contentId: "ai-s01", title: "Watch the story" }],
            },
          ],
        },
      ],
    }

    loadCandidatesMock.mockResolvedValueOnce(candidates)
    normalizeMock.mockReturnValueOnce(normalizedFixture)
    workflowStartMock.mockResolvedValueOnce({
      status: "success",
      result: { draft: normalizedFixture },
    })

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

    // R5 — ephemeral. No Prisma write entry point should fire.
    expect(deps.writeSpies.experienceLocaleUpdate).not.toHaveBeenCalled()
    expect(deps.writeSpies.experienceLocaleUpsert).not.toHaveBeenCalled()
    expect(deps.writeSpies.experienceUpdate).not.toHaveBeenCalled()
    expect(deps.writeSpies.contentRevisionCreate).not.toHaveBeenCalled()
    expect(deps.writeSpies.contentRevisionUpdate).not.toHaveBeenCalled()
  })

  // ---------------------------------------------------------------------------
  // U2 — workflow-output persistence for chat-thumb-rating attachment
  // ---------------------------------------------------------------------------

  it("U2: persists an assistant message with producedBy='multi-step-draft' when threadId is supplied", async () => {
    const deps = mockDeps()
    const result = await runGenerateDraftAction(deps, {
      localeId: "locale-1",
      locale: "en",
      prompt: "hope",
      threadId: "thread-abc",
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("unreachable")
    expect(result.messageId).toBe("msg-persisted-1")
    expect(result.producedBy).toBe("multi-step-draft")

    expect(deps.writeSpies.chatMessageCreate).toHaveBeenCalledTimes(1)
    const createArg = deps.writeSpies.chatMessageCreate.mock.calls[0][0] as {
      data: {
        threadId: string
        role: string
        producedBy: string
        providerKind: string
      }
    }
    expect(createArg.data.threadId).toBe("thread-abc")
    expect(createArg.data.role).toBe("ASSISTANT")
    expect(createArg.data.producedBy).toBe("multi-step-draft")
    expect(createArg.data.providerKind).toBe("mastra")
    // Thread lastMessageAt is bumped so the chat sidebar shows
    // recent activity.
    expect(deps.writeSpies.chatThreadUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "thread-abc" },
        data: expect.objectContaining({ lastMessageAt: expect.any(Date) }),
      }),
    )
  })

  it("U2: skips persistence when threadId is omitted (legacy callers)", async () => {
    const deps = mockDeps()
    const result = await runGenerateDraftAction(deps, {
      localeId: "locale-1",
      locale: "en",
      prompt: "hope",
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("unreachable")
    expect(result.messageId).toBeUndefined()
    expect(result.producedBy).toBeUndefined()
    expect(result.runId).toBeUndefined()
    expect(deps.writeSpies.chatMessageCreate).not.toHaveBeenCalled()
    expect(deps.writeSpies.chatThreadUpdate).not.toHaveBeenCalled()
  })

  it("does NOT persist a message when the threadId belongs to a different locale (ABAC cross-check)", async () => {
    // The thread resolves to a DIFFERENT experienceLocaleId than the
    // authorized locale ("locale-1"); the action must skip persistence
    // entirely and still ship the draft back to the caller.
    const deps = mockDeps({ threadExperienceLocaleId: "locale-OTHER" })
    const result = await runGenerateDraftAction(deps, {
      localeId: "locale-1",
      locale: "en",
      prompt: "hope",
      threadId: "thread-foreign",
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("unreachable")
    expect(result.draft.title).toBe(NORMALIZED_FIXTURE.title)
    expect(result.messageId).toBeUndefined()
    expect(result.producedBy).toBeUndefined()
    expect(deps.writeSpies.chatMessageCreate).not.toHaveBeenCalled()
    expect(deps.writeSpies.chatThreadUpdate).not.toHaveBeenCalled()
  })

  it("Quick mode: invokes quick-draft workflow and stamps producedBy='quick-draft'", async () => {
    const deps = mockDeps()
    const result = await runGenerateDraftAction(deps, {
      localeId: "locale-1",
      locale: "en",
      prompt: "hope",
      threadId: "thread-abc",
      mode: "quick",
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("unreachable")
    expect(result.producedBy).toBe("quick-draft")
    expect(getWorkflowByIdMock).toHaveBeenCalledWith("quick-draft")
    expect(deps.writeSpies.chatMessageCreate).toHaveBeenCalledTimes(1)
    const createArg = deps.writeSpies.chatMessageCreate.mock.calls[0][0] as {
      data: { producedBy: string }
    }
    expect(createArg.data.producedBy).toBe("quick-draft")
  })

  it("Default mode is 'full' (multi-step-draft) when mode is omitted", async () => {
    const deps = mockDeps()
    const result = await runGenerateDraftAction(deps, {
      localeId: "locale-1",
      locale: "en",
      prompt: "hope",
      threadId: "thread-abc",
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("unreachable")
    expect(result.producedBy).toBe("multi-step-draft")
    expect(getWorkflowByIdMock).toHaveBeenCalledWith("multi-step-draft")
  })

  it("U2: persistence failure is non-fatal — draft still ships back to caller", async () => {
    const deps = mockDeps({
      chatMessageCreateImpl: () => {
        throw new Error("simulated DB unavailable")
      },
    })

    const result = await runGenerateDraftAction(deps, {
      localeId: "locale-1",
      locale: "en",
      prompt: "hope",
      threadId: "thread-failing",
    })

    // Draft must come back; just no messageId/producedBy/runId.
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("unreachable")
    expect(result.draft.title).toBe(NORMALIZED_FIXTURE.title)
    expect(result.messageId).toBeUndefined()
    expect(result.producedBy).toBeUndefined()
  })
})
