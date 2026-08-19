import type { QueryResult, QueryResultRow } from "pg"

import {
  monitorStateSchema,
  seenIssueSchema,
  spikeBaselineSchema,
  triageActionDraftSchema,
  triageCursorSchema,
  triageRunReportSchema,
  type MonitorState,
  type MonitorStateUpdate,
  type SeenIssue,
  type SeenIssueUpdate,
  type SpikeBaseline,
  type SpikeBaselineUpdate,
  type TriageActionDraft,
  type TriageCursor,
  type TriageRunCounters,
  type TriageRunReport,
} from "./schema"

export type DatadogTriageQueryable = {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<T>>
}

export type TriageRunClaim =
  | { claimed: true }
  | { claimed: false; status: string }

export type DueTriageAction = {
  idempotencyKey: string
  draft: TriageActionDraft
  attempts: number
}

export type CursorCommit = {
  source: string
  cursorAt: Date
  /** Set only when that source's fetch succeeded; drives the liveness check. */
  succeeded: boolean
}

export interface DatadogTriageRepository {
  claimRun(input: {
    runKey: string
    windowStart: Date
    windowEnd: Date
    leaseToken: string
    leaseExpiresAt: Date
  }): Promise<TriageRunClaim>
  renewRunLease(input: {
    runKey: string
    leaseToken: string
    leaseDurationMs: number
    counters?: TriageRunCounters
  }): Promise<void>
  finalizeRun(report: TriageRunReport, leaseToken: string): Promise<void>
  getCursors(sources: string[]): Promise<TriageCursor[]>
  commitCursors(entries: CursorCommit[]): Promise<void>
  getSeededServices(services: string[]): Promise<string[]>
  seedServiceBaselines(services: string[], seededAt: Date): Promise<void>
  getSeenIssues(issueIds: string[]): Promise<SeenIssue[]>
  commitSeenIssues(updates: SeenIssueUpdate[]): Promise<void>
  getMonitorStates(monitorIds: string[]): Promise<MonitorState[]>
  commitMonitorStates(updates: MonitorStateUpdate[]): Promise<void>
  getSpikeBaselines(services: string[]): Promise<SpikeBaseline[]>
  commitSpikeBaselines(updates: SpikeBaselineUpdate[]): Promise<void>
  enqueueAction(draft: TriageActionDraft): Promise<boolean>
  claimDueActions(input: {
    dailyLimit: number
    claimLimit: number
    dayStart: Date
    token: string
    expiresAt: Date
    now: Date
  }): Promise<DueTriageAction[]>
  countDueActions(now: Date): Promise<number>
  markActionCreated(input: {
    idempotencyKey: string
    token: string
    issueId: string
    issueUrl: string
  }): Promise<void>
  markActionDeduplicated(input: {
    idempotencyKey: string
    token: string
    issueId: string
    issueUrl: string
  }): Promise<void>
  markActionMutationAttempted(input: {
    idempotencyKey: string
    token: string
  }): Promise<void>
  markActionRetryable(input: {
    idempotencyKey: string
    token: string
    errorCode: string
    nextAttemptAt: Date
    terminal: boolean
  }): Promise<void>
}

/**
 * Thrown when a state commit would run ahead of the outbox row that justifies
 * it (KTD2). The run leaves its cursor unmoved and re-processes the signal next
 * hour; the outbox primary key absorbs the duplicate.
 */
export class TriageWriteOrderingError extends Error {
  constructor(readonly missingActionKeys: string[]) {
    super(
      `datadog triage state commit is missing ${missingActionKeys.length} durable action row(s)`,
    )
    this.name = "TriageWriteOrderingError"
  }
}

export class TriageClaimLostError extends Error {
  constructor(readonly idempotencyKey: string) {
    super("datadog triage action claim lost")
    this.name = "TriageClaimLostError"
  }
}

export class TriageLeaseLostError extends Error {
  constructor(readonly runKey: string) {
    super("datadog triage run lease lost")
    this.name = "TriageLeaseLostError"
  }
}

