import { describe, expect, it, vi } from "vitest"

import { dispatchDueSupportActions } from "./linear-dispatcher"
import type { SupportResearchRepository } from "./repository"

const action = {
  idempotencyKey: "support-research:needs-validation:key",
  attempts: 1,
  draft: {
    idempotencyKey: "support-research:needs-validation:key",
    fingerprint: "a".repeat(64),
    type: "needs_validation" as const,
    title: "[Needs validation] Playback control fails",
    description:
      "Generated\n<!-- support-research-key:support-research:needs-validation:key -->",
    sourceIds: ["10"],
  },
}

function repository(overrides: Record<string, unknown> = {}) {
  return {
    claimDueActions: vi
      .fn()
      .mockResolvedValueOnce([action])
      .mockResolvedValue([]),
    countDueActions: vi.fn().mockResolvedValue(0),
    markActionCreated: vi.fn().mockResolvedValue(undefined),
    markActionDeduplicated: vi.fn().mockResolvedValue(undefined),
    markActionMutationAttempted: vi.fn().mockResolvedValue(undefined),
    markActionRetryable: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as SupportResearchRepository
}

describe("dispatchDueSupportActions", () => {
  it("records an existing marker match without creating a duplicate", async () => {
    const repo = repository()
    const createIssue = vi.fn()

    const summary = await dispatchDueSupportActions({
      repository: repo,
      client: {
        findIssueByMarker: vi.fn().mockResolvedValue({
          ok: true,
          value: {
            id: "issue-id",
            url: "https://linear.app/team/issue/FGE-1",
          },
        }),
        createIssue,
      },
      config: { maxActionsPerRun: 5 },
      actionTypes: ["needs_validation"],
      createdSince: new Date("2026-08-01T00:00:00Z"),
      now: new Date("2026-08-01T10:00:00Z"),
      token: "dispatcher-one",
    })

    expect(summary).toMatchObject({ created: 0, deduplicated: 1, failed: 0 })
    expect(createIssue).not.toHaveBeenCalled()
    expect(repo.markActionDeduplicated).toHaveBeenCalledOnce()
  })

  it("keeps an ambiguous create failure retryable for marker reconciliation", async () => {
    const repo = repository()
    const heartbeat = vi.fn().mockResolvedValue(undefined)

    const summary = await dispatchDueSupportActions({
      repository: repo,
      client: {
        findIssueByMarker: vi
          .fn()
          .mockResolvedValue({ ok: true, value: undefined }),
        createIssue: vi.fn().mockResolvedValue({
          ok: false,
          reason: "timeout",
          retryable: true,
          ambiguous: true,
        }),
      },
      config: { maxActionsPerRun: 5 },
      actionTypes: ["needs_validation"],
      createdSince: new Date("2026-08-01T00:00:00Z"),
      now: new Date("2026-08-01T10:00:00Z"),
      token: "dispatcher-one",
      clock: () => new Date("2026-08-01T10:00:00Z"),
      heartbeat,
    })

    expect(summary.failed).toBe(1)
    expect(repo.markActionRetryable).toHaveBeenCalledWith(
      expect.objectContaining({ terminal: false, errorCode: "timeout" }),
    )
    expect(repo.markActionMutationAttempted).toHaveBeenCalledOnce()
    expect(heartbeat).toHaveBeenCalledOnce()
    expect(repo.claimDueActions).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        dailyLimit: 5,
        claimLimit: 1,
        expiresAt: new Date("2026-08-01T10:20:00Z"),
      }),
    )
  })

  it("terminates an action after its fifth failed attempt", async () => {
    const repo = repository({
      claimDueActions: vi
        .fn()
        .mockResolvedValueOnce([{ ...action, attempts: 5 }])
        .mockResolvedValue([]),
    })

    await dispatchDueSupportActions({
      repository: repo,
      client: {
        findIssueByMarker: vi.fn().mockResolvedValue({
          ok: false,
          reason: "rate_limited",
          retryable: true,
          ambiguous: false,
        }),
        createIssue: vi.fn(),
      },
      config: { maxActionsPerRun: 5 },
      actionTypes: ["needs_validation"],
      createdSince: new Date("2026-08-01T00:00:00Z"),
      now: new Date("2026-08-01T10:00:00Z"),
      token: "dispatcher-one",
    })

    expect(repo.markActionRetryable).toHaveBeenCalledWith(
      expect.objectContaining({ terminal: true }),
    )
  })
})
