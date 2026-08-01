import type { QueryResult, QueryResultRow } from "pg"

import {
  storedSupportObservationSchema,
  supportActionDraftSchema,
  supportRunReportSchema,
  type StoredSupportObservation,
  type SupportActionDraft,
  type SupportActionType,
  type SupportRunCounters,
  type SupportRunReport,
} from "./schema"

export type SupportResearchQueryable = {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<T>>
}

export type RunClaim =
  | { claimed: true; cursorStart: Date }
  | { claimed: false; status: string }

export type DueSupportAction = {
  idempotencyKey: string
  draft: SupportActionDraft
  attempts: number
}

export interface SupportResearchRepository {
  getCursor(source: string, fallback: Date): Promise<Date>
  claimRun(input: {
    runKey: string
    dryRun: boolean
    cursorStart: Date
    cutoff: Date
    leaseToken: string
    leaseExpiresAt: Date
  }): Promise<RunClaim>
  recordObservation(observation: StoredSupportObservation): Promise<boolean>
  getObservation(
    sourceId: string,
  ): Promise<StoredSupportObservation | undefined>
  updateProgress(input: {
    runKey: string
    leaseToken: string
    cursor: Date
    counters: SupportRunCounters
  }): Promise<void>
  listThemeObservations(input: {
    surface: string
    themeKey: string
    since: Date
    limit: number
  }): Promise<StoredSupportObservation[]>
  enqueueAction(draft: SupportActionDraft, dryRun: boolean): Promise<boolean>
  claimDueActions(input: {
    limit: number
    actionTypes: SupportActionType[]
    createdSince: Date
    token: string
    expiresAt: Date
    now: Date
  }): Promise<DueSupportAction[]>
  countDueActions(input: {
    actionTypes: SupportActionType[]
    now: Date
  }): Promise<number>
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
  markActionRetryable(input: {
    idempotencyKey: string
    token: string
    errorCode: string
    nextAttemptAt: Date
    terminal: boolean
  }): Promise<void>
  finalizeRun(
    report: SupportRunReport,
    retentionDays: number,
    leaseToken: string,
  ): Promise<void>
  purgeExpired(now: Date, observationCutoff: Date): Promise<number>
}

type RunRow = { cursor_start: Date; status: string }

type ObservationRow = {
  sanitized_payload: unknown
  analysis_payload: unknown
  validation_payload: unknown
  fingerprint: string
  analyzed_at: Date
}

type ActionRow = {
  idempotency_key: string
  proposed_issue: unknown
  attempts: number
}

function parseObservationRow(row: ObservationRow): StoredSupportObservation {
  return storedSupportObservationSchema.parse({
    source: row.sanitized_payload,
    analysis: row.analysis_payload,
    validation: row.validation_payload,
    fingerprint: row.fingerprint,
    analyzedAt: row.analyzed_at.toISOString(),
  })
}

export class PostgresSupportResearchRepository implements SupportResearchRepository {
  constructor(private readonly database: SupportResearchQueryable) {}

  async getCursor(source: string, fallback: Date): Promise<Date> {
    const result = await this.database.query<{ created_at_cursor: Date }>(
      `select created_at_cursor
         from support_research.cursors
        where source = $1`,
      [source],
    )
    return result.rows[0]?.created_at_cursor ?? fallback
  }

  async claimRun(input: {
    runKey: string
    dryRun: boolean
    cursorStart: Date
    cutoff: Date
    leaseToken: string
    leaseExpiresAt: Date
  }): Promise<RunClaim> {
    const result = await this.database.query<RunRow>(
      `insert into support_research.runs (
         run_key, status, dry_run, cursor_start, cursor_progress, cutoff,
         lease_token, lease_expires_at
       ) values ($1, 'running', $2, $3, $3, $4, $5, $6)
       on conflict (run_key) do update
         set status = 'running',
             lease_token = excluded.lease_token,
             lease_expires_at = excluded.lease_expires_at,
             updated_at = now()
       where support_research.runs.status = 'running'
         and support_research.runs.lease_expires_at < now()
       returning cursor_start, status`,
      [
        input.runKey,
        input.dryRun,
        input.cursorStart,
        input.cutoff,
        input.leaseToken,
        input.leaseExpiresAt,
      ],
    )
    if (result.rows[0]) {
      return { claimed: true, cursorStart: result.rows[0].cursor_start }
    }

    const existing = await this.database.query<{ status: string }>(
      `select status from support_research.runs where run_key = $1`,
      [input.runKey],
    )
    return { claimed: false, status: existing.rows[0]?.status ?? "unknown" }
  }