function isoOrNull(value: Date | null | undefined): string | null {
  return value ? new Date(value).toISOString() : null
}

export class PostgresDatadogTriageRepository implements DatadogTriageRepository {
  constructor(private readonly database: DatadogTriageQueryable) {}

  async claimRun(input: {
    runKey: string
    windowStart: Date
    windowEnd: Date
    leaseToken: string
    leaseExpiresAt: Date
  }): Promise<TriageRunClaim> {
    const claimed = await this.database.query<{ run_key: string }>(
      `insert into datadog_triage.runs (
         run_key, status, window_start, window_end, lease_token, lease_expires_at
       ) values ($1, 'running', $2, $3, $4, $5)
       on conflict (run_key) do update
         set status = 'running',
             window_start = excluded.window_start,
             window_end = excluded.window_end,
             lease_token = excluded.lease_token,
             lease_expires_at = excluded.lease_expires_at,
             updated_at = now()
       where datadog_triage.runs.status = 'running'
         and datadog_triage.runs.lease_expires_at < now()
       returning run_key`,
      [
        input.runKey,
        input.windowStart,
        input.windowEnd,
        input.leaseToken,
        input.leaseExpiresAt,
      ],
    )
    if (claimed.rows[0]) return { claimed: true }

    const existing = await this.database.query<{ status: string }>(
      `select status from datadog_triage.runs where run_key = $1`,
      [input.runKey],
    )
    return { claimed: false, status: existing.rows[0]?.status ?? "unknown" }
  }

  async renewRunLease(input: {
    runKey: string
    leaseToken: string
    leaseDurationMs: number
    counters?: TriageRunCounters
  }): Promise<void> {
    const result = await this.database.query(
      `update datadog_triage.runs
          set lease_expires_at = now() + ($3 * interval '1 millisecond'),
              counters = coalesce($4::jsonb, counters),
              updated_at = now()
        where run_key = $1
          and lease_token = $2
          and status = 'running'`,
      [
        input.runKey,
        input.leaseToken,
        input.leaseDurationMs,
        input.counters ? JSON.stringify(input.counters) : null,
      ],
    )
    if (result.rowCount !== 1) throw new TriageLeaseLostError(input.runKey)
  }

  async finalizeRun(
    reportInput: TriageRunReport,
    leaseToken: string,
  ): Promise<void> {
    const report = triageRunReportSchema.parse(reportInput)
    const terminalStatus =
      report.status === "already_running" ? "partial" : report.status
    const result = await this.database.query(
      `update datadog_triage.runs
          set status = $2,
              counters = $3::jsonb,
              report = $4::jsonb,
              partial_reason = $5,
              lease_token = null,
              lease_expires_at = null,
              completed_at = now(),
              updated_at = now()
        where run_key = $1
          and lease_token = $6
          and status = 'running'`,
      [
        report.runKey,
        terminalStatus,
        JSON.stringify(report.counters),
        JSON.stringify(report),
        report.partialReason ?? null,
        leaseToken,
      ],
    )
    if (result.rowCount !== 1) throw new TriageLeaseLostError(report.runKey)
  }

  async getCursors(sources: string[]): Promise<TriageCursor[]> {
    if (sources.length === 0) return []
    const result = await this.database.query<{
      source: string
      cursor_at: Date
      last_success_at: Date | null
    }>(
      `select source, cursor_at, last_success_at
         from datadog_triage.cursors
        where source = any($1::text[])`,
      [sources],
    )
    return result.rows.map((row) =>
      triageCursorSchema.parse({
        source: row.source,
        cursorAt: new Date(row.cursor_at).toISOString(),
        lastSuccessAt: isoOrNull(row.last_success_at),
      }),
    )
  }

