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
  getAgentByIdMock,
  getMastraMock,
  loadCandidatesMock,
  normalizeMock,
  selectExemplarMock,
  buildOutlineMock,
  repairDraftMock,
} = vi.hoisted(() => ({
  workflowStartMock: vi.fn(),
  workflowCreateRunMock: vi.fn(),
  getWorkflowByIdMock: vi.fn(),
  getAgentByIdMock: vi.fn(),
  getMastraMock: vi.fn(),
  loadCandidatesMock: vi.fn(),
  normalizeMock: vi.fn(),
  selectExemplarMock: vi.fn(),
  buildOutlineMock: vi.fn(),
  repairDraftMock: vi.fn(),
}))

vi.mock("@/mastra", () => ({
  getMastra: getMastraMock,
}))

// The action checks `error instanceof ExperienceAiNormalizationError`, so the
// mock must re-export the REAL class — a stub would break the typed branch and
// let the test pass vacuously (see mocked-shape-vs-real-contract discipline).
import { ExperienceAiNormalizationError } from "@/services/experience-ai/experience-ai-normalize"

vi.mock("@/services/experience-ai/experience-ai.service", () => ({
  loadExperienceAiVideoCandidates: loadCandidatesMock,
  normalizeExperienceDraft: normalizeMock,
  ExperienceAiNormalizationError,
}))

vi.mock("@/services/experience-ai/experience-ai-exemplar.service", () => ({
  selectExperienceExemplar: selectExemplarMock,
}))

vi.mock("@/services/experience-ai/experience-ai-exemplar-outline", () => ({
  buildExemplarOutline: buildOutlineMock,
}))

// Mock ONLY `repairDraft` so the action test can assert call count + drive
// the fail-then-pass loop; keep `classifyRepairability` + `RepairDraftError`
// REAL so the action's repair-class branching (schema_violation vs
// structurally_impossible) is load-bearing, not stubbed. repairDraft's own
// parse/validate internals are covered in repair-draft.test.ts.
vi.mock("@/services/experience-ai/repair-draft", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/services/experience-ai/repair-draft")
    >()
  return { ...actual, repairDraft: repairDraftMock }
})

