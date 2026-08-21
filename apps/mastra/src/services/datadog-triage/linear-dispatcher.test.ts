import { describe, expect, it, vi } from "vitest"

import type { TriageLinearFailure } from "./linear-client"
import {
  dispatchDueTriageActions,
  nextAttemptAt,
  shouldTerminate,
  utcDayStart,
  type TriageLinearActionClient,
} from "./linear-dispatcher"
import type { DatadogTriageRepository, DueTriageAction } from "./repository"
import { triageMarker } from "./ticket-draft"
import type { TriageActionDraft } from "./schema"

const DRAFT: TriageActionDraft = {
  idempotencyKey: "datadog-triage:issue:ISSUE-1:0",
  service: "forge-mobile",
  signalKind: "issue",
  signalId: "ISSUE-1",
  epoch: 0,
  title: "[Mobile] [P2] Player crashes on resume",
  description: `body\n${triageMarker("datadog-triage:issue:ISSUE-1:0")}`,
  labelId: "label-bug",
}

const NOW = new Date("2026-08-18T11:00:00.000Z")

type RepositoryStub = DatadogTriageRepository & {
  claims: DueTriageAction[][]
  calls: string[]
}

function repository(input: {
  claims?: DueTriageAction[][]
  dueAfter?: number
}): RepositoryStub {
  const claims = input.claims ?? []
  const calls: string[] = []
  const stub = {
    claims,
    calls,
    claimDueActions: vi.fn(async () => claims.shift() ?? []),
    countDueActions: vi.fn(async () => input.dueAfter ?? 0),
    markActionCreated: vi.fn(async () => {
      calls.push("created")
    }),
    markActionDeduplicated: vi.fn(async () => {
      calls.push("deduplicated")
    }),
    markActionMutationAttempted: vi.fn(async () => {
      calls.push("mutation_attempted")
    }),
    markActionRetryable: vi.fn(async () => {
      calls.push("retryable")
    }),
  } as unknown as RepositoryStub
  return stub
}

function client(overrides: Partial<TriageLinearActionClient> = {}) {
  return {
    findIssueByMarker: vi.fn(async () => ({
      ok: true as const,
      value: undefined,
    })),
    createIssue: vi.fn(async () => ({
      ok: true as const,
      value: {
        id: "issue-1",
        url: "https://linear.app/forge/issue/FGE-1",
      },
    })),
    ...overrides,
  } as unknown as TriageLinearActionClient
}

function action(attempts = 1): DueTriageAction {
  return { idempotencyKey: DRAFT.idempotencyKey, draft: DRAFT, attempts }
}

describe("backoff schedule", () => {
  it("doubles from five minutes and stops at twenty-four hours", () => {
    const minutes = [1, 2, 3, 4, 5, 6, 10].map(
      (attempts) =>
        (nextAttemptAt(NOW, attempts).getTime() - NOW.getTime()) / 60_000,
    )

    expect(minutes).toEqual([5, 10, 20, 40, 80, 160, 1440])
  })

  it("terminalizes on the fifth attempt", () => {
    const retryable: TriageLinearFailure = {
      ok: false,
      reason: "rate_limited",
      retryable: true,
      ambiguous: false,
    }

    expect(shouldTerminate(retryable, 4)).toBe(false)
    expect(shouldTerminate(retryable, 5)).toBe(true)
  })

  it("terminalizes a non-retryable, non-ambiguous failure immediately", () => {
    expect(
      shouldTerminate(
        {
          ok: false,
          reason: "auth_failed",
          retryable: false,
          ambiguous: false,
        },
        1,
      ),
    ).toBe(true)
  })

  it("keeps an ambiguous failure alive so the marker search can reconcile it", () => {
    expect(
      shouldTerminate(
        { ok: false, reason: "timeout", retryable: true, ambiguous: true },
        1,
      ),
    ).toBe(false)
  })

  it("derives the budget window from the UTC day, not local time", () => {
    expect(utcDayStart(new Date("2026-08-18T23:30:00.000Z"))).toEqual(
      new Date("2026-08-18T00:00:00.000Z"),
    )
  })
})

