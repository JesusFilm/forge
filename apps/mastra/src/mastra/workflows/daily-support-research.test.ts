import { describe, expect, it, vi } from "vitest"

import type { SupportResearchConfig } from "../../config/env"
import type {
  DueSupportAction,
  RunClaim,
  SupportResearchRepository,
} from "../../services/support-research/repository"
import type {
  StoredSupportObservation,
  SupportActionDraft,
  SupportRunReport,
} from "../../services/support-research/schema"
import {
  dailySupportResearchWorkflow,
  executeDailySupportResearch,
  getSupportResearchReadiness,
} from "./daily-support-research"

const now = new Date("2026-08-02T05:00:00.000Z")

const config: SupportResearchConfig = {
  enabled: true,
  providerApproved: true,
  model: "openai/gpt-5.4-mini",
  databaseUrl: "postgresql://local",
  allowedWatchHosts: ["www.jesusfilm.org"],
  maxConversations: 200,
  maxThreadsPerConversation: 20,
  maxSanitizedCharacters: 12_000,
  maxActionsPerRun: 5,
  maxConsecutiveAnalysisFailures: 5,
  timeoutMs: 5_000,
  maxResponseBytes: 100_000,
  retentionDays: 90,
  confirmedConfidence: 0.85,
  inferredConfidence: 0.85,
  improvementActionability: 0.8,
  improvementDistinctSources: 3,
  improvementWindowDays: 30,
  helpScout: {
    clientId: "help-id",
    clientSecret: "help-secret",
    mailboxIds: ["9"],
    apiUrl: "https://api.helpscout.net/v2",
    authUrl: "https://api.helpscout.net/v2/oauth2/token",
  },
  linear: {
    apiKey: "linear-key",
    apiUrl: "https://api.linear.app/graphql",
    teamId: "team-id",
    projectId: "project-id",
    confirmedBugLabelId: "bug-label",
    needsValidationLabelId: "validate-label",
    uxLabelId: "ux-label",
  },
}

class MemoryRepository implements SupportResearchRepository {
  readonly observations: StoredSupportObservation[] = []
  readonly actions: SupportActionDraft[] = []
  readonly reports: SupportRunReport[] = []
  readonly progress: Date[] = []
  readonly claimedActions = new Set<string>()
  purgeCalls = 0
  renewals = 0
  cursor = new Date("2026-08-01T05:00:00.000Z")

  async getCursor(): Promise<Date> {
    return this.cursor
  }

  async claimRun(input: { cutoff: Date }): Promise<RunClaim> {
    return { claimed: true, cursorStart: this.cursor, cutoff: input.cutoff }
  }

  async recordObservation(
    observation: StoredSupportObservation,
  ): Promise<boolean> {
    if (
      this.observations.some(
        (item) => item.source.sourceId === observation.source.sourceId,
      )
    ) {
      return false
    }
    this.observations.push(observation)
    return true
  }

  async getObservation(
    sourceId: string,
  ): Promise<StoredSupportObservation | undefined> {
    return this.observations.find((item) => item.source.sourceId === sourceId)
  }

  async updateProgress(input: { cursor: Date }): Promise<void> {
    this.progress.push(input.cursor)
  }

  async renewRunLease(): Promise<void> {
    this.renewals += 1
  }

  async listThemeObservations(input: {
    surface: string
    themeKey: string
    feedbackKinds: Array<"usability" | "need">
  }): Promise<StoredSupportObservation[]> {
    return this.observations.filter(
      (item) =>
        item.analysis.surface === input.surface &&
        item.analysis.themeKey === input.themeKey &&
        input.feedbackKinds.includes(
          item.analysis.kind as "usability" | "need",
        ),
    )
  }

  async enqueueAction(
    draft: SupportActionDraft,
    dryRun: boolean,
  ): Promise<boolean> {
    if (
      this.actions.some((item) => item.idempotencyKey === draft.idempotencyKey)
    ) {
      return false
    }
    this.actions.push(draft)
    if (dryRun) return true
    return true
  }

