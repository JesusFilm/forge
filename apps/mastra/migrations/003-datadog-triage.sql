create schema if not exists datadog_triage;

-- One row per hourly sweep, keyed by the UTC hour. The lease serializes runs
-- that SHARE a run_key (a retry, a double-fire) rather than all concurrent
-- runs; an expired lease can be taken over.
create table if not exists datadog_triage.runs (
  run_key text primary key,
  status text not null check (
    status in ('running', 'complete', 'partial', 'disabled', 'failed')
  ),
  window_start timestamptz not null,
  window_end timestamptz not null,
  lease_token text,
  lease_expires_at timestamptz,
  counters jsonb not null default '{}'::jsonb
    check (jsonb_typeof(counters) = 'object'),
  report jsonb,
  partial_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  check (window_end >= window_start)
);

-- Per-source cursor (KTD2). `source` is `<kind>:<service>`, e.g.
-- `issue:forge-mobile`, so a failed source's window is retried next run while
-- healthy sources move on. `last_success_at` is the runbook's liveness signal.
create table if not exists datadog_triage.cursors (
  source text primary key,
  cursor_at timestamptz not null,
  last_success_at timestamptz,
  updated_at timestamptz not null default now()
);

-- F3: a service's first covered run records its baseline and files nothing.
create table if not exists datadog_triage.service_baselines (
  service text primary key,
  seeded_at timestamptz not null,
  created_at timestamptz not null default now()
);

-- Error Tracking dedup state (KTD6). `epoch` increments when a baselined
-- issue's windowed activity regresses past the configured multiplier, which is
-- the only way a closed ticket's issue may be ticketed again (R8/R14).
create table if not exists datadog_triage.seen_issues (
  issue_id text primary key,
  service text not null,
  epoch integer not null default 0 check (epoch >= 0),
  baseline_rate double precision not null default 0
    check (baseline_rate >= 0),
  last_activity_at timestamptz not null,
  first_seen_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Monitor episode identity plus the cooldown that stops a flapping monitor
-- from storming the daily budget (KTD6).
create table if not exists datadog_triage.monitor_states (
  monitor_id text primary key,
  service text not null,
  overall_state text not null,
  last_episode_started_at timestamptz,
  last_ticketed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Trailing baseline for the bounded log/RUM spike check, with the per-service
-- cooldown mirroring the monitor cooldown (KTD6).
create table if not exists datadog_triage.spike_baselines (
  service text not null,
  spike_class text not null,
  baseline_rate double precision not null default 0
    check (baseline_rate >= 0),
  observations integer not null default 0 check (observations >= 0),
  -- Ticketed-episode counter. Without it a spike's idempotency key would
  -- have to embed a timestamp, and a re-read would mint a duplicate.
  epoch integer not null default 0 check (epoch >= 0),
  last_ticketed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (service, spike_class)
);

-- Ticket outbox (KTD7). The idempotency key is the primary key, so a re-run
-- that re-processes the same signal enqueues nothing new.
create table if not exists datadog_triage.actions (
  idempotency_key text primary key,
  service text not null,
  signal_kind text not null check (
    signal_kind in ('issue', 'monitor', 'spike')
  ),
  signal_id text not null,
  epoch integer not null default 0 check (epoch >= 0),
  state text not null check (
    state in (
      'pending', 'processing', 'retryable', 'created', 'deduplicated',
      'terminal'
    )
  ),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  attempts integer not null default 0 check (attempts >= 0 and attempts <= 20),
  next_attempt_at timestamptz not null default now(),
  processing_token text,
  processing_expires_at timestamptz,
  linear_issue_id text,
  linear_issue_url text,
  remote_create_attempted_at timestamptz,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  terminal_at timestamptz
);

create index if not exists datadog_triage_actions_due_idx
  on datadog_triage.actions (next_attempt_at, created_at)
  where state in ('pending', 'retryable');

-- The claim CTE ORs a second branch: recovering an action whose lease expired
-- mid-dispatch. The index above cannot serve it, and this table has no purge
-- path, so without this one that branch scans the whole table forever.
create index if not exists datadog_triage_actions_processing_idx
  on datadog_triage.actions (processing_expires_at)
  where state = 'processing';

-- The claim also counts what today's budget already spent, across three OR
-- branches. `created` and `deduplicated` are terminal states that accumulate
-- forever with no purge path, so without these two the count scans the table's
-- entire history on every claim, twice an hour, growing without bound.
create index if not exists datadog_triage_actions_reserved_created_idx
  on datadog_triage.actions (terminal_at)
  where state = 'created';

create index if not exists datadog_triage_actions_reserved_deduplicated_idx
  on datadog_triage.actions (remote_create_attempted_at)
  where state = 'deduplicated';

create index if not exists datadog_triage_actions_signal_idx
  on datadog_triage.actions (signal_kind, signal_id, epoch);