// Import AFTER mocks are registered.
import { runGenerateDraftAction, USER_MESSAGES } from "./generate-draft-action"
import { WorkflowStepError } from "@/mastra/workflows/multi-step-draft-workflow"
import { TIME_BUDGET_MS } from "@/mastra/budgets"
// Real RepairDraftError (the action mock keeps it real via importOriginal).
import { RepairDraftError } from "@/services/experience-ai/repair-draft"

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
  getAgentByIdMock.mockReturnValue({ generate: vi.fn() })
  getMastraMock.mockReturnValue({
    getWorkflowById: getWorkflowByIdMock,
    getAgentById: getAgentByIdMock,
  })
  // Default: no exemplar (keeps non-exemplar tests on the pre-feature path).
  selectExemplarMock.mockResolvedValue(null)
  buildOutlineMock.mockReturnValue(null)
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

  describe("exemplar wiring (U5)", () => {
    it("passes the built exemplar outline into the workflow inputData when a match is selected", async () => {
      selectExemplarMock.mockResolvedValueOnce({
        source: "matched",
        distance: 0.1,
        row: {
          id: "ex-1",
          locale: "en",
          title: "Easter",
          metaDescription: null,
          blocks: [],
        },
      })
      buildOutlineMock.mockReturnValueOnce("OUTLINE_STRING")

      const deps = mockDeps()
      await runGenerateDraftAction(deps, {
        localeId: "locale-1",
        locale: "en",
        prompt: "a page about grief",
      })

      // Relevance match is driven by the raw theme prompt, and excludes the
      // experience being edited.
      expect(selectExemplarMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          prompt: "a page about grief",
          locale: "en",
          excludeExperienceId: "exp-1",
        }),
      )
      const startArgs = workflowStartMock.mock.calls[0][0] as {
        inputData: { exemplar?: string }
      }
      expect(startArgs.inputData.exemplar).toBe("OUTLINE_STRING")
    })

    it("passes exemplar=undefined when no exemplar is selected", async () => {
      selectExemplarMock.mockResolvedValueOnce(null)

      const deps = mockDeps()
      await runGenerateDraftAction(deps, {
        localeId: "locale-1",
        locale: "en",
        prompt: "hope",
      })

      const startArgs = workflowStartMock.mock.calls[0][0] as {
        inputData: { exemplar?: string }
      }
      expect(startArgs.inputData.exemplar).toBeUndefined()
      expect(buildOutlineMock).not.toHaveBeenCalled()
    })

    it("never fails generation when exemplar selection throws (non-fatal)", async () => {
      selectExemplarMock.mockRejectedValueOnce(new Error("boom"))

      const deps = mockDeps()
      const result = await runGenerateDraftAction(deps, {
        localeId: "locale-1",
        locale: "en",
        prompt: "hope",
      })

      expect(result.ok).toBe(true)
      const startArgs = workflowStartMock.mock.calls[0][0] as {
        inputData: { exemplar?: string }
      }
      expect(startArgs.inputData.exemplar).toBeUndefined()
    })
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

  it("maps WorkflowStepError(truncated) to UPSTREAM_ERROR (U4 — finishReason=length, non-repairable)", async () => {
    // Only the `truncated` branch matches: a real WorkflowStepError whose
    // reason is the U4 truncation signal. It must classify to UPSTREAM_ERROR
    // (NOT SCHEMA_MISMATCH — never routed into the repair loop).
    workflowStartMock.mockResolvedValueOnce({
      status: "failed",
      error: new WorkflowStepError(
        "fill",
        "truncated",
        "agent output truncated on step 'fill' (finishReason=length)",
      ),
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

  it("collapses unknown thrown errors into UNKNOWN and logs them in plain-string format", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    workflowStartMock.mockRejectedValueOnce(new Error("boom"))

    const result = await runGenerateDraftAction(mockDeps(), {
      localeId: "locale-1",
      locale: "en",
      prompt: "hope",
    })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("unreachable")
    expect(result.code).toBe("UNKNOWN")

    // Plain-string `[label] event=... key=value` log (Railway logsV2 silences
    // JSON.stringify payloads from this runtime route path).
    expect(errorSpy).toHaveBeenCalledTimes(1)
    const logged = String(errorSpy.mock.calls[0]?.[0])
    expect(logged).toContain("[runGenerateDraftAction]")
    expect(logged).toContain("event=unknown_error")
    errorSpy.mockRestore()
  })

  // ---------------------------------------------------------------------------
  // U1 — normalize-stage typed-error classification. normalizeExperienceDraft
  // runs OUTSIDE the workflow; each ExperienceAiNormalizationError code must
  // map to a structure/reference action code, NOT fall through to UNKNOWN.
  // Each test throws the REAL ExperienceAiNormalizationError class so a code is
  // exercised through the genuine instanceof branch.
  // ---------------------------------------------------------------------------

  it("U1: UNKNOWN_VIDEO_REF normalization error maps to UNRESOLVED_REFERENCE (not UNKNOWN)", async () => {
    normalizeMock.mockImplementationOnce(() => {
      throw new ExperienceAiNormalizationError(
        "UNKNOWN_VIDEO_REF",
        'Unknown video candidate "v99" in AI draft',
      )
    })

    const result = await runGenerateDraftAction(mockDeps(), {
      localeId: "locale-1",
      locale: "en",
      prompt: "hope",
    })

    expect(result).toEqual({
      ok: false,
      code: "UNRESOLVED_REFERENCE",
      error: USER_MESSAGES.UNRESOLVED_REFERENCE,
    })
  })

  it("U1: UNKNOWN_SECTION_REF normalization error maps to UNRESOLVED_REFERENCE", async () => {
    normalizeMock.mockImplementationOnce(() => {
      throw new ExperienceAiNormalizationError(
        "UNKNOWN_SECTION_REF",
        'Unknown section ref "s99" in AI draft',
      )
    })

    const result = await runGenerateDraftAction(mockDeps(), {
      localeId: "locale-1",
      locale: "en",
      prompt: "hope",
    })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("unreachable")
    expect(result.code).toBe("UNRESOLVED_REFERENCE")
  })

  it("U1: DUPLICATE_SECTION_REF normalization error maps to UNRESOLVED_REFERENCE", async () => {
    normalizeMock.mockImplementationOnce(() => {
      throw new ExperienceAiNormalizationError(
        "DUPLICATE_SECTION_REF",
        "Duplicate section ref in AI draft",
      )
    })

    const result = await runGenerateDraftAction(mockDeps(), {
      localeId: "locale-1",
      locale: "en",
      prompt: "hope",
    })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("unreachable")
    expect(result.code).toBe("UNRESOLVED_REFERENCE")
  })

  it("U1: INVALID_BLOCKS normalization error maps to SCHEMA_MISMATCH (not UNKNOWN) when repair cannot converge", async () => {
    // INVALID_BLOCKS is repair-eligible (schema_violation), so the action
    // re-prompts. Throw it on EVERY attempt + have repair return a
    // (still-failing) draft so the loop exhausts and the terminal typed
    // error classifies to SCHEMA_MISMATCH — never UNKNOWN.
    normalizeMock.mockImplementation(() => {
      throw new ExperienceAiNormalizationError(
        "INVALID_BLOCKS",
        "AI draft did not normalize into a valid admin BlocksSchema payload",
      )
    })
    repairDraftMock.mockResolvedValue(VALID_DRAFT)

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

  it("U1: BELOW_MIN_BLOCKS normalization error maps to SCHEMA_MISMATCH (not UNKNOWN) when repair cannot converge", async () => {
    normalizeMock.mockImplementation(() => {
      throw new ExperienceAiNormalizationError(
        "BELOW_MIN_BLOCKS",
        "AI draft normalized into 1 block(s); generation requires at least 2",
      )
    })
    repairDraftMock.mockResolvedValue(VALID_DRAFT)

    const result = await runGenerateDraftAction(mockDeps(), {
      localeId: "locale-1",
      locale: "en",
      prompt: "hope",
    })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("unreachable")
    expect(result.code).toBe("SCHEMA_MISMATCH")
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

  // ---------------------------------------------------------------------------
  // U5 — validate→repair-with-error-feedback boundary loop (fail-closed).
  // The action wraps the NORMALIZE→BlocksSchema boundary in a bounded loop:
  // on a schema_violation it re-prompts the repair agent; on
  // structurally_impossible OR exhausted attempts it fails closed and NEVER
  // persists. `repairDraft` is mocked so call-count + the fail-then-pass
  // path are assertable; classifyRepairability + RepairDraftError stay REAL.
  // ---------------------------------------------------------------------------

  // A second valid draft distinct from VALID_DRAFT so "the final draft is the
  // REPAIRED one" is an observable, load-bearing assertion.
  const REPAIRED_DRAFT = {
    title: "Hope, repaired",
    metaDescription: "A corrected reflection.",
    blocks: VALID_DRAFT.blocks,
  }
  const REPAIRED_NORMALIZED = {
    title: REPAIRED_DRAFT.title,
    metaDescription: REPAIRED_DRAFT.metaDescription,
    blocks: REPAIRED_DRAFT.blocks,
  }

  it("U5 (clean): normalize succeeds first try → persists once, repair agent NOT called", async () => {
    const deps = mockDeps()
    const result = await runGenerateDraftAction(deps, {
      localeId: "locale-1",
      locale: "en",
      prompt: "hope",
      threadId: "thread-abc",
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("unreachable")
    expect(normalizeMock).toHaveBeenCalledTimes(1)
    expect(repairDraftMock).not.toHaveBeenCalled()
    expect(deps.writeSpies.chatMessageCreate).toHaveBeenCalledTimes(1)
  })

  it("U5 (repaired): INVALID_BLOCKS then repaired draft normalizes clean → persists once; repair agent called; final draft is the repaired one", async () => {
    // First normalize throws (REAL typed error). repairDraft returns a NEW
    // draft. Second normalize succeeds against THAT repaired draft.
    normalizeMock
      .mockImplementationOnce(() => {
        throw new ExperienceAiNormalizationError(
          "INVALID_BLOCKS",
          "AI draft did not normalize into a valid admin BlocksSchema payload",
        )
      })
      .mockImplementationOnce(() => REPAIRED_NORMALIZED)
    repairDraftMock.mockResolvedValueOnce(REPAIRED_DRAFT)

    const deps = mockDeps()
    const result = await runGenerateDraftAction(deps, {
      localeId: "locale-1",
      locale: "en",
      prompt: "hope",
      threadId: "thread-abc",
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("unreachable")
    // The repair agent WAS called exactly once with the offending draft.
    expect(repairDraftMock).toHaveBeenCalledTimes(1)
    expect(repairDraftMock.mock.calls[0][0]).toMatchObject({
      draft: VALID_DRAFT,
      error: expect.objectContaining({ code: "INVALID_BLOCKS" }),
    })
    // The SECOND normalize ran against the repaired draft.
    expect(normalizeMock).toHaveBeenCalledTimes(2)
    expect(normalizeMock.mock.calls[1][0]).toBe(REPAIRED_DRAFT)
    // The returned draft is the REPAIRED one — proving the loop swapped it in.
    expect(result.draft.title).toBe(REPAIRED_DRAFT.title)
    expect(BlocksSchema.safeParse(result.draft.blocks).success).toBe(true)
    // Persisted exactly once.
    expect(deps.writeSpies.chatMessageCreate).toHaveBeenCalledTimes(1)
  })

  it("U5 (structurally_impossible): UNKNOWN_VIDEO_REF → loop does NOT call repair; fails closed UNRESOLVED_REFERENCE; ZERO persistence", async () => {
    normalizeMock.mockImplementationOnce(() => {
      throw new ExperienceAiNormalizationError(
        "UNKNOWN_VIDEO_REF",
        'Unknown video candidate "v99" in AI draft',
      )
    })

    const deps = mockDeps()
    const result = await runGenerateDraftAction(deps, {
      localeId: "locale-1",
      locale: "en",
      prompt: "hope",
      threadId: "thread-abc",
    })

    expect(result).toEqual({
      ok: false,
      code: "UNRESOLVED_REFERENCE",
      error: USER_MESSAGES.UNRESOLVED_REFERENCE,
    })
    // structurally_impossible NEVER enters the loop.
    expect(repairDraftMock).not.toHaveBeenCalled()
    expect(normalizeMock).toHaveBeenCalledTimes(1)
    // Fail-closed: nothing persisted.
    expect(deps.writeSpies.chatMessageCreate).not.toHaveBeenCalled()
    expect(deps.writeSpies.experienceLocaleUpdate).not.toHaveBeenCalled()
    expect(deps.writeSpies.contentRevisionCreate).not.toHaveBeenCalled()
  })

  it("U5 (exhausted): INVALID_BLOCKS through maxAttempts → ZERO persistence; fails closed SCHEMA_MISMATCH; repair agent called exactly maxAttempts times", async () => {
    // Default cap is 2 (env absent → DEFAULT_MAX_REPAIR_ATTEMPTS). Every
    // normalize throws INVALID_BLOCKS; every repair returns a (still-failing)
    // draft. The loop must stop after maxAttempts repair calls and fail
    // closed without persisting.
    const MAX = 2
    normalizeMock.mockImplementation(() => {
      throw new ExperienceAiNormalizationError(
        "INVALID_BLOCKS",
        "still invalid",
      )
    })
    repairDraftMock.mockResolvedValue(REPAIRED_DRAFT)

    const deps = mockDeps()
    const result = await runGenerateDraftAction(deps, {
      localeId: "locale-1",
      locale: "en",
      prompt: "hope",
      threadId: "thread-abc",
    })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("unreachable")
    expect(result.code).toBe("SCHEMA_MISMATCH")
    // initial normalize + MAX repaired-then-re-normalize attempts.
    expect(repairDraftMock).toHaveBeenCalledTimes(MAX)
    expect(normalizeMock).toHaveBeenCalledTimes(MAX + 1)
    // Fail-closed: nothing persisted.
    expect(deps.writeSpies.chatMessageCreate).not.toHaveBeenCalled()
    expect(deps.writeSpies.experienceLocaleUpdate).not.toHaveBeenCalled()
    expect(deps.writeSpies.contentRevisionCreate).not.toHaveBeenCalled()
  })

  it("U5 (repair output unusable): repairDraft throws RepairDraftError(schema_violation) → fails closed SCHEMA_MISMATCH, no persistence", async () => {
    normalizeMock.mockImplementationOnce(() => {
      throw new ExperienceAiNormalizationError("INVALID_BLOCKS", "boom")
    })
    repairDraftMock.mockRejectedValueOnce(
      new RepairDraftError(
        "schema_violation",
        "repair agent output did not satisfy DraftExperienceSchema",
      ),
    )

    const deps = mockDeps()
    const result = await runGenerateDraftAction(deps, {
      localeId: "locale-1",
      locale: "en",
      prompt: "hope",
      threadId: "thread-abc",
    })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("unreachable")
    expect(result.code).toBe("SCHEMA_MISMATCH")
    expect(repairDraftMock).toHaveBeenCalledTimes(1)
    expect(deps.writeSpies.chatMessageCreate).not.toHaveBeenCalled()
  })
})

describe("runGenerateDraftAction (U6 — remote draft cutover)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    primeHappyPath()
  })

  // Helpers keep the launch-mock argument a single short call so prettier
  // never breaks the `vi.fn().mockResolvedValue(...)` chain.
  const remoteOk = () => ({ ok: true as const, draft: VALID_DRAFT })
  const remoteFail = (reason: string, retryable: boolean) => ({
    ok: false as const,
    reason,
    retryable,
  })

  it("remote ok → returns the draft via the standalone route, NOT the in-process workflow", async () => {
    const launch = vi.fn(async (_input: unknown) => remoteOk())
    const deps = mockDeps()
    const result = await runGenerateDraftAction(
      deps,
      { localeId: "locale-1", locale: "en", prompt: "hope" },
      { remoteEnabled: true, launchRemoteDraft: launch as never },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("unreachable")
    expect(result.draft.title).toBe(VALID_DRAFT.title)
    // The in-process workflow was never created.
    expect(getWorkflowByIdMock).not.toHaveBeenCalled()
    // The remote client got the admin-computed candidates keyed on videoId.
    expect(launch).toHaveBeenCalledTimes(1)
    const body = launch.mock.calls[0][0]
    expect(body).toMatchObject({
      prompt: expect.stringContaining("hope"),
      locale: "en",
      candidates: [{ videoId: "v1", title: "Hope Story", slug: "hope" }],
      mode: "multi",
    })
  })

  it('remote ok with mode "quick" forwards mode:"quick"', async () => {
    const launch = vi.fn(async (_input: unknown) => remoteOk())
    await runGenerateDraftAction(
      mockDeps(),
      { localeId: "locale-1", locale: "en", prompt: "hope", mode: "quick" },
      { remoteEnabled: true, launchRemoteDraft: launch as never },
    )
    expect(launch.mock.calls[0][0]).toMatchObject({ mode: "quick" })
  })

  it("remote ok persists a rateable ASSISTANT message with producedBy when threadId supplied", async () => {
    const launch = vi.fn(async (_input: unknown) => remoteOk())
    const deps = mockDeps()
    const result = await runGenerateDraftAction(
      deps,
      {
        localeId: "locale-1",
        locale: "en",
        prompt: "hope",
        threadId: "thread-abc",
      },
      { remoteEnabled: true, launchRemoteDraft: launch as never },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("unreachable")
    expect(result.messageId).toBe("msg-persisted-1")
    expect(result.producedBy).toBe("multi-step-draft")
    expect(deps.writeSpies.chatMessageCreate).toHaveBeenCalledTimes(1)
  })

  it('remote { reason:"timeout" } → UPSTREAM_ERROR, single call (no retry storm), no persistence', async () => {
    const launch = vi.fn(async (_input: unknown) => remoteFail("timeout", true))
    const deps = mockDeps()
    const result = await runGenerateDraftAction(
      deps,
      {
        localeId: "locale-1",
        locale: "en",
        prompt: "hope",
        threadId: "thread-abc",
      },
      { remoteEnabled: true, launchRemoteDraft: launch as never },
    )
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("unreachable")
    expect(result.code).toBe("UPSTREAM_ERROR")
    expect(launch).toHaveBeenCalledTimes(1)
    expect(getWorkflowByIdMock).not.toHaveBeenCalled()
    expect(deps.writeSpies.chatMessageCreate).not.toHaveBeenCalled()
  })

  it('remote { reason:"config_missing" } → falls back to the in-process workflow', async () => {
    const launch = vi.fn(async (_input: unknown) =>
      remoteFail("config_missing", false),
    )
    const deps = mockDeps()
    const result = await runGenerateDraftAction(
      deps,
      { localeId: "locale-1", locale: "en", prompt: "hope" },
      { remoteEnabled: true, launchRemoteDraft: launch as never },
    )
    expect(result.ok).toBe(true)
    // Fell back: the in-process workflow WAS created.
    expect(getWorkflowByIdMock).toHaveBeenCalled()
  })

  it('remote { reason:"generation_failed", retryable:false } → SCHEMA_MISMATCH', async () => {
    const launch = vi.fn(async (_input: unknown) =>
      remoteFail("generation_failed", false),
    )
    const result = await runGenerateDraftAction(
      mockDeps(),
      { localeId: "locale-1", locale: "en", prompt: "hope" },
      { remoteEnabled: true, launchRemoteDraft: launch as never },
    )
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("unreachable")
    expect(result.code).toBe("SCHEMA_MISMATCH")
  })

  it('remote { reason:"auth_failed" } → NOT_CONFIGURED', async () => {
    const launch = vi.fn(async (_input: unknown) =>
      remoteFail("auth_failed", false),
    )
    const result = await runGenerateDraftAction(
      mockDeps(),
      { localeId: "locale-1", locale: "en", prompt: "hope" },
      { remoteEnabled: true, launchRemoteDraft: launch as never },
    )
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("unreachable")
    expect(result.code).toBe("NOT_CONFIGURED")
  })

  it("flag off → uses the in-process workflow and NEVER calls the remote client", async () => {
    const launch = vi.fn()
    const deps = mockDeps()
    const result = await runGenerateDraftAction(
      deps,
      { localeId: "locale-1", locale: "en", prompt: "hope" },
      { remoteEnabled: false, launchRemoteDraft: launch as never },
    )
    expect(result.ok).toBe(true)
    expect(launch).not.toHaveBeenCalled()
    expect(getWorkflowByIdMock).toHaveBeenCalled()
  })
})