  async recordObservation(
    observationInput: StoredSupportObservation,
  ): Promise<boolean> {
    const observation = storedSupportObservationSchema.parse(observationInput)
    const result = await this.database.query<{ source_id: string }>(
      `insert into support_research.observations (
         source_system, source_id, mailbox_id, source_created_at, source_url,
         fingerprint, theme_key, feedback_kind, surface, relevant,
         validation_state, sanitized_payload, analysis_payload,
         validation_payload, analyzed_at
       ) values (
         'help_scout', $1, $2, $3, $4, $5, $6, $7, $8, $9,
         $10, $11::jsonb, $12::jsonb, $13::jsonb, $14
       )
       on conflict (source_system, source_id) do nothing
       returning source_id`,
      [
        observation.source.sourceId,
        observation.source.mailboxId,
        observation.source.createdAt,
        observation.source.sourceUrl ?? null,
        observation.fingerprint,
        observation.analysis.themeKey,
        observation.analysis.kind,
        observation.analysis.surface,
        observation.analysis.relevant,
        observation.validation.state,
        JSON.stringify(observation.source),
        JSON.stringify(observation.analysis),
        JSON.stringify(observation.validation),
        observation.analyzedAt,
      ],
    )
    return result.rowCount === 1
  }

  async getObservation(
    sourceId: string,
  ): Promise<StoredSupportObservation | undefined> {
    const result = await this.database.query<ObservationRow>(
      `select sanitized_payload, analysis_payload, validation_payload,
              fingerprint, analyzed_at
         from support_research.observations
        where source_system = 'help_scout'
          and source_id = $1`,
      [sourceId],
    )
    return result.rows[0] ? parseObservationRow(result.rows[0]) : undefined
  }

  async updateProgress(input: {
    runKey: string
    leaseToken: string
    cursor: Date
    counters: SupportRunCounters
  }): Promise<void> {
    const result = await this.database.query(
      `update support_research.runs
          set cursor_progress = greatest(cursor_progress, $3),
              counters = $4::jsonb,
              updated_at = now()
        where run_key = $1
          and lease_token = $2
          and status = 'running'`,
      [
        input.runKey,
        input.leaseToken,
        input.cursor,
        JSON.stringify(input.counters),
      ],
    )
    if (result.rowCount !== 1)
      throw new Error("support research run lease lost")
  }

  async listThemeObservations(input: {
    surface: string
    themeKey: string
    since: Date
    limit: number
  }): Promise<StoredSupportObservation[]> {
    const result = await this.database.query<ObservationRow>(
      `select sanitized_payload, analysis_payload, validation_payload,
              fingerprint, analyzed_at
         from support_research.observations
        where relevant = true
          and surface = $1
          and theme_key = $2
          and source_created_at >= $3
        order by source_created_at desc, source_id desc
        limit $4`,
      [input.surface, input.themeKey, input.since, input.limit],
    )
    return result.rows.map(parseObservationRow)
  }

  async enqueueAction(
    draftInput: SupportActionDraft,
    dryRun: boolean,
  ): Promise<boolean> {
    const draft = supportActionDraftSchema.parse(draftInput)
    const storedIdempotencyKey = dryRun
      ? `dry-run:${draft.idempotencyKey}`
      : draft.idempotencyKey
    const result = await this.database.query<{ idempotency_key: string }>(
      `with inserted as (
         insert into support_research.actions (
           idempotency_key, fingerprint, action_type, state, proposed_issue
         ) values ($1, $2, $3, $4, $5::jsonb)
         on conflict do nothing
         returning idempotency_key
       ), linked as (
         insert into support_research.action_sources (
           idempotency_key, source_system, source_id
         )
         select inserted.idempotency_key, 'help_scout', source_id
           from inserted
           cross join unnest($6::text[]) as source_id
         on conflict do nothing
       )
       select idempotency_key from inserted`,
      [
        storedIdempotencyKey,
        draft.fingerprint,
        draft.type,
        dryRun ? "dry_run" : "pending",
        JSON.stringify(draft),
        draft.sourceIds,
      ],
    )
    return result.rowCount === 1
  }

  async claimDueActions(input: {
    limit: number
    actionTypes: SupportActionType[]
    createdSince: Date
    token: string
    expiresAt: Date
    now: Date
  }): Promise<DueSupportAction[]> {
    const result = await this.database.query<ActionRow>(
      `with effective_clock as (
         select greatest($4::timestamptz, now()) as at
       ), expired_actions as (
         update support_research.actions
            set state = 'terminal',
                last_error_code = 'retry_window_expired',
                processing_token = null,
                processing_expires_at = null,
                terminal_at = now(),
                updated_at = now()
           from effective_clock
          where action_type = any($5::text[])
            and state in ('pending', 'retryable')
            and created_at < effective_clock.at - interval '7 days'
          returning idempotency_key
       ), budget_lock as (
         select pg_advisory_xact_lock(
           hashtext('forge_support_research_action_budget')
         )
       ), candidates as (
         select action.idempotency_key
           from support_research.actions action
           cross join budget_lock
           cross join effective_clock
          where action.action_type = any($5::text[])
            and action.created_at >= effective_clock.at - interval '7 days'
            and (
              action.state in ('pending', 'retryable')
              and action.next_attempt_at <= effective_clock.at
            or (
              action.state = 'processing'
              and action.processing_expires_at < effective_clock.at
            )
          )
          order by action.next_attempt_at, action.created_at
          limit greatest(
            0,
            $1 - (
              select count(*)::integer
                from support_research.actions reserved
               where reserved.action_type = any($5::text[])
                 and (
                   reserved.state = 'created'
                   and reserved.terminal_at >= $6
                 or reserved.state = 'processing'
                   and reserved.updated_at >= $6
              )
            )
          )
          for update of action skip locked
       )
       update support_research.actions
          set state = 'processing',
              processing_token = $2,
              processing_expires_at = $3,
              attempts = attempts + 1,
              updated_at = now()
        where idempotency_key in (select idempotency_key from candidates)
       returning idempotency_key, proposed_issue, attempts`,
      [
        input.limit,
        input.token,
        input.expiresAt,
        input.now,
        input.actionTypes,
        input.createdSince,
      ],
    )
    return result.rows.map((row) => ({
      idempotencyKey: row.idempotency_key,
      draft: supportActionDraftSchema.parse(row.proposed_issue),
      attempts: row.attempts,
    }))
  }