  async commitCursors(entries: CursorCommit[]): Promise<void> {
    if (entries.length === 0) return
    await this.database.query(
      `insert into datadog_triage.cursors (source, cursor_at, last_success_at)
       select entry.source, entry.cursor_at,
              case when entry.succeeded then entry.cursor_at else null end
         from unnest($1::text[], $2::timestamptz[], $3::boolean[])
           as entry(source, cursor_at, succeeded)
       on conflict (source) do update
         set cursor_at = greatest(
               datadog_triage.cursors.cursor_at,
               excluded.cursor_at
             ),
             last_success_at = coalesce(
               excluded.last_success_at,
               datadog_triage.cursors.last_success_at
             ),
             updated_at = now()`,
      [
        entries.map((entry) => entry.source),
        entries.map((entry) => entry.cursorAt),
        entries.map((entry) => entry.succeeded),
      ],
    )
  }

  async getSeededServices(services: string[]): Promise<string[]> {
    if (services.length === 0) return []
    const result = await this.database.query<{ service: string }>(
      `select service
         from datadog_triage.service_baselines
        where service = any($1::text[])`,
      [services],
    )
    return result.rows.map((row) => row.service)
  }

  async seedServiceBaselines(
    services: string[],
    seededAt: Date,
  ): Promise<void> {
    if (services.length === 0) return
    await this.database.query(
      `insert into datadog_triage.service_baselines (service, seeded_at)
       select service, $2 from unnest($1::text[]) as service
       on conflict (service) do nothing`,
      [services, seededAt],
    )
  }

  async getSeenIssues(issueIds: string[]): Promise<SeenIssue[]> {
    if (issueIds.length === 0) return []
    const result = await this.database.query<{
      issue_id: string
      service: string
      epoch: number
      baseline_rate: number
      last_activity_at: Date
      first_seen_at: Date
    }>(
      `select issue_id, service, epoch, baseline_rate,
              last_activity_at, first_seen_at
         from datadog_triage.seen_issues
        where issue_id = any($1::text[])`,
      [issueIds],
    )
    return result.rows.map((row) =>
      seenIssueSchema.parse({
        issueId: row.issue_id,
        service: row.service,
        epoch: Number(row.epoch),
        baselineRate: Number(row.baseline_rate),
        lastActivityAt: new Date(row.last_activity_at).toISOString(),
        firstSeenAt: new Date(row.first_seen_at).toISOString(),
      }),
    )
  }

  async commitSeenIssues(updates: SeenIssueUpdate[]): Promise<void> {
    if (updates.length === 0) return
    const result = await this.database.query<{
      missing_action_keys: string[] | null
    }>(
      `with input as (
         select *
           from unnest(
             $1::text[], $2::text[], $3::integer[], $4::double precision[],
             $5::timestamptz[], $6::timestamptz[], $7::text[]
           ) as entry(
             issue_id, service, epoch, baseline_rate,
             last_activity_at, first_seen_at, required_action_key
           )
       ), missing as (
         select input.required_action_key as action_key
           from input
          where input.required_action_key is not null
            and not exists (
              select 1 from datadog_triage.actions action
               where action.idempotency_key = input.required_action_key
            )
       ), applied as (
         insert into datadog_triage.seen_issues (
           issue_id, service, epoch, baseline_rate,
           last_activity_at, first_seen_at
         )
         select input.issue_id, input.service, input.epoch,
                input.baseline_rate, input.last_activity_at, input.first_seen_at
           from input
          where not exists (select 1 from missing)
         on conflict (issue_id) do update
           set service = excluded.service,
               epoch = excluded.epoch,
               baseline_rate = excluded.baseline_rate,
               last_activity_at = greatest(
                 datadog_triage.seen_issues.last_activity_at,
                 excluded.last_activity_at
               ),
               updated_at = now()
         returning issue_id
       )
       select array(select distinct action_key from missing)
                as missing_action_keys`,
      [
        updates.map((update) => update.issueId),
        updates.map((update) => update.service),
        updates.map((update) => update.epoch),
        updates.map((update) => update.baselineRate),
        updates.map((update) => update.lastActivityAt),
        updates.map((update) => update.firstSeenAt),
        updates.map((update) => update.requiredActionKey ?? null),
      ],
    )
    assertNoMissingActions(result.rows[0]?.missing_action_keys)
  }

