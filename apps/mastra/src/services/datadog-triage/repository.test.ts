import type { QueryResult, QueryResultRow } from "pg"
import { describe, expect, it } from "vitest"

import {
  PostgresDatadogTriageRepository,
  TriageClaimLostError,
  TriageLeaseLostError,
  TriageWriteOrderingError,
} from "./repository"
import {
  emptyTriageRunCounters,
  type SeenIssueUpdate,
  type TriageActionDraft,
  type TriageRunReport,
} from "./schema"

function result<T extends QueryResultRow>(rows: T[] = []): QueryResult<T> {
  return { rows, command: "", rowCount: rows.length, oid: 0, fields: [] }
}

class FakeDatabase {
  readonly calls: Array<{ text: string; values?: readonly unknown[] }> = []
  readonly responses: QueryResult<QueryResultRow>[] = []

  async query<T extends QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<T>> {
    this.calls.push({ text, values })
    return (this.responses.shift() ?? result()) as QueryResult<T>
  }
}

const draft: TriageActionDraft = {
  idempotencyKey: "datadog-triage:issue:ISSUE-1:0",
  service: "forge-mobile",
  signalKind: "issue",
  signalId: "ISSUE-1",
  epoch: 0,
  title: "[Mobile] [P2] Player crashes on resume",
  description:
    "body\n<!-- datadog-triage-key:datadog-triage:issue:ISSUE-1:0 -->",
  labelId: "label-bug",
}

const seenIssueUpdate: SeenIssueUpdate = {
  issueId: "ISSUE-1",
  service: "forge-mobile",
  epoch: 0,
  baselineRate: 12,
  lastActivityAt: "2026-08-18T11:00:00.000Z",
  firstSeenAt: "2026-08-18T10:07:00.000Z",
}

const report: TriageRunReport = {
  runKey: "datadog-triage:2026-08-18T11",
  status: "complete",
  windowStart: "2026-08-18T10:00:00.000Z",
  windowEnd: "2026-08-18T11:00:00.000Z",
  counters: emptyTriageRunCounters(),
  sources: [{ source: "issues:forge-mobile", status: "ok" }],
  issueUrls: [],
  errors: [],
}