describe("dispatchDueTriageActions", () => {
  it("searches for the marker before creating, then creates", async () => {
    const repo = repository({ claims: [[action()]] })
    const linear = client()

    const summary = await dispatchDueTriageActions({
      repository: repo,
      client: linear,
      maxTicketsPerDay: 5,
      now: NOW,
      token: "claim-a",
      clock: () => NOW,
    })

    expect(linear.findIssueByMarker).toHaveBeenCalledWith(
      triageMarker(DRAFT.idempotencyKey),
    )
    expect(linear.createIssue).toHaveBeenCalledWith(DRAFT)
    expect(repo.calls).toEqual(["mutation_attempted", "created"])
    expect(summary).toMatchObject({
      created: 1,
      deduplicated: 0,
      failed: 0,
      issueUrls: ["https://linear.app/forge/issue/FGE-1"],
    })
  })

  it("Covers AE3: a marker hit marks the action deduplicated without creating", async () => {
    const repo = repository({ claims: [[action()]] })
    const linear = client({
      findIssueByMarker: vi.fn(async () => ({
        ok: true as const,
        value: {
          id: "issue-existing",
          url: "https://linear.app/forge/issue/FGE-9",
        },
      })),
    })

    const summary = await dispatchDueTriageActions({
      repository: repo,
      client: linear,
      maxTicketsPerDay: 5,
      now: NOW,
      token: "claim-a",
      clock: () => NOW,
    })

    expect(linear.createIssue).not.toHaveBeenCalled()
    expect(repo.calls).toEqual(["deduplicated"])
    expect(summary.deduplicated).toBe(1)
  })

  it("reconciles an ambiguous create on the retry instead of duplicating it", async () => {
    // First run: the create times out after Linear may already have accepted
    // it. Second run: the marker search finds that issue.
    const timedOut = client({
      createIssue: vi.fn(async () => ({
        ok: false as const,
        reason: "timeout" as const,
        retryable: true,
        ambiguous: true,
      })),
    })
    const firstRepo = repository({ claims: [[action()]] })
    await dispatchDueTriageActions({
      repository: firstRepo,
      client: timedOut,
      maxTicketsPerDay: 5,
      now: NOW,
      token: "claim-a",
      clock: () => NOW,
    })
    expect(firstRepo.calls).toEqual(["mutation_attempted", "retryable"])
    expect(
      vi.mocked(firstRepo.markActionRetryable).mock.calls[0]?.[0],
    ).toMatchObject({ terminal: false, errorCode: "timeout" })

    const secondRepo = repository({ claims: [[action(2)]] })
    const reconciling = client({
      findIssueByMarker: vi.fn(async () => ({
        ok: true as const,
        value: {
          id: "issue-created-but-unconfirmed",
          url: "https://linear.app/forge/issue/FGE-2",
        },
      })),
    })
    const summary = await dispatchDueTriageActions({
      repository: secondRepo,
      client: reconciling,
      maxTicketsPerDay: 5,
      now: NOW,
      token: "claim-b",
      clock: () => NOW,
    })

    expect(reconciling.createIssue).not.toHaveBeenCalled()
    expect(summary.deduplicated).toBe(1)
  })

  it("records a failed marker search without attempting a create", async () => {
    const repo = repository({ claims: [[action()]] })
    const linear = client({
      findIssueByMarker: vi.fn(async () => ({
        ok: false as const,
        reason: "rate_limited" as const,
        retryable: true,
        ambiguous: false,
      })),
    })

    const summary = await dispatchDueTriageActions({
      repository: repo,
      client: linear,
      maxTicketsPerDay: 5,
      now: NOW,
      token: "claim-a",
      clock: () => NOW,
    })

    expect(linear.createIssue).not.toHaveBeenCalled()
    expect(repo.calls).toEqual(["retryable"])
    expect(summary).toMatchObject({ failed: 1, errors: ["rate_limited"] })
  })

  it("Covers AE4: unclaimed actions stay queued and are reported as deferred", async () => {
    // The repository's budget CTE returns nothing once the day is spent; the
    // loop simply stops and the backlog is counted, never dropped.
    const repo = repository({ claims: [[]], dueAfter: 3 })

    const summary = await dispatchDueTriageActions({
      repository: repo,
      client: client(),
      maxTicketsPerDay: 5,
      now: NOW,
      token: "claim-a",
      clock: () => NOW,
    })

    expect(summary).toMatchObject({ created: 0, deferred: 3 })
  })

  it("stops claiming once the per-run ceiling is reached", async () => {
    const repo = repository({
      claims: [[action()], [action()], [action()], [action()]],
    })

    await dispatchDueTriageActions({
      repository: repo,
      client: client(),
      maxTicketsPerDay: 2,
      now: NOW,
      token: "claim-a",
      clock: () => NOW,
    })

    expect(repo.claimDueActions).toHaveBeenCalledTimes(2)
  })

  it("spends no claim at all when the daily budget is zero", async () => {
    // This is the runbook's dry-run posture: the flag is on, actions enqueue,
    // and nothing dispatches until an operator raises the budget.
    const repo = repository({ claims: [[action()]], dueAfter: 1 })

    const summary = await dispatchDueTriageActions({
      repository: repo,
      client: client(),
      maxTicketsPerDay: 0,
      now: NOW,
      token: "claim-a",
      clock: () => NOW,
    })

    expect(repo.claimDueActions).not.toHaveBeenCalled()
    expect(summary).toMatchObject({ created: 0, deferred: 1 })
  })

  it("renews the run lease between claims", async () => {
    const heartbeat = vi.fn(async () => undefined)
    const repo = repository({ claims: [[action()]] })

    await dispatchDueTriageActions({
      repository: repo,
      client: client(),
      maxTicketsPerDay: 5,
      now: NOW,
      token: "claim-a",
      clock: () => NOW,
      heartbeat,
    })

    expect(heartbeat).toHaveBeenCalledTimes(1)
  })

  it("passes the claim's UTC day start and lease expiry through", async () => {
    const repo = repository({ claims: [[action()]] })

    await dispatchDueTriageActions({
      repository: repo,
      client: client(),
      maxTicketsPerDay: 5,
      now: NOW,
      token: "claim-a",
      clock: () => new Date("2026-08-18T23:30:00.000Z"),
    })

    expect(vi.mocked(repo.claimDueActions).mock.calls[0]?.[0]).toMatchObject({
      dailyLimit: 5,
      claimLimit: 1,
      dayStart: new Date("2026-08-18T00:00:00.000Z"),
      token: "claim-a",
    })
  })
})