  async getMonitorStates(monitorIds: string[]): Promise<MonitorState[]> {
    if (monitorIds.length === 0) return []
    const result = await this.database.query<{
      monitor_id: string
      service: string
      overall_state: string
      last_episode_started_at: Date | null
      last_ticketed_at: Date | null
    }>(
      `select monitor_id, service, overall_state,
              last_episode_started_at, last_ticketed_at
         from datadog_triage.monitor_states
        where monitor_id = any($1::text[])`,
      [monitorIds],
    )
    return result.rows.map((row) =>
      monitorStateSchema.parse({
        monitorId: row.monitor_id,
        service: row.service,
        overallState: row.overall_state,
        lastEpisodeStartedAt: isoOrNull(row.last_episode_started_at),
        lastTicketedAt: isoOrNull(row.last_ticketed_at),
      }),
    )
  }

  async commitMonitorStates(updates: MonitorStateUpdate[]): Promise<void> {
    if (updates.length === 0) return
    const result = await this.database.query<{
      missing_action_keys: string[] | null
    }>(
      `with input as (
         select *
           from unnest(
             $1::text[], $2::text[], $3::text[],
             $4::timestamptz[], $5::timestamptz[], $6::text[]
           ) as entry(
             monitor_id, service, overall_state,
             last_episode_started_at, last_ticketed_at, required_action_key
           )
       ), missing as (
         select input.required_action_key as action_key
           from input
          where input.required_action_key is not null
            and not exists (
              select 1 from datadog_triage.actions action
               where action.idempotency_key = input.required_action_key
            )
       ), applied as (
         insert into datadog_triage.monitor_states (
           monitor_id, service, overall_state,
           last_episode_started_at, last_ticketed_at
         )
         select input.monitor_id, input.service, input.overall_state,
                input.last_episode_started_at, input.last_ticketed_at
           from input
          where not exists (select 1 from missing)
         on conflict (monitor_id) do update
           set service = excluded.service,
               overall_state = excluded.overall_state,
               last_episode_started_at = coalesce(
                 excluded.last_episode_started_at,
                 datadog_triage.monitor_states.last_episode_started_at
               ),
               last_ticketed_at = coalesce(
                 excluded.last_ticketed_at,
                 datadog_triage.monitor_states.last_ticketed_at
               ),
               updated_at = now()
         returning monitor_id
       )
       select array(select distinct action_key from missing)
                as missing_action_keys`,
      [
        updates.map((update) => update.monitorId),
        updates.map((update) => update.service),
        updates.map((update) => update.overallState),
        updates.map((update) => update.lastEpisodeStartedAt),
        updates.map((update) => update.lastTicketedAt),
        updates.map((update) => update.requiredActionKey ?? null),
      ],
    )
    assertNoMissingActions(result.rows[0]?.missing_action_keys)
  }

  async getSpikeBaselines(services: string[]): Promise<SpikeBaseline[]> {
    if (services.length === 0) return []
    const result = await this.database.query<{
      service: string
      spike_class: string
      baseline_rate: number
      observations: number
      last_ticketed_at: Date | null
    }>(
      `select service, spike_class, baseline_rate, observations,
              last_ticketed_at
         from datadog_triage.spike_baselines
        where service = any($1::text[])`,
      [services],
    )
    return result.rows.map((row) =>
      spikeBaselineSchema.parse({
        service: row.service,
        spikeClass: row.spike_class,
        baselineRate: Number(row.baseline_rate),
        observations: Number(row.observations),
        lastTicketedAt: isoOrNull(row.last_ticketed_at),
      }),
    )
  }