describe("PostgresDatadogTriageRepository", () => {
  it("claims a fresh run and reports the live status when the lease is held", async () => {
    const database = new FakeDatabase()
    database.responses.push(
      result([{ run_key: "datadog-triage:2026-08-18T11" }]),
      result(),
      result([{ status: "running" }]),
    )
    const repository = new PostgresDatadogTriageRepository(database)
    const input = {
      runKey: "datadog-triage:2026-08-18T11",
      windowStart: new Date("2026-08-18T10:00:00Z"),
      windowEnd: new Date("2026-08-18T11:00:00Z"),
      leaseToken: "lease-a",
      leaseExpiresAt: new Date("2026-08-18T11:30:00Z"),
    }

    expect(await repository.claimRun(input)).toEqual({ claimed: true })
    expect(await repository.claimRun(input)).toEqual({
      claimed: false,
      status: "running",
    })
    expect(database.calls[0]?.text).toContain(
      "datadog_triage.runs.lease_expires_at < now()",
    )
  })

  it("throws when a lease renewal matches no running row", async () => {
    const repository = new PostgresDatadogTriageRepository(new FakeDatabase())

    await expect(
      repository.renewRunLease({
        runKey: "datadog-triage:2026-08-18T11",
        leaseToken: "lease-a",
        leaseDurationMs: 60_000,
      }),
    ).rejects.toBeInstanceOf(TriageLeaseLostError)
  })

  it("finalizes only under the run's own lease token", async () => {
    const database = new FakeDatabase()
    database.responses.push(result([{ run_key: report.runKey }]))
    const repository = new PostgresDatadogTriageRepository(database)

    await repository.finalizeRun(report, "lease-a")

    const call = database.calls[0]
    expect(call?.text).toContain("and lease_token = $6")
    expect(call?.values?.[5]).toBe("lease-a")
  })

  it("refuses a seen-issue commit whose outbox row is not yet durable", async () => {
    const database = new FakeDatabase()
    database.responses.push(
      result([{ missing_action_keys: ["datadog-triage:issue:ISSUE-1:0"] }]),
    )
    const repository = new PostgresDatadogTriageRepository(database)

    await expect(
      repository.commitSeenIssues([
        { ...seenIssueUpdate, requiredActionKey: draft.idempotencyKey },
      ]),
    ).rejects.toBeInstanceOf(TriageWriteOrderingError)
  })

  it("commits a seen issue whose outbox row is durable", async () => {
    const database = new FakeDatabase()
    database.responses.push(result([{ missing_action_keys: [] }]))
    const repository = new PostgresDatadogTriageRepository(database)

    await repository.commitSeenIssues([
      { ...seenIssueUpdate, requiredActionKey: draft.idempotencyKey },
    ])

    expect(database.calls[0]?.values?.[6]).toEqual([draft.idempotencyKey])
  })

  it("commits a suppressed seen issue that never needed an outbox row", async () => {
    const database = new FakeDatabase()
    database.responses.push(result([{ missing_action_keys: [] }]))
    const repository = new PostgresDatadogTriageRepository(database)

    await repository.commitSeenIssues([seenIssueUpdate])

    expect(database.calls[0]?.values?.[6]).toEqual([null])
  })

  it("applies the same write-ordering guard to monitor and spike state", async () => {
    const database = new FakeDatabase()
    database.responses.push(
      result([{ missing_action_keys: ["monitor-key"] }]),
      result([{ missing_action_keys: ["spike-key"] }]),
    )
    const repository = new PostgresDatadogTriageRepository(database)

    await expect(
      repository.commitMonitorStates([
        {
          monitorId: "42",
          service: "forge-mobile",
          overallState: "Alert",
          lastEpisodeStartedAt: "2026-08-18T10:30:00.000Z",
          lastTicketedAt: null,
          requiredActionKey: "monitor-key",
        },
      ]),
    ).rejects.toBeInstanceOf(TriageWriteOrderingError)
    await expect(
      repository.commitSpikeBaselines([
        {
          service: "forge-mobile",
          spikeClass: "playback_error_rate",
          baselineRate: 4,
          observations: 12,
          lastTicketedAt: null,
          requiredActionKey: "spike-key",
        },
      ]),
    ).rejects.toBeInstanceOf(TriageWriteOrderingError)
  })

  it("advances one source cursor without touching another", async () => {
    const database = new FakeDatabase()
    const repository = new PostgresDatadogTriageRepository(database)

    await repository.commitCursors([
      {
        source: "issues:forge-mobile",
        cursorAt: new Date("2026-08-18T10:57:00Z"),
        succeeded: true,
        succeededAt: new Date("2026-08-19T12:00:00Z"),
      },
    ])

    const call = database.calls[0]
    expect(call?.values?.[0]).toEqual(["issues:forge-mobile"])
    expect(call?.values?.[2]).toEqual([true])
    expect(call?.text).toContain("greatest(")
  })

  it("records a last-success timestamp only for a source that succeeded", async () => {
    const database = new FakeDatabase()
    const repository = new PostgresDatadogTriageRepository(database)

    await repository.commitCursors([
      {
        source: "monitors:forge-mobile",
        cursorAt: new Date("2026-08-18T10:00:00Z"),
        succeeded: false,
        succeededAt: new Date("2026-08-19T12:00:00Z"),
      },
    ])

    const call = database.calls[0]
    expect(call?.values?.[2]).toEqual([false])
    // The stamp is the FETCH time, deliberately not the cursor position — a
    // held cursor is backdated and would fake an outage on a healthy source.
    expect(call?.text).toContain(
      "case when entry.succeeded then entry.succeeded_at else null end",
    )
    expect(call?.values?.[3]).toEqual([new Date("2026-08-19T12:00:00Z")])
  })

  it("skips every query when a commit batch is empty", async () => {
    const database = new FakeDatabase()
    const repository = new PostgresDatadogTriageRepository(database)

    await repository.commitCursors([])
    await repository.commitSeenIssues([])
    await repository.commitMonitorStates([])
    await repository.commitSpikeBaselines([])
    await repository.seedServiceBaselines([], new Date())
    expect(await repository.getSeenIssues([])).toEqual([])
    expect(await repository.getCursors([])).toEqual([])

    expect(database.calls).toHaveLength(0)
  })

  it("reports whether an enqueue inserted a new outbox row", async () => {
    const database = new FakeDatabase()
    database.responses.push(
      result([{ idempotency_key: draft.idempotencyKey }]),
      result(),
    )
    const repository = new PostgresDatadogTriageRepository(database)

    expect(await repository.enqueueAction(draft)).toBe(true)
    expect(await repository.enqueueAction(draft)).toBe(false)
    expect(database.calls[0]?.text).toContain(
      "on conflict (idempotency_key) do nothing",
    )
  })

  it("passes the daily budget and UTC day start into the claim statement", async () => {
    const database = new FakeDatabase()
    database.responses.push(
      result([
        {
          idempotency_key: draft.idempotencyKey,
          payload: draft,
          attempts: 1,
        },
      ]),
    )
    const repository = new PostgresDatadogTriageRepository(database)

    const claimed = await repository.claimDueActions({
      dailyLimit: 5,
      claimLimit: 1,
      dayStart: new Date("2026-08-18T00:00:00Z"),
      token: "claim-a",
      expiresAt: new Date("2026-08-18T11:20:00Z"),
      now: new Date("2026-08-18T11:00:00Z"),
    })

    expect(claimed).toEqual([
      { idempotencyKey: draft.idempotencyKey, draft, attempts: 1 },
    ])
    const call = database.calls[0]
    expect(call?.values?.[0]).toBe(5)
    expect(call?.values?.[3]).toEqual(new Date("2026-08-18T00:00:00Z"))
    expect(call?.text).toContain(
      "hashtext('forge_datadog_triage_action_budget')",
    )
    // Saturating, not raw: a row that repeatedly crashes after being claimed
    // but before terminalizing would otherwise breach the attempts CHECK and
    // take down every subsequent run, since the drain runs first.
    expect(call?.text).toContain("attempts = least(attempts + 1, 20)")
  })

  it("never expires a queued action, so an over-budget finding waits for a later day", async () => {
    // R10: over-budget findings queue, they are never silently dropped. The
    // support-research original terminalizes rows older than seven days; this
    // statement must not carry that clause.
    const database = new FakeDatabase()
    const repository = new PostgresDatadogTriageRepository(database)

    await repository.claimDueActions({
      dailyLimit: 5,
      claimLimit: 1,
      dayStart: new Date("2026-08-18T00:00:00Z"),
      token: "claim-a",
      expiresAt: new Date("2026-08-18T11:20:00Z"),
      now: new Date("2026-08-18T11:00:00Z"),
    })

    expect(database.calls[0]?.text).not.toContain("retry_window_expired")
    expect(database.calls[0]?.text).not.toContain("interval '7 days'")
  })

  it("claims nothing without spending a query when the daily budget is zero", async () => {
    const database = new FakeDatabase()
    const repository = new PostgresDatadogTriageRepository(database)

    const claimed = await repository.claimDueActions({
      dailyLimit: 0,
      claimLimit: 1,
      dayStart: new Date("2026-08-18T00:00:00Z"),
      token: "claim-a",
      expiresAt: new Date("2026-08-18T11:20:00Z"),
      now: new Date("2026-08-18T11:00:00Z"),
    })

    expect(claimed).toEqual([])
    expect(database.calls).toHaveLength(0)
  })

  it("persists the caller's backoff timestamp and terminal decision", async () => {
    const database = new FakeDatabase()
    database.responses.push(result([{ idempotency_key: draft.idempotencyKey }]))
    const repository = new PostgresDatadogTriageRepository(database)

    await repository.markActionRetryable({
      idempotencyKey: draft.idempotencyKey,
      token: "claim-a",
      errorCode: "rate_limited",
      nextAttemptAt: new Date("2026-08-18T11:05:00Z"),
      terminal: false,
    })

    const call = database.calls[0]
    expect(call?.values?.[2]).toBe("retryable")
    expect(call?.values?.[4]).toEqual(new Date("2026-08-18T11:05:00Z"))
  })

  it("throws when a completion no longer holds its processing claim", async () => {
    const repository = new PostgresDatadogTriageRepository(new FakeDatabase())

    await expect(
      repository.markActionCreated({
        idempotencyKey: draft.idempotencyKey,
        token: "stale",
        issueId: "issue-1",
        issueUrl: "https://linear.app/forge/issue/FGE-1",
      }),
    ).rejects.toBeInstanceOf(TriageClaimLostError)
  })

  it("parses stored rows back through their schemas", async () => {
    const database = new FakeDatabase()
    database.responses.push(
      result([
        {
          issue_id: "ISSUE-1",
          service: "forge-mobile",
          epoch: 2,
          baseline_rate: "12.5",
          last_activity_at: new Date("2026-08-18T11:00:00Z"),
          first_seen_at: new Date("2026-08-01T10:07:00Z"),
        },
      ]),
      result([
        {
          source: "issues:forge-mobile",
          cursor_at: new Date("2026-08-18T10:57:00Z"),
          last_success_at: null,
        },
      ]),
    )
    const repository = new PostgresDatadogTriageRepository(database)

    expect(await repository.getSeenIssues(["ISSUE-1"])).toEqual([
      {
        issueId: "ISSUE-1",
        service: "forge-mobile",
        epoch: 2,
        baselineRate: 12.5,
        lastActivityAt: "2026-08-18T11:00:00.000Z",
        firstSeenAt: "2026-08-01T10:07:00.000Z",
      },
    ])
    expect(await repository.getCursors(["issues:forge-mobile"])).toEqual([
      {
        source: "issues:forge-mobile",
        cursorAt: "2026-08-18T10:57:00.000Z",
        lastSuccessAt: null,
      },
    ])
  })
})
