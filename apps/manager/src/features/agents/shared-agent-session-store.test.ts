import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type {
  SharedAgentPendingApproval,
  SharedAgentRunRequest,
  SharedAgentRunResponse,
  SharedAgentSession,
} from "./shared-agent-contract"

const ORIGINAL_CWD = process.cwd()

function buildSession(
  overrides: Partial<SharedAgentSession> = {},
): SharedAgentSession {
  return {
    id: "session-1",
    agent: {
      id: "translation",
      name: "Translation Agent",
      summary: "Translate and adapt content.",
      category: "localization",
      starterPrompt: "Translate this content.",
      description: "Translation helper.",
      fields: [],
      capabilities: {
        supportsSessions: true,
        supportsWriteback: true,
        supportsVideoContext: true,
      },
    },
    owner: {
      actorId: "manager:1",
      kind: "session",
      label: "manager@forge.test",
    },
    video: {
      documentId: "video-1",
      coreId: "core-1",
      title: "Source title",
      slug: "source-title",
      description: "Source description",
      primaryLanguage: "English",
    },
    workflowId: "translateVideoMetadataWorkflow",
    createdAt: "2026-04-23T10:00:00.000Z",
    updatedAt: "2026-04-23T10:00:00.000Z",
    latestDraft: null,
    latestRun: null,
    savedRecommendationSummary: null,
    messages: [],
    ...overrides,
  }
}

function buildDraft(
  overrides: Partial<SharedAgentRunRequest> = {},
): SharedAgentRunRequest {
  return {
    goal: "Translate this metadata into Spanish.",
    supportingContext: undefined,
    fields: {
      source_text: "Hello world",
      target_language: "Spanish",
    },
    ...overrides,
  }
}

function buildPendingApproval(
  overrides: Partial<SharedAgentPendingApproval> = {},
): SharedAgentPendingApproval {
  return {
    id: "approval-1",
    sessionId: "session-1",
    runId: "run-1",
    traceId: "trace-1",
    agentId: "translation",
    owner: buildSession().owner,
    actionType: "apply_video_metadata_patch",
    target: {
      videoDocumentId: "video-1",
      videoCoreId: "core-1",
    },
    patchSummary: "Apply translated metadata",
    actor: null,
    status: "pending",
    createdAt: "2026-04-23T10:01:00.000Z",
    resolvedAt: null,
    draftPatch: {
      title: "Hola mundo",
      description: "Descripcion",
      targetLanguage: "Spanish",
    },
    ...overrides,
  }
}

function buildRun(
  overrides: Partial<SharedAgentRunResponse> = {},
): SharedAgentRunResponse {
  const pendingApproval = buildPendingApproval()

  return {
    sessionId: "session-1",
    agent: buildSession().agent,
    output: "Translated metadata ready for approval.",
    result: {
      summary: "Spanish metadata draft ready.",
      markdown: "## Translation\n\nReady for approval.",
      confidence: "high",
      recommendations: [
        {
          label: "Use Spanish title",
          rationale: "Matches the target audience.",
          appliesTo: ["title"],
        },
      ],
      draftPatch: pendingApproval.draftPatch ?? undefined,
      followupActions: ["Review localized tone"],
    },
    draftPatch: pendingApproval.draftPatch,
    pendingApproval,
    toolEvents: [
      {
        id: "tool-1",
        name: "readVideoContext",
        status: "completed",
        summary: "Loaded video metadata.",
        createdAt: "2026-04-23T10:01:00.000Z",
      },
    ],
    usage: {
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
    },
    generatedAt: "2026-04-23T10:01:00.000Z",
    traceId: "trace-1",
    runId: "run-1",
    workflowId: "translateVideoMetadataWorkflow",
    ...overrides,
  }
}

describe("shared-agent-session-store", () => {
  let tempRoot = ""

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), "forge-shared-agent-store-"))
    process.chdir(tempRoot)
  })

  afterEach(() => {
    process.chdir(ORIGINAL_CWD)
    rmSync(tempRoot, { recursive: true, force: true })
    vi.resetModules()
  })

  it("persists sessions across module reloads", async () => {
    const firstLoad = await import("./shared-agent-session-store")
    firstLoad.resetSharedAgentSessionStore()

    const session = buildSession()
    firstLoad.saveSharedAgentSession(session)

    expect(
      existsSync(
        join(
          tempRoot,
          ".tmp",
          "shared-agent-sessions",
          "sessions",
          "session-1.json",
        ),
      ),
    ).toBe(true)

    vi.resetModules()

    const secondLoad = await import("./shared-agent-session-store")
    expect(secondLoad.getSharedAgentSession("session-1")).toEqual(session)
  })

  it("persists appended messages, latest runs, and pending approvals", async () => {
    const store = await import("./shared-agent-session-store")
    store.resetSharedAgentSessionStore()

    store.saveSharedAgentSession(buildSession())
    store.appendSharedAgentSessionMessage({
      sessionId: "session-1",
      message: {
        id: "message-1",
        role: "user",
        content: "Please translate this for Spanish search.",
        createdAt: "2026-04-23T10:00:30.000Z",
      },
    })

    const run = buildRun()
    const latestDraft = buildDraft()

    store.recordSharedAgentSessionRun({
      sessionId: "session-1",
      run,
      latestDraft,
    })
    store.saveSharedAgentRecommendationSummary({
      sessionId: "session-1",
      summary: "Spanish metadata draft ready.",
      savedAt: "2026-04-23T10:01:30.000Z",
    })

    vi.resetModules()

    const reloadedStore = await import("./shared-agent-session-store")
    const reloadedSession = reloadedStore.getSharedAgentSession("session-1")

    expect(reloadedSession).toMatchObject({
      id: "session-1",
      latestDraft: {
        goal: latestDraft.goal,
        fields: latestDraft.fields,
      },
      latestRun: {
        runId: "run-1",
        pendingApproval: {
          id: "approval-1",
          status: "pending",
        },
      },
      savedRecommendationSummary: "Spanish metadata draft ready.",
      messages: [
        {
          id: "message-1",
          role: "user",
          content: "Please translate this for Spanish search.",
        },
      ],
    })
    expect(reloadedStore.getSharedAgentPendingApproval("approval-1")).toEqual(
      buildPendingApproval(),
    )
  })

  it("rejects approval replay after resolution", async () => {
    const store = await import("./shared-agent-session-store")
    store.resetSharedAgentSessionStore()

    store.saveSharedAgentSession(buildSession())
    store.recordSharedAgentSessionRun({
      sessionId: "session-1",
      run: buildRun(),
      latestDraft: buildDraft(),
    })

    const resolved = store.resolveSharedAgentPendingApproval({
      approvalId: "approval-1",
      status: "approved",
      actor: "manager@forge.test",
      resolvedAt: "2026-04-23T10:02:00.000Z",
    })

    expect(resolved).toMatchObject({
      approval: {
        id: "approval-1",
        status: "approved",
        actor: "manager@forge.test",
      },
      session: {
        id: "session-1",
        latestRun: {
          pendingApproval: {
            id: "approval-1",
            status: "approved",
          },
        },
      },
    })

    expect(store.getSharedAgentPendingApproval("approval-1")).toBeNull()
    expect(
      store.resolveSharedAgentPendingApproval({
        approvalId: "approval-1",
        status: "declined",
        actor: "manager@forge.test",
        resolvedAt: "2026-04-23T10:03:00.000Z",
      }),
    ).toBeNull()
  })
})