  async commitSpikeBaselines(updates: SpikeBaselineUpdate[]): Promise<void> {
    if (updates.length === 0) return
    const result = await this.database.query<{
      missing_action_keys: string[] | null
    }>(
      `with input as (
         select *
           from unnest(
             $1::text[], $2::text[], $3::double precision[], $4::integer[],
             $5::timestamptz[], $6::text[]
           ) as entry(
             service, spike_class, baseline_rate, observations,
             last_ticketed_at, required_action_key
           )
       ), missing as (
         select input.required_action_key as action_key
           from input
          where input.required_action_key is not null
            and not exists (
              select 1 from datadog_triage.actions action
               where action.idempotency_key = input.required_action_key
            )
       ), applied as (
         insert into datadog_triage.spike_baselines (
           service, spike_class, baseline_rate, observations, last_ticketed_at
         )
         select input.service, input.spike_class, input.baseline_rate,
                input.observations, input.last_ticketed_at
           from input
          where not exists (select 1 from missing)
         on conflict (service, spike_class) do update
           set baseline_rate = excluded.baseline_rate,
               observations = excluded.observations,
               last_ticketed_at = coalesce(
                 excluded.last_ticketed_at,
                 datadog_triage.spike_baselines.last_ticketed_at
               ),
               updated_at = now()
         returning service
       )
       select array(select distinct action_key from missing)
                as missing_action_keys`,
      [
        updates.map((update) => update.service),
        updates.map((update) => update.spikeClass),
        updates.map((update) => update.baselineRate),
        updates.map((update) => update.observations),
        updates.map((update) => update.lastTicketedAt),
        updates.map((update) => update.requiredActionKey ?? null),
      ],
    )
    assertNoMissingActions(result.rows[0]?.missing_action_keys)
  }

  async enqueueAction(draftInput: TriageActionDraft): Promise<boolean> {
    const draft = triageActionDraftSchema.parse(draftInput)
    const result = await this.database.query<{ idempotency_key: string }>(
      `insert into datadog_triage.actions (
         idempotency_key, service, signal_kind, signal_id, epoch, state, payload
       ) values ($1, $2, $3, $4, $5, 'pending', $6::jsonb)
       on conflict (idempotency_key) do nothing
       returning idempotency_key`,
      [
        draft.idempotencyKey,
        draft.service,
        draft.signalKind,
        draft.signalId,
        draft.epoch,
        JSON.stringify(draft),
      ],
    )
    return result.rowCount === 1
  }

  /**
   * Claim at most `claimLimit` due actions, and never more than the UTC day's
   * remaining budget (R10/KTD7). The budget arithmetic runs inside an advisory
   * lock so two overlapping runs cannot both read the same remainder.
   *
   * Deliberate divergence from `support_research.claimDueActions`: there is NO
   * retry-window expiry here. R10 requires an over-budget finding to wait for a
   * later day's budget rather than age out, so nothing is silently dropped.
   */
  async claimDueActions(input: {
    dailyLimit: number
    claimLimit: number
    dayStart: Date
    token: string
    expiresAt: Date
    now: Date
  }): Promise<DueTriageAction[]> {
    if (input.dailyLimit <= 0 || input.claimLimit <= 0) return []
    const result = await this.database.query<{
      idempotency_key: string
      payload: unknown
      attempts: number
    }>(
      `with effective_clock as (
         select greatest($3::timestamptz, now()) as at
       ), budget_lock as (
         select pg_advisory_xact_lock(
           hashtext('forge_datadog_triage_action_budget')
         )
       ), candidates as (
         select action.idempotency_key
           from datadog_triage.actions action
           cross join budget_lock
           cross join effective_clock
          where (
            action.state in ('pending', 'retryable')
            and action.next_attempt_at <= effective_clock.at
          ) or (
            action.state = 'processing'
            and action.processing_expires_at < effective_clock.at
          )
          order by action.next_attempt_at, action.created_at
          limit least(
            $6,
            greatest(
              0,
              $1 - (
                select count(*)::integer
                  from datadog_triage.actions reserved
                 where (
                   reserved.state = 'created'
                   and reserved.terminal_at >= $4
                 ) or (
                   reserved.state = 'deduplicated'
                   and reserved.remote_create_attempted_at >= $4
                 ) or (
                   reserved.state = 'processing'
                   and reserved.updated_at >= $4
                 )
              )
            )
          )
          for update of action skip locked
       )
       update datadog_triage.actions
          set state = 'processing',
              processing_token = $2,
              processing_expires_at = $5,
              attempts = attempts + 1,
              updated_at = now()
        where idempotency_key in (select idempotency_key from candidates)
       returning idempotency_key, payload, attempts`,
      [
        input.dailyLimit,
        input.token,
        input.now,
        input.dayStart,
        input.expiresAt,
        input.claimLimit,
      ],
    )
    return result.rows.map((row) => ({
      idempotencyKey: row.idempotency_key,
      draft: triageActionDraftSchema.parse(row.payload),
      attempts: Number(row.attempts),
    }))
  }

