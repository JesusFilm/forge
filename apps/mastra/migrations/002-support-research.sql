create schema if not exists support_research;

create table if not exists support_research.cursors (
  source text primary key,
  created_at_cursor timestamptz not null,
  updated_at timestamptz not null default now()
);

create table if not exists support_research.runs (
  run_key text primary key,
  status text not null check (
    status in ('running', 'complete', 'partial', 'disabled', 'failed')
  ),
  dry_run boolean not null default false,
  cursor_start timestamptz not null,
  cursor_progress timestamptz not null,
  cutoff timestamptz not null,
  lease_token text,
  lease_expires_at timestamptz,
  counters jsonb not null default '{}'::jsonb
    check (jsonb_typeof(counters) = 'object'),
  report jsonb,
  partial_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  check (cursor_progress >= cursor_start),
  check (cutoff >= cursor_start)
);

create index if not exists support_research_runs_status_lease_idx
  on support_research.runs (status, lease_expires_at);

create table if not exists support_research.observations (
  source_system text not null check (source_system = 'help_scout'),
  source_id text not null,
  mailbox_id text not null,
  source_created_at timestamptz not null,
  source_url text,
  fingerprint text not null check (fingerprint ~ '^[0-9a-f]{64}$'),
  theme_key text not null,
  feedback_kind text not null check (
    feedback_kind in ('bug', 'usability', 'need', 'other')
  ),
  surface text not null,
  relevant boolean not null,
  validation_state text not null check (
    validation_state in ('not_attempted', 'confirmed', 'unverified', 'blocked')
  ),
  sanitized_payload jsonb not null check (jsonb_typeof(sanitized_payload) = 'object'),
  analysis_payload jsonb not null check (jsonb_typeof(analysis_payload) = 'object'),
  validation_payload jsonb not null check (jsonb_typeof(validation_payload) = 'object'),
  analyzed_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (source_system, source_id)
);

create index if not exists support_research_observations_cluster_idx
  on support_research.observations (
    fingerprint,
    source_created_at desc
  ) where relevant;

create index if not exists support_research_observations_theme_idx
  on support_research.observations (
    surface,
    theme_key,
    source_created_at desc
  ) where relevant;

create table if not exists support_research.actions (
  idempotency_key text primary key,
  fingerprint text not null check (fingerprint ~ '^[0-9a-f]{64}$'),
  action_type text not null check (
    action_type in ('confirmed_bug', 'needs_validation', 'ux_improvement', 'daily_summary')
  ),
  state text not null check (
    state in ('pending', 'processing', 'retryable', 'created', 'deduplicated', 'terminal', 'dry_run')
  ),
  proposed_issue jsonb not null check (jsonb_typeof(proposed_issue) = 'object'),
  attempts integer not null default 0 check (attempts >= 0 and attempts <= 20),
  next_attempt_at timestamptz not null default now(),
  processing_token text,
  processing_expires_at timestamptz,
  linear_issue_id text,
  linear_issue_url text,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  terminal_at timestamptz
);

create unique index if not exists support_research_actions_live_fingerprint_idx
  on support_research.actions (fingerprint, action_type)
  where state <> 'dry_run';

create index if not exists support_research_actions_due_idx
  on support_research.actions (next_attempt_at, created_at)
  where state in ('pending', 'retryable');

create table if not exists support_research.action_sources (
  idempotency_key text not null references support_research.actions(idempotency_key) on delete cascade,
  source_system text not null,
  source_id text not null,
  primary key (idempotency_key, source_system, source_id),
  foreign key (source_system, source_id)
    references support_research.observations(source_system, source_id)
    on delete restrict
);

create table if not exists support_research.reports (
  run_key text primary key references support_research.runs(run_key) on delete cascade,
  status text not null,
  report jsonb not null check (jsonb_typeof(report) = 'object'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists support_research_reports_expiry_idx
  on support_research.reports (expires_at);