  async claimDueActions(input: {
    dailyLimit: number
    claimLimit: number
    actionTypes: SupportActionDraft["type"][]
  }): Promise<DueSupportAction[]> {
    const due = this.actions
      .filter(
        (draft) =>
          input.actionTypes.includes(draft.type) &&
          !this.claimedActions.has(draft.idempotencyKey),
      )
      .slice(0, input.claimLimit)
    for (const draft of due) this.claimedActions.add(draft.idempotencyKey)
    return due.map((draft) => ({
      idempotencyKey: draft.idempotencyKey,
      draft,
      attempts: 1,
    }))
  }

  async countDueActions(input: {
    actionTypes: SupportActionDraft["type"][]
  }): Promise<number> {
    return this.actions.filter(
      (draft) =>
        input.actionTypes.includes(draft.type) &&
        !this.claimedActions.has(draft.idempotencyKey),
    ).length
  }

  async markActionCreated(): Promise<void> {}
  async markActionDeduplicated(): Promise<void> {}
  async markActionMutationAttempted(): Promise<void> {}
  async markActionRetryable(): Promise<void> {}

  async finalizeRun(report: SupportRunReport): Promise<void> {
    this.reports.push(report)
    if (!report.dryRun) this.cursor = new Date(report.cursorEnd)
  }

  async purgeExpired(): Promise<number> {
    this.purgeCalls += 1
    return 0
  }
}

function helpScoutWith(count = 1) {
  return {
    listNewConversations: vi.fn().mockResolvedValue({
      ok: true,
      value: {
        capped: false,
        pages: 1,
        conversations: Array.from({ length: count }, (_, index) => ({
          id: String(index + 1),
          mailboxId: "9",
          createdAt: new Date(Date.UTC(2026, 7, 1, 6 + index)).toISOString(),
          subject: "Playback control does not respond",
          sourceUrl: `https://secure.helpscout.net/conversation/${index + 1}`,
        })),
      },
    }),
    listThreads: vi.fn().mockImplementation(async (id: string) => ({
      ok: true,
      value: {
        capped: false,
        pages: 1,
        threads: [
          {
            id: `thread-${id}`,
            body: "The playback control does not respond on https://www.jesusfilm.org/watch/jesus.html",
          },
        ],
      },
    })),
  }
}

const analysisObject = {
  relevant: true,
  kind: "bug",
  surface: "playback",
  title: "Playback control does not respond",
  summary: "A user reports an unresponsive playback control.",
  reportedEvidence: ["The playback control does not respond."],
  expectedBehavior: "Playback starts.",
  actualBehavior: "Nothing happens.",
  themeKey: "playback-control-unresponsive",
  confidence: 0.9,
  actionability: 0.9,
  validationRecommended: true,
  validationTarget: "url_availability",
  inference: "The control requires interactive validation.",
}