  async countDueActions(now: Date): Promise<number> {
    const result = await this.database.query<{ count: number }>(
      `select count(*)::integer as count
         from datadog_triage.actions
        where state in ('pending', 'retryable')
          and next_attempt_at <= greatest($1::timestamptz, now())`,
      [now],
    )
    return Number(result.rows[0]?.count ?? 0)
  }

  async markActionCreated(input: {
    idempotencyKey: string
    token: string
    issueId: string
    issueUrl: string
  }): Promise<void> {
    await this.finishAction(input, "created")
  }

  async markActionDeduplicated(input: {
    idempotencyKey: string
    token: string
    issueId: string
    issueUrl: string
  }): Promise<void> {
    await this.finishAction(input, "deduplicated")
  }

  async markActionMutationAttempted(input: {
    idempotencyKey: string
    token: string
  }): Promise<void> {
    const result = await this.database.query(
      `update datadog_triage.actions
          set remote_create_attempted_at = coalesce(
                remote_create_attempted_at,
                now()
              ),
              updated_at = now()
        where idempotency_key = $1
          and processing_token = $2
          and state = 'processing'`,
      [input.idempotencyKey, input.token],
    )
    if (result.rowCount !== 1) {
      throw new TriageClaimLostError(input.idempotencyKey)
    }
  }

  private async finishAction(
    input: {
      idempotencyKey: string
      token: string
      issueId: string
      issueUrl: string
    },
    state: "created" | "deduplicated",
  ): Promise<void> {
    const result = await this.database.query(
      `update datadog_triage.actions
          set state = $3,
              linear_issue_id = $4,
              linear_issue_url = $5,
              processing_token = null,
              processing_expires_at = null,
              terminal_at = now(),
              updated_at = now()
        where idempotency_key = $1
          and processing_token = $2
          and state = 'processing'`,
      [input.idempotencyKey, input.token, state, input.issueId, input.issueUrl],
    )
    if (result.rowCount !== 1) {
      throw new TriageClaimLostError(input.idempotencyKey)
    }
  }

  async markActionRetryable(input: {
    idempotencyKey: string
    token: string
    errorCode: string
    nextAttemptAt: Date
    terminal: boolean
  }): Promise<void> {
    const result = await this.database.query(
      `update datadog_triage.actions
          set state = $3,
              last_error_code = $4,
              next_attempt_at = $5,
              processing_token = null,
              processing_expires_at = null,
              terminal_at = case when $3 = 'terminal' then now() else null end,
              updated_at = now()
        where idempotency_key = $1
          and processing_token = $2
          and state = 'processing'`,
      [
        input.idempotencyKey,
        input.token,
        input.terminal ? "terminal" : "retryable",
        input.errorCode.slice(0, 80),
        input.nextAttemptAt,
      ],
    )
    if (result.rowCount !== 1) {
      throw new TriageClaimLostError(input.idempotencyKey)
    }
  }
}

function assertNoMissingActions(missing: string[] | null | undefined): void {
  if (missing && missing.length > 0) {
    throw new TriageWriteOrderingError(missing)
  }
}
