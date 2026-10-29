# feat-907 automation foundation review repairs

Scope: repair the five independent foundation findings against `fc834bedf` and
`a810975c7`, preserving the source pipeline, Mastra graph, CAS revision and PR870
manual dry-run contracts. This isolated checkout starts at `af426afd5`; PR870 is a
local prerequisite only. Root owns OAuth, schema/generated output, Docker and PR
integration. No nested agents, provider calls, pushes, merges or deployments.

1. Reproduce committed no-ID bootstrap starvation, runtime-ID persistence failure,
   locked-parent lease replacement, scheduler-disabled manual expiry and DST
   timestamps in the past.
2. Inspect installed Workflow `start`/World code. Persist its actual generated
   identity before runtime effects, retain ambiguous starts for reconciliation,
   resume partial starts using the same ID, and retire delayed timers explicitly.
3. Lock a requested manual parent before expiry recovery and claim only cleared
   leases. Let that transaction decide manual admission; preserve live rejection,
   terminal idempotency replay, run binding and read-only report semantics.
4. Resolve wall-clock schedules by round trip through real IANA zones. Skip
   nonexistent occurrences and choose the earliest strictly future fold instant.
5. Verify with disposable PostgreSQL on port 55932, actual SDK start plus a
   deterministic World adapter, both Manager routes, focused regression suites,
   full Admin/Manager types, touched lint/format and enabled Git hooks. Compound
   the recovery guarantees and limits in the existing solution document.

Evidence and handoff:
`docs/reports/2026-10-28-feat890-foundation-review-repairs.md`.
