import type { QueryResult, QueryResultRow } from "pg"
import { describe, expect, it } from "vitest"

import { PostgresSupportResearchRepository } from "./repository"
import {
  emptySupportRunCounters,
  type StoredSupportObservation,
  type SupportActionDraft,
  type SupportRunReport,
} from "./schema"

function result<T extends QueryResultRow>(rows: T[] = []): QueryResult<T> {
  return {
    rows,
    command: "",
    rowCount: rows.length,
    oid: 0,
    fields: [],
  }
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

const observation: StoredSupportObservation = {
  source: {
    sourceId: "123",
    mailboxId: "9",
    createdAt: "2026-08-01T10:00:00.000Z",
    sourceUrl: "https://secure.helpscout.net/conversation/123",
    subject: "Watch page is missing",
    excerpt: "The Watch page returns an error.",
    watchUrls: ["https://www.jesusfilm.org/watch/jesus.html"],
    redactionCount: 1,
    truncated: false,
  },
  analysis: {
    relevant: true,
    kind: "bug",
    surface: "watch_page",
    title: "Watch page returns an error",
    summary: "A user reports that a public Watch page fails.",
    reportedEvidence: ["The Watch page returns an error."],
    expectedBehavior: "The page loads.",
    actualBehavior: "An error is shown.",
    themeKey: "watch-page-load-error",
    confidence: 0.9,
    actionability: 0.9,
    validationRecommended: true,
    validationTarget: "url_availability",
    inference: "The exact failure still requires a bounded check.",
  },
  validation: {
    state: "unverified",
    incomingUrl: "https://www.jesusfilm.org/watch/jesus.html",
    evidence: [],
    missingProof: "No deterministic failure was observed.",
  },
  fingerprint: "a".repeat(64),
  analyzedAt: "2026-08-01T10:05:00.000Z",
}

describe("PostgresSupportResearchRepository", () => {
  it("atomically claims a new run and refuses a live duplicate", async () => {
    const database = new FakeDatabase()
    database.responses.push(
      result([
        {
          cursor_progress: new Date("2026-08-01T00:00:00Z"),
          cutoff: new Date("2026-08-02T00:00:00Z"),
          status: "running",
        },
      ]),
      result(),
      result([{ status: "running" }]),
    )
    const repository = new PostgresSupportResearchRepository(database)
    const input = {
      runKey: "support-research:2026-08-01",
      dryRun: false,
      cursorStart: new Date("2026-08-01T00:00:00Z"),
      cutoff: new Date("2026-08-02T00:00:00Z"),
      leaseToken: "lease-one",
      leaseExpiresAt: new Date("2026-08-02T00:15:00Z"),
    }

    await expect(repository.claimRun(input)).resolves.toMatchObject({
      claimed: true,
    })
    await expect(repository.claimRun(input)).resolves.toEqual({
      claimed: false,
      status: "running",
    })
    expect(database.calls[0]?.text).toContain("lease_expires_at < now()")
  })

  it("persists only schema-validated sanitized observation payloads", async () => {
    const database = new FakeDatabase()
    database.responses.push(result([{ source_id: "123" }]))
    const repository = new PostgresSupportResearchRepository(database)

    await expect(repository.recordObservation(observation)).resolves.toBe(true)

    const values = database.calls[0]?.values ?? []
    expect(values).not.toContain("customer@example.org")
    expect(String(values[10])).toContain("Watch page returns an error")
    expect(database.calls[0]?.text).toContain("on conflict")
  })

  it("fails progress updates when the run lease has been lost", async () => {
    const database = new FakeDatabase()
    database.responses.push(result())
    const repository = new PostgresSupportResearchRepository(database)

    await expect(
      repository.updateProgress({
        runKey: "support-research:2026-08-01",
        leaseToken: "stale",
        cursor: new Date("2026-08-01T10:00:00Z"),
        counters: emptySupportRunCounters(),
        leaseDurationMs: 30 * 60_000,
      }),
    ).rejects.toThrow("run lease lost")
    expect(database.calls[0]?.text).toContain("lease_expires_at = now()")
  })

  it("renews a run lease only for its current token", async () => {
    const database = new FakeDatabase()
    database.responses.push(
      result([{ run_key: "support-research:2026-08-01" }]),
    )
    const repository = new PostgresSupportResearchRepository(database)

    await repository.renewRunLease({
      runKey: "support-research:2026-08-01",
      leaseToken: "lease-one",
      leaseDurationMs: 30 * 60_000,
    })

    expect(database.calls[0]?.text).toContain("lease_token = $2")
    expect(database.calls[0]?.values?.[2]).toBe(30 * 60_000)
  })

  it("claims due outbox actions with skip-locked semantics", async () => {
    const database = new FakeDatabase()
    database.responses.push(
      result([
        {
          idempotency_key: "support-research:a",
          proposed_issue: {
            idempotencyKey: "support-research:a",
            fingerprint: "b".repeat(64),
            type: "needs_validation",
            title: "Playback control does not respond",
            description: "Generated by the support research agent.",
            labelId: "label-needs-validation",
            sourceIds: ["123"],
          },
          attempts: 1,
        },
      ]),
    )
    const repository = new PostgresSupportResearchRepository(database)

    const actions = await repository.claimDueActions({
      dailyLimit: 5,
      claimLimit: 1,
      actionTypes: ["needs_validation"],
      createdSince: new Date("2026-08-01T00:00:00Z"),
      token: "worker-one",
      expiresAt: new Date("2026-08-01T11:00:00Z"),
      now: new Date("2026-08-01T10:55:00Z"),
    })

    expect(actions[0]?.draft.type).toBe("needs_validation")
    expect(database.calls[0]?.text).toContain(
      "for update of action skip locked",
    )
    expect(database.calls[0]?.text).toContain("pg_advisory_xact_lock")
    expect(database.calls[0]?.text).toContain("interval '7 days'")
    expect(database.calls[0]?.text).toContain("last_error_code")
    expect(database.calls[0]?.text).toContain("state = 'processing'")
    expect(database.calls[0]?.text).toContain(
      "reserved.remote_create_attempted_at >= $6",
    )
    expect(database.calls[0]?.text).toContain(
      "greatest($4::timestamptz, now())",
    )
    expect(database.calls[0]?.text).toContain("limit least")
    expect(database.calls[0]?.values?.[0]).toBe(5)
    expect(database.calls[0]?.values?.[6]).toBe(1)
    expect(database.calls[0]?.values?.[4]).toEqual(["needs_validation"])
    expect(database.calls[0]?.values?.[5]).toEqual(
      new Date("2026-08-01T00:00:00Z"),
    )
  })

  it("filters recurrence queries to UX feedback kinds", async () => {
    const database = new FakeDatabase()
    const repository = new PostgresSupportResearchRepository(database)

    await repository.listThemeObservations({
      surface: "language_selection",
      themeKey: "language-picker-confusion",
      feedbackKinds: ["usability", "need"],
      since: new Date("2026-07-01T00:00:00Z"),
      limit: 50,
    })

    expect(database.calls[0]?.text).toContain("feedback_kind = any($4::text[])")
    expect(database.calls[0]?.values?.[3]).toEqual(["usability", "need"])
  })

  it("records a remote create attempt before mutation dispatch", async () => {
    const database = new FakeDatabase()
    database.responses.push(result([{ idempotency_key: "support-research:a" }]))
    const repository = new PostgresSupportResearchRepository(database)

    await repository.markActionMutationAttempted({
      idempotencyKey: "support-research:a",
      token: "worker-one",
    })

    expect(database.calls[0]?.text).toContain("remote_create_attempted_at")
    expect(database.calls[0]?.text).toContain("processing_token = $2")
  })

  it("keeps dry-run action keys separate from live action keys", async () => {
    const database = new FakeDatabase()
    database.responses.push(
      result([{ idempotency_key: "dry-run:support-research:a" }]),
      result([{ idempotency_key: "support-research:a" }]),
    )
    const repository = new PostgresSupportResearchRepository(database)
    const draft: SupportActionDraft = {
      idempotencyKey: "support-research:a",
      fingerprint: "b".repeat(64),
      type: "needs_validation",
      title: "Playback control does not respond",
      description: "Generated by the support research agent.",
      sourceIds: ["123"],
    }

    await repository.enqueueAction(draft, true)
    await repository.enqueueAction(draft, false)

    expect(database.calls[0]?.values?.[0]).toBe("dry-run:support-research:a")
    expect(database.calls[1]?.values?.[0]).toBe("support-research:a")
  })

  it("finalizes only the run that still owns the lease", async () => {
    const database = new FakeDatabase()
    database.responses.push(
      result([{ run_key: "support-research:2026-08-01" }]),
    )
    const repository = new PostgresSupportResearchRepository(database)
    const report: SupportRunReport = {
      runKey: "support-research:2026-08-01",
      status: "complete",
      dryRun: false,
      cutoff: "2026-08-02T00:00:00.000Z",
      cursorStart: "2026-08-01T00:00:00.000Z",
      cursorEnd: "2026-08-02T00:00:00.000Z",
      counters: emptySupportRunCounters(),
      findings: [],
      actionUrls: [],
      errors: [],
    }

    await repository.finalizeRun(report, 90, "lease-one")

    expect(database.calls[0]?.text).toContain("lease_token = $8")
    expect(database.calls[0]?.text).toContain(
      "select 'help_scout', $3 from finished where not dry_run",
    )
    expect(database.calls[0]?.values?.[7]).toBe("lease-one")
  })

  it("reports a lost lease when finalization updates no run", async () => {
    const database = new FakeDatabase()
    const repository = new PostgresSupportResearchRepository(database)
    const report: SupportRunReport = {
      runKey: "support-research:2026-08-01",
      status: "complete",
      dryRun: false,
      cutoff: "2026-08-02T00:00:00.000Z",
      cursorStart: "2026-08-01T00:00:00.000Z",
      cursorEnd: "2026-08-02T00:00:00.000Z",
      counters: emptySupportRunCounters(),
      findings: [],
      actionUrls: [],
      errors: [],
    }

    await expect(
      repository.finalizeRun(report, 90, "stale-lease"),
    ).rejects.toThrow("run lease lost")
  })

  it("purges report copies and minimizes old evidence-bearing payloads", async () => {
    const database = new FakeDatabase()
    database.responses.push(result([{ count: 2 }]))
    const repository = new PostgresSupportResearchRepository(database)

    await expect(
      repository.purgeExpired(
        new Date("2026-08-01T10:00:00Z"),
        new Date("2026-05-03T10:00:00Z"),
      ),
    ).resolves.toBe(2)

    const sql = database.calls[0]?.text ?? ""
    expect(sql).toContain("set report = null")
    expect(sql).toContain("proposed_issue = '{}'::jsonb")
    expect(sql).toContain("- 'watchUrls'")
    expect(sql).toContain("- 'summary'")
    expect(sql).toContain("validation_payload = jsonb_build_object")
  })
})