  async countDueActions(input: {
    actionTypes: SupportActionType[]
    now: Date
  }): Promise<number> {
    const result = await this.database.query<{ count: number }>(
      `select count(*)::integer as count
         from support_research.actions
        where action_type = any($1::text[])
          and state in ('pending', 'retryable')
          and next_attempt_at <= greatest($2::timestamptz, now())`,
      [input.actionTypes, input.now],
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
      `update support_research.actions
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
    if (result.rowCount !== 1) throw new Error("support action claim lost")
  }

  async markActionRetryable(input: {
    idempotencyKey: string
    token: string
    errorCode: string
    nextAttemptAt: Date
    terminal: boolean
  }): Promise<void> {
    const result = await this.database.query(
      `update support_research.actions
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
    if (result.rowCount !== 1) throw new Error("support action claim lost")
  }

  async finalizeRun(
    reportInput: SupportRunReport,
    retentionDays: number,
    leaseToken: string,
  ): Promise<void> {
    const report = supportRunReportSchema.parse(reportInput)
    const terminalStatus =
      report.status === "already_running" ? "partial" : report.status
    const result = await this.database.query(
      `with finished as (
         update support_research.runs
            set status = $2,
                cursor_progress = $3,
                counters = $4::jsonb,
                report = $5::jsonb,
                partial_reason = $6,
                lease_token = null,
                lease_expires_at = null,
                completed_at = now(),
                updated_at = now()
          where run_key = $1
            and lease_token = $8
            and status = 'running'
          returning run_key
       ), cursor_advanced as (
         insert into support_research.cursors (source, created_at_cursor)
         select 'help_scout', $3 from finished
         on conflict (source) do update
           set created_at_cursor = greatest(
                 support_research.cursors.created_at_cursor,
                 excluded.created_at_cursor
               ),
               updated_at = now()
       )
       insert into support_research.reports (
         run_key, status, report, expires_at
       )
       select run_key, $2, $5::jsonb, now() + ($7 * interval '1 day')
         from finished
       on conflict (run_key) do update
         set status = excluded.status,
             report = excluded.report,
             expires_at = excluded.expires_at
       returning run_key`,
      [
        report.runKey,
        terminalStatus,
        report.cursorEnd,
        JSON.stringify(report.counters),
        JSON.stringify(report),
        report.partialReason ?? null,
        retentionDays,
        leaseToken,
      ],
    )
    if (result.rowCount !== 1)
      throw new Error("support research run lease lost during finalization")
  }

  async purgeExpired(now: Date, observationCutoff: Date): Promise<number> {
    const result = await this.database.query(
      `with expired_reports as (
         delete from support_research.reports
          where expires_at < $1
          returning run_key
       ), cleared_runs as (
         update support_research.runs
            set report = null,
                updated_at = now()
          where run_key in (select run_key from expired_reports)
          returning run_key
       ), minimized_actions as (
         update support_research.actions
            set proposed_issue = '{}'::jsonb,
                updated_at = now()
          where created_at < $2
            and state in ('created', 'deduplicated', 'terminal', 'dry_run')
            and proposed_issue <> '{}'::jsonb
          returning idempotency_key
       ), minimized_observations as (
         update support_research.observations
            set sanitized_payload = sanitized_payload
                  - 'excerpt'
                  - 'subject'
                  - 'sourceUrl'
                  - 'watchUrls',
                analysis_payload = analysis_payload
                  - 'reportedEvidence'
                  - 'expectedBehavior'
                  - 'actualBehavior'
                  - 'title'
                  - 'summary'
                  - 'inference',
                validation_payload = jsonb_build_object(
                  'state', 'not_attempted',
                  'evidence', '[]'::jsonb,
                  'missingProof', 'Expired by retention policy.'
                ),
                updated_at = now()
          where source_created_at < $2
            and (
              sanitized_payload ? 'excerpt'
              or sanitized_payload ? 'sourceUrl'
              or analysis_payload ? 'reportedEvidence'
              or analysis_payload ? 'summary'
            )
          returning source_id
       )
       select count(*)::integer as count from minimized_observations`,
      [now, observationCutoff],
    )
    return Number(
      (result.rows[0] as { count?: number } | undefined)?.count ?? 0,
    )
  }
}
