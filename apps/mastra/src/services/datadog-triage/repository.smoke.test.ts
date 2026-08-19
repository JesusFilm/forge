import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"

import { Pool } from "pg"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

import { env } from "../../config/env"

import {
  PostgresDatadogTriageRepository,
  TriageWriteOrderingError,
} from "./repository"
import {
  emptyTriageRunCounters,
  type TriageActionDraft,
  type TriageRunReport,
} from "./schema"

/**
 * Opt-in REAL-POSTGRES repository smoke (U2).
 *
 * Proves what mocked SQL-shape tests structurally cannot. The mocked suite
 * asserts the statement TEXT and the parameters; it cannot tell you whether
 * PostgreSQL resolves `unnest(text[], text[], integer[], …)`, whether the
 * budget CTE really stops at the fifth claim of a UTC day, or whether the
 * write-ordering guard leaves the table untouched when it refuses. Every one
 * of those is a function-resolution or transaction-semantics fact, and only a
 * live database answers it.
 *
 * DELIBERATELY OUT OF CI, and skipped (not failed) by default: it needs a
 * provisioned Postgres and it CREATES, WRITES, AND DELETES rows. Only the
 * literal `DATADOG_TRIAGE_REPOSITORY_SMOKE_TEST=1` enables it, mirroring
 * `AI_CHAT_ERASURE_SMOKE_TEST`.
 *
 * ── Run it (against a THROWAWAY database — never production) ────────────────
 *
 *   createdb forge_datadog_triage_smoke
 *   DATADOG_TRIAGE_REPOSITORY_SMOKE_TEST=1 \
 *   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/forge_datadog_triage_smoke \
 *   pnpm --filter @forge/mastra test -- repository.smoke
 *
 * The suite applies `003-datadog-triage.sql` itself — an empty database is
 * enough, and it deliberately does NOT run the other migrations so the smoke
 * never depends on pgvector being installed.
 */

const RUN_SMOKE = env.DATADOG_TRIAGE_REPOSITORY_SMOKE_TEST === "1"

const MIGRATION_PATH = fileURLToPath(
  new URL("../../../migrations/003-datadog-triage.sql", import.meta.url),
)

/**
 * Refuse a target that does not look disposable. This suite truncates the
 * whole `datadog_triage` schema between cases, and the shell most likely to
 * run it is the same one that holds a real `DATABASE_URL`. A prose warning in
 * the header is not a control; this is.
 */
function assertThrowawayTarget(databaseUrl: string): void {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "refusing to run the triage repository smoke in a production runtime (NODE_ENV=production)",
    )
  }
  const url = new URL(databaseUrl)
  if (/railway|rlwy/i.test(url.hostname)) {
    throw new Error(
      "refusing to run the triage repository smoke against a Railway-hosted database",
    )
  }
  const loopback = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(
    url.hostname,
  )
  const database = url.pathname.replace(/^\/+/, "")
  if (loopback || /(test|smoke|throwaway|scratch)/i.test(database)) return
  throw new Error(
    "refusing to run the triage repository smoke against a target that does not look disposable: " +
      "point DATABASE_URL at a loopback host, or name the database with test/smoke/throwaway/scratch",
  )
}

let pool: Pool
let repository: PostgresDatadogTriageRepository
let migrationSql: string

const DAY_ONE = new Date("2026-08-18T11:00:00.000Z")
const DAY_ONE_START = new Date("2026-08-18T00:00:00.000Z")

/**
 * The budget window is caller-supplied (`dayStart`) but every reservation
 * timestamp is stamped by the DATABASE clock — `terminal_at = now()`. In
 * production the two agree, because the workflow's `now` is real time. A test
 * cannot roll the day by injecting a future `dayStart`: the freshly stamped
 * rows would still fall inside it. So the roll is simulated the honest way,
 * by backdating what the previous day dispatched.
 */
async function backdateDispatchedActions(days: number): Promise<void> {
  await pool.query(
    `update datadog_triage.actions
        set terminal_at = terminal_at - ($1 * interval '1 day'),
            remote_create_attempted_at =
              remote_create_attempted_at - ($1 * interval '1 day'),
            updated_at = updated_at - ($1 * interval '1 day')
      where state in ('created', 'deduplicated')`,
    [days],
  )
}

function startOfUtcDay(at: Date): Date {
  return new Date(`${at.toISOString().slice(0, 10)}T00:00:00.000Z`)
}