describe("daily support research workflow", () => {
  it("runs once daily at 05:00 UTC and remains committed", () => {
    const schedules = (
      dailySupportResearchWorkflow as typeof dailySupportResearchWorkflow & {
        getScheduleConfigs: () => Array<{ cron: string; timezone?: string }>
      }
    ).getScheduleConfigs()

    expect(schedules).toEqual([{ cron: "0 5 * * *", timezone: "UTC" }])
    expect(dailySupportResearchWorkflow.committed).toBe(true)
  })

  it("records a disabled report without reading Help Scout or Linear", async () => {
    const repository = new MemoryRepository()
    const helpScout = helpScoutWith()
    const linear = {
      findIssueByMarker: vi.fn(),
      createIssue: vi.fn(),
    }

    const report = await executeDailySupportResearch(
      { dryRun: false },
      {
        config: { ...config, enabled: false },
        repository,
        helpScout,
        linear,
        analyzer: { generate: vi.fn() },
        now: () => now,
        randomId: () => "fixed-id",
      },
    )

    expect(report.status).toBe("disabled")
    expect(report.errors).toContain("feature_disabled")
    expect(helpScout.listNewConversations).not.toHaveBeenCalled()
    expect(linear.createIssue).not.toHaveBeenCalled()
    expect(repository.reports).toHaveLength(1)
    expect(repository.purgeCalls).toBe(1)
  })

  it("fails before repository or upstream access when migration 002 is unavailable", async () => {
    const repository = new MemoryRepository()
    repository.getCursor = vi.fn(repository.getCursor.bind(repository))
    const helpScout = helpScoutWith()
    const linear = {
      findIssueByMarker: vi.fn(),
      createIssue: vi.fn(),
    }

    const report = await executeDailySupportResearch(
      { dryRun: false },
      {
        config,
        repository,
        helpScout,
        linear,
        analyzer: { generate: vi.fn() },
        databaseReadiness: vi.fn().mockResolvedValue({
          ready: false,
          reason: "support research database schema is unavailable",
        }),
        now: () => now,
        randomId: () => "fixed-id",
      },
    )

    expect(report).toMatchObject({
      status: "failed",
      errors: ["database_migration_unavailable"],
    })
    expect(repository.getCursor).not.toHaveBeenCalled()
    expect(repository.reports).toHaveLength(0)
    expect(helpScout.listNewConversations).not.toHaveBeenCalled()
    expect(linear.findIssueByMarker).not.toHaveBeenCalled()
    expect(linear.createIssue).not.toHaveBeenCalled()
  })

  it("dry-runs analysis and proposed actions with zero Linear mutations", async () => {
    const repository = new MemoryRepository()
    const liveCursor = repository.cursor.toISOString()
    const linear = {
      findIssueByMarker: vi.fn(),
      createIssue: vi.fn(),
    }

    const report = await executeDailySupportResearch(
      { dryRun: true, idempotencyKey: "operator-check" },
      {
        config: { ...config, linear: { ...config.linear, apiKey: undefined } },
        repository,
        helpScout: helpScoutWith(),
        linear,
        analyzer: {
          generate: vi.fn().mockResolvedValue({ object: analysisObject }),
        },
        validate: vi.fn().mockResolvedValue({
          state: "unverified",
          evidence: ["HTTP 200 returned a bounded HTML response."],
          missingProof: "A GET request cannot prove the interaction.",
        }),
        now: () => now,
        randomId: () => "fixed-id",
      },
    )

    expect(report).toMatchObject({
      status: "complete",
      dryRun: true,
      counters: {
        fetched: 1,
        relevant: 1,
        actionsPlanned: 2,
        actionsCreated: 0,
      },
    })
    expect(report.cursorEnd).toBe(now.toISOString())
    expect(repository.actions.map((item) => item.type)).toEqual([
      "needs_validation",
      "daily_summary",
    ])
    expect(linear.createIssue).not.toHaveBeenCalled()
    expect(repository.cursor.toISOString()).toBe(liveCursor)
    expect(repository.renewals).toBeGreaterThan(0)
  })

  it("creates evidence-labeled product and daily summary issues in live mode", async () => {
    const repository = new MemoryRepository()
    const createIssue = vi.fn().mockImplementation(async (draft) => ({
      ok: true,
      value: {
        id: `linear-${draft.type}`,
        url: `https://linear.app/team/issue/${draft.type}`,
      },
    }))

    const report = await executeDailySupportResearch(
      { dryRun: false },
      {
        config,
        repository,
        helpScout: helpScoutWith(),
        linear: {
          findIssueByMarker: vi
            .fn()
            .mockResolvedValue({ ok: true, value: undefined }),
          createIssue,
        },
        analyzer: {
          generate: vi.fn().mockResolvedValue({ object: analysisObject }),
        },
        validate: vi.fn().mockResolvedValue({
          state: "confirmed",
          incomingUrl: "https://www.jesusfilm.org/watch/jesus.html",
          finalUrl: "https://www.jesusfilm.org/watch/jesus.html",
          status: 500,
          evidence: ["HTTP 500 was returned for the exact reported URL."],
        }),
        now: () => now,
        randomId: () => "fixed-id",
      },
    )

    expect(report.counters.actionsCreated).toBe(2)
    expect(createIssue.mock.calls.map((call) => call[0].type)).toEqual([
      "confirmed_bug",
      "daily_summary",
    ])
    expect(createIssue.mock.calls[0]?.[0].description).toContain(
      "HTTP 500 was returned",
    )
    expect(createIssue.mock.calls[1]?.[0].description).toContain(
      "https://linear.app/team/issue/confirmed_bug",
    )
    expect(repository.renewals).toBeGreaterThan(0)
  })

  it("surfaces a failed report that cannot be finalized", async () => {
    const repository = new MemoryRepository()
    repository.finalizeRun = vi
      .fn()
      .mockRejectedValue(new Error("private database error"))

    await expect(
      executeDailySupportResearch(
        { dryRun: false },
        {
          config: { ...config, enabled: false },
          repository,
          helpScout: helpScoutWith(),
          linear: { findIssueByMarker: vi.fn(), createIssue: vi.fn() },
          analyzer: { generate: vi.fn() },
          now: () => now,
          randomId: () => "fixed-id",
        },
      ),
    ).rejects.toThrow("failed report could not be finalized")
    expect(repository.purgeCalls).toBe(2)
  })

  it("stops before persisting a retryable analysis failure", async () => {
    const repository = new MemoryRepository()
    const report = await executeDailySupportResearch(
      { dryRun: true },
      {
        config,
        repository,
        helpScout: helpScoutWith(6),
        linear: { findIssueByMarker: vi.fn(), createIssue: vi.fn() },
        analyzer: {
          generate: vi.fn().mockRejectedValue(new Error("private model error")),
        },
        now: () => now,
        randomId: () => "fixed-id",
      },
    )

    expect(report.status).toBe("partial")
    expect(report.partialReason).toBe("analysis_agent_error")
    expect(report.counters.failures).toBe(1)
    expect(repository.observations).toHaveLength(0)
    expect(repository.progress).toHaveLength(0)
    expect(report.errors.join(" ")).not.toContain("private model error")
    expect(report.cursorEnd).not.toBe(now.toISOString())
  })

  it("requires provider approval and complete live routing", () => {
    expect(
      getSupportResearchReadiness(
        {
          ...config,
          providerApproved: false,
          allowedWatchHosts: [],
          linear: { ...config.linear, apiKey: undefined },
        },
        false,
      ),
    ).toMatchObject({
      ready: false,
      reasons: expect.arrayContaining([
        "model_provider_not_approved",
        "watch_hosts_missing",
        "linear_api_key_missing",
      ]),
    })
  })

  it("rejects private Watch targets and retention shorter than clustering", () => {
    expect(
      getSupportResearchReadiness(
        {
          ...config,
          allowedWatchHosts: ["127.0.0.1", "watch.internal"],
          retentionDays: 14,
        },
        true,
      ),
    ).toMatchObject({
      ready: false,
      reasons: expect.arrayContaining([
        "watch_hosts_invalid",
        "retention_window_too_short",
      ]),
    })
  })

  it("rejects mailbox fanout above the fixed safety bound", () => {
    expect(
      getSupportResearchReadiness(
        {
          ...config,
          helpScout: {
            ...config.helpScout,
            mailboxIds: Array.from({ length: 51 }, (_, index) => String(index)),
          },
        },
        true,
      ),
    ).toMatchObject({
      ready: false,
      reasons: ["help_scout_mailbox_limit_exceeded"],
    })
  })

  it("uses the durable observation when an overlap is reanalyzed differently", async () => {
    const repository = new MemoryRepository()
    const analyzer = {
      generate: vi
        .fn()
        .mockResolvedValueOnce({ object: analysisObject })
        .mockResolvedValueOnce({
          object: {
            ...analysisObject,
            title: "A conflicting second analysis",
            themeKey: "different-theme",
          },
        }),
    }
    const dependencies = {
      config,
      repository,
      helpScout: helpScoutWith(),
      linear: { findIssueByMarker: vi.fn(), createIssue: vi.fn() },
      analyzer,
      validate: vi.fn().mockResolvedValue({
        state: "unverified" as const,
        evidence: [],
        missingProof: "Interactive validation is still required.",
      }),
      now: () => now,
      randomId: () => "fixed-id",
    }

    await executeDailySupportResearch(
      { dryRun: true, idempotencyKey: "first" },
      dependencies,
    )
    const second = await executeDailySupportResearch(
      { dryRun: true, idempotencyKey: "second" },
      dependencies,
    )

    expect(second.counters.duplicates).toBe(1)
    expect(repository.observations).toHaveLength(1)
    expect(repository.actions).toHaveLength(2)
    expect(second.findings[0]?.title).toBe(analysisObject.title)
  })
})
