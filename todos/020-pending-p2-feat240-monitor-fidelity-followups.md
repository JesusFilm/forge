---
status: pending
priority: p2
issue_id: "020"
title: feat-240 fleet-ceiling monitors — fidelity hardening (liveness, UDP loss, token drift)
labels:
  - infra
  - observability
  - datadog
  - feat-240
created_at: 2026-07-16
---

# Problem

The feat-240 fleet-ceiling Datadog monitors (`infra/datadog-monitors/`, PR #1591)
ship three log-alert monitors keyed on once-per-window equality events delivered
over lossy syslog-UDP, with `notify_no_data:false`. A ce-code-review adversarial
pass surfaced three fidelity gaps where a monitor can stay green while the real
condition is red. None block merge (alert-first, `enforce=false`), but each
weakens the alerting the abuse ceiling depends on.

# Why It Matters

These monitors ARE the calibration + abuse instrument for the fleet search
ceiling. If they go green-while-blind, an operator flips
`FLEET_SEARCH_CEILING_ENFORCE=true` trusting signals that can silently fail — the
exact failure the spec's §1 precondition warns about.

# Evidence

- `notify_no_data:false` on m1/m2/m3 → a total admin-logging / pipeline outage
  reads identical to healthy; nothing alarms on pipeline liveness.
- `.exceeded` / `.near` fire exactly once per 60s window at an equality
  (`count==ceiling+1` / `==floor(ceiling*0.8)`) in
  `apps/admin/src/auth/fleet-ceiling.ts`; the transport is syslog-UDP:514 (lossy).
  A single dropped packet loses that window's alert with no re-fire. (Sustained
  abuse re-crosses the next window, so this bites transient single-window spikes,
  not ongoing abuse.)
- No guard binds the monitors' `event=fleet_ceiling.*` query substrings to the
  emitter literals; a future rename compiles green and silently breaks the monitor.

# Proposed Fix

1. **Pipeline-liveness monitor.** Add a no-data / log-volume monitor on
   `service:forge-admin` (e.g. `[search]`-line count over 15m), OR set
   `notify_no_data:true` on one existing monitor, so pipeline death alarms.
2. **Guaranteed capture.** Back `.exceeded` / `.near` with a metric or log-COUNT
   threshold (`>= 1` over the window) rather than the single equality event, so a
   dropped UDP packet doesn't lose the signal.
3. **Token-drift guard.** Add a CI check (grep the `event=fleet_ceiling.*`
   literals in `fleet-ceiling.ts` against the monitor JSON), or a shared constant,
   so a renamed event token fails loudly instead of silently.

# Acceptance Criteria

- A pipeline-liveness signal alarms when `service:forge-admin` stops logging.
- A single dropped log line cannot permanently hide a real over-ceiling event.
- A renamed `event=` token in `fleet-ceiling.ts` fails CI instead of silently
  breaking a monitor.
- (Tracked here) M4 `degraded` / M5 `error` monitors added — the currently
  deferred Redis-degradation coverage the spec recommends.