function actionDraft(index: number): TriageActionDraft {
  const idempotencyKey = `datadog-triage:issue:ISSUE-${index}:0`
  return {
    idempotencyKey,
    service: "forge-mobile",
    signalKind: "issue",
    signalId: `ISSUE-${index}`,
    epoch: 0,
    title: `[Mobile] [P2] Smoke finding ${index}`,
    description: `body\n<!-- datadog-triage-key:${idempotencyKey} -->`,
    labelId: "label-bug",
  }
}

async function claimOne(input: {
  dailyLimit: number
  now: Date
  dayStart: Date
  token: string
}): Promise<string | undefined> {
  const [action] = await repository.claimDueActions({
    dailyLimit: input.dailyLimit,
    claimLimit: 1,
    dayStart: input.dayStart,
    token: input.token,
    expiresAt: new Date(input.now.getTime() + 20 * 60_000),
    now: input.now,
  })
  return action?.idempotencyKey
}

describe.skipIf(!RUN_SMOKE)(
  "datadog triage repository smoke (real Postgres, opt-in)",
  () => {
    beforeAll(async () => {
      if (!env.DATABASE_URL) {
        throw new Error(
          "DATADOG_TRIAGE_REPOSITORY_SMOKE_TEST=1 requires a throwaway DATABASE_URL",
        )
      }
      assertThrowawayTarget(env.DATABASE_URL)
      migrationSql = await readFile(MIGRATION_PATH, "utf8")
      pool = new Pool({
        connectionString: env.DATABASE_URL,
        max: 4,
        allowExitOnIdle: true,
      })
      repository = new PostgresDatadogTriageRepository(pool)
    })

    afterAll(async () => {
      await pool?.query("drop schema if exists datadog_triage cascade")
      await pool?.end()
    })

    beforeEach(async () => {
      await pool.query("drop schema if exists datadog_triage cascade")
      await pool.query(migrationSql)
    })

    it("applies migration 003 twice in a row without error", async () => {
      // beforeEach already applied it once; a second apply must be a no-op.
      await expect(pool.query(migrationSql)).resolves.toBeDefined()

      const tables = await pool.query<{ table_name: string }>(
        `select table_name from information_schema.tables
          where table_schema = 'datadog_triage' order by table_name`,
      )
      expect(tables.rows.map((row) => row.table_name)).toEqual([
        "actions",
        "cursors",
        "monitor_states",
        "runs",
        "seen_issues",
        "service_baselines",
        "spike_baselines",
      ])
    })

    it("enqueues one row for a repeated idempotency key", async () => {
      expect(await repository.enqueueAction(actionDraft(1))).toBe(true)
      expect(await repository.enqueueAction(actionDraft(1))).toBe(false)

      const rows = await pool.query<{ count: string }>(
        "select count(*) as count from datadog_triage.actions",
      )
      expect(Number(rows.rows[0]?.count)).toBe(1)
    })

    it("claims exactly the daily budget, then releases the rest after the day rolls (AE4)", async () => {
      const now = new Date()
      const dayStart = startOfUtcDay(now)
      for (let index = 1; index <= 6; index += 1) {
        await repository.enqueueAction(actionDraft(index))
      }

      const dayOneClaims: string[] = []
      for (let attempt = 0; attempt < 6; attempt += 1) {
        const claimed = await claimOne({
          dailyLimit: 5,
          now,
          dayStart,
          token: `day-one-${attempt}`,
        })
        if (!claimed) break
        dayOneClaims.push(claimed)
        await repository.markActionCreated({
          idempotencyKey: claimed,
          token: `day-one-${attempt}`,
          issueId: `issue-${attempt}`,
          issueUrl: `https://linear.app/forge/issue/FGE-${attempt}`,
        })
      }

      expect(dayOneClaims).toHaveLength(5)
      expect(
        await claimOne({
          dailyLimit: 5,
          now,
          dayStart,
          token: "day-one-extra",
        }),
      ).toBeUndefined()

      // The sixth action was never dropped — it waits for a later day's budget.
      expect(await repository.countDueActions(now)).toBe(1)

      await backdateDispatchedActions(1)
      expect(
        await claimOne({
          dailyLimit: 5,
          now,
          dayStart,
          token: "day-two",
        }),
      ).toBe("datadog-triage:issue:ISSUE-6:0")
    })

    it("claims nothing while the daily budget is zero and leaves the row pending", async () => {
      await repository.enqueueAction(actionDraft(1))

      expect(
        await claimOne({
          dailyLimit: 0,
          now: DAY_ONE,
          dayStart: DAY_ONE_START,
          token: "dry-run",
        }),
      ).toBeUndefined()

      const rows = await pool.query<{ state: string }>(
        "select state from datadog_triage.actions",
      )
      expect(rows.rows[0]?.state).toBe("pending")
    })

    it("increments attempts on every claim", async () => {
      await repository.enqueueAction(actionDraft(1))

      const first = await repository.claimDueActions({
        dailyLimit: 5,
        claimLimit: 1,
        dayStart: DAY_ONE_START,
        token: "attempt-1",
        expiresAt: new Date(DAY_ONE.getTime() + 60_000),
        now: DAY_ONE,
      })
      expect(first[0]?.attempts).toBe(1)

      await repository.markActionRetryable({
        idempotencyKey: actionDraft(1).idempotencyKey,
        token: "attempt-1",
        errorCode: "rate_limited",
        nextAttemptAt: DAY_ONE,
        terminal: false,
      })
      const second = await repository.claimDueActions({
        dailyLimit: 5,
        claimLimit: 1,
        dayStart: DAY_ONE_START,
        token: "attempt-2",
        expiresAt: new Date(DAY_ONE.getTime() + 60_000),
        now: DAY_ONE,
      })
      expect(second[0]?.attempts).toBe(2)
    })

    it("refuses a live duplicate run and lets an expired lease be taken over", async () => {
      const base = {
        runKey: "datadog-triage:2026-08-18T11",
        windowStart: new Date("2026-08-18T10:00:00Z"),
        windowEnd: DAY_ONE,
      }

      expect(
        await repository.claimRun({
          ...base,
          leaseToken: "lease-a",
          leaseExpiresAt: new Date(Date.now() + 600_000),
        }),
      ).toEqual({ claimed: true })
      expect(
        await repository.claimRun({
          ...base,
          leaseToken: "lease-b",
          leaseExpiresAt: new Date(Date.now() + 600_000),
        }),
      ).toEqual({ claimed: false, status: "running" })

      await pool.query(
        `update datadog_triage.runs
            set lease_expires_at = now() - interval '1 minute'
          where run_key = $1`,
        [base.runKey],
      )
      expect(
        await repository.claimRun({
          ...base,
          leaseToken: "lease-c",
          leaseExpiresAt: new Date(Date.now() + 600_000),
        }),
      ).toEqual({ claimed: true })
    })

    it("writes no seen-issue row when its outbox row is not yet durable", async () => {
      await expect(
        repository.commitSeenIssues([
          {
            issueId: "ISSUE-1",
            service: "forge-mobile",
            epoch: 0,
            baselineRate: 12,
            lastActivityAt: "2026-08-18T11:00:00.000Z",
            firstSeenAt: "2026-08-18T10:07:00.000Z",
            requiredActionKey: "datadog-triage:issue:ISSUE-1:0",
          },
        ]),
      ).rejects.toBeInstanceOf(TriageWriteOrderingError)

      const rows = await pool.query<{ count: string }>(
        "select count(*) as count from datadog_triage.seen_issues",
      )
      expect(Number(rows.rows[0]?.count)).toBe(0)
    })

    it("commits the whole batch once the outbox row exists", async () => {
      await repository.enqueueAction(actionDraft(1))

      await repository.commitSeenIssues([
        {
          issueId: "ISSUE-1",
          service: "forge-mobile",
          epoch: 1,
          baselineRate: 12.5,
          lastActivityAt: "2026-08-18T11:00:00.000Z",
          firstSeenAt: "2026-08-18T10:07:00.000Z",
          requiredActionKey: actionDraft(1).idempotencyKey,
        },
        {
          issueId: "ISSUE-2",
          service: "forge-mobile",
          epoch: 0,
          baselineRate: 3,
          lastActivityAt: "2026-08-18T10:40:00.000Z",
          firstSeenAt: "2026-08-18T10:40:00.000Z",
        },
      ])

      expect(await repository.getSeenIssues(["ISSUE-1", "ISSUE-2"])).toEqual([
        expect.objectContaining({ issueId: "ISSUE-1", epoch: 1 }),
        expect.objectContaining({ issueId: "ISSUE-2", epoch: 0 }),
      ])
    })

    it("never moves a seen issue's last activity backwards on re-commit", async () => {
      const later = {
        issueId: "ISSUE-1",
        service: "forge-mobile",
        epoch: 0,
        baselineRate: 5,
        lastActivityAt: "2026-08-18T11:00:00.000Z",
        firstSeenAt: "2026-08-18T10:00:00.000Z",
      }
      await repository.commitSeenIssues([later])
      await repository.commitSeenIssues([
        { ...later, lastActivityAt: "2026-08-18T09:00:00.000Z" },
      ])

      const [stored] = await repository.getSeenIssues(["ISSUE-1"])
      expect(stored?.lastActivityAt).toBe("2026-08-18T11:00:00.000Z")
    })

    it("advances a healthy source's cursor while a failed source holds", async () => {
      await repository.commitCursors([
        {
          source: "issues:forge-mobile",
          cursorAt: new Date("2026-08-18T10:00:00Z"),
          succeeded: true,
        },
        {
          source: "monitors:forge-mobile",
          cursorAt: new Date("2026-08-18T10:00:00Z"),
          succeeded: true,
        },
      ])

      await repository.commitCursors([
        {
          source: "issues:forge-mobile",
          cursorAt: new Date("2026-08-18T10:57:00Z"),
          succeeded: true,
        },
        {
          source: "monitors:forge-mobile",
          cursorAt: new Date("2026-08-18T10:00:00Z"),
          succeeded: false,
        },
      ])

      const cursors = await repository.getCursors([
        "issues:forge-mobile",
        "monitors:forge-mobile",
      ])
      const bySource = new Map(
        cursors.map((cursor) => [cursor.source, cursor] as const),
      )
      expect(bySource.get("issues:forge-mobile")?.cursorAt).toBe(
        "2026-08-18T10:57:00.000Z",
      )
      expect(bySource.get("monitors:forge-mobile")?.cursorAt).toBe(
        "2026-08-18T10:00:00.000Z",
      )
      expect(bySource.get("monitors:forge-mobile")?.lastSuccessAt).toBe(
        "2026-08-18T10:00:00.000Z",
      )
    })

    it("round-trips monitor state, spike baselines, and service seeding", async () => {
      await repository.seedServiceBaselines(["forge-mobile"], DAY_ONE)
      await repository.commitMonitorStates([
        {
          monitorId: "42",
          service: "forge-mobile",
          overallState: "Alert",
          lastEpisodeStartedAt: "2026-08-18T10:30:00.000Z",
          lastTicketedAt: "2026-08-18T10:31:00.000Z",
        },
      ])
      await repository.commitSpikeBaselines([
        {
          service: "forge-mobile",
          spikeClass: "playback_error_rate",
          baselineRate: 4.25,
          observations: 12,
          lastTicketedAt: null,
        },
      ])

      expect(await repository.getSeededServices(["forge-mobile"])).toEqual([
        "forge-mobile",
      ])
      expect(await repository.getMonitorStates(["42"])).toEqual([
        {
          monitorId: "42",
          service: "forge-mobile",
          overallState: "Alert",
          lastEpisodeStartedAt: "2026-08-18T10:30:00.000Z",
          lastTicketedAt: "2026-08-18T10:31:00.000Z",
        },
      ])
      expect(await repository.getSpikeBaselines(["forge-mobile"])).toEqual([
        {
          service: "forge-mobile",
          spikeClass: "playback_error_rate",
          baselineRate: 4.25,
          observations: 12,
          lastTicketedAt: null,
        },
      ])
    })

    it("finalizes a claimed run and refuses a stale lease token", async () => {
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
      await repository.claimRun({
        runKey: report.runKey,
        windowStart: new Date(report.windowStart),
        windowEnd: new Date(report.windowEnd),
        leaseToken: "lease-a",
        leaseExpiresAt: new Date(Date.now() + 600_000),
      })

      await expect(
        repository.finalizeRun(report, "lease-wrong"),
      ).rejects.toThrow()
      await expect(
        repository.finalizeRun(report, "lease-a"),
      ).resolves.toBeUndefined()

      const rows = await pool.query<{ status: string }>(
        "select status from datadog_triage.runs where run_key = $1",
        [report.runKey],
      )
      expect(rows.rows[0]?.status).toBe("complete")
    })
  },
)
