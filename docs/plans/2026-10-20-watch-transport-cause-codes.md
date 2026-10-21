# Retain safe transport cause codes in Watch error logs

Tracking: feat-750 / FGE-293. Owner: Tatai.

## Evidence and scope

During the production verification of PR 2818, English inventory request
`a4d4c9fe8a97affb` returned an upstream 500 at 2026-10-20 03:03:22 UTC; the
legacy fallback returned 404. Datadog trace
`6ad6d9fa0000000013358a2cff05074d` identifies an unsuccessful fetch to Admin
GraphQL. Four correlated console records retain only `TypeError: fetch failed`.
`inspectArgument` in `apps/web/src/observability/datadog-logs.ts` formats an
Error as its stack/message, dropping its nested cause codes.

Retain only allowlisted transport codes from a bounded traversal of own data
properties. Cover ordinary causes and AggregateError members; ignore getters,
unknown codes, raw cause messages, addresses, URLs, headers and bodies. Preserve
the existing stack and trace correlation. Add no request retries, deadlines,
network calls or production configuration changes. This repairs a diagnostic
gap; it does not establish or fix the cause of the Admin transport failure.

Related Core PR 9899 and Forge PRs 2622, 2628 and 2816 remain separate and do not
change this formatter. No overlapping cause-log repair was found in the open
PR search. Keep feat-750 in progress.

## Verification

1. Observe the new nested-code regression failing against the original source.
2. Check nested and aggregate codes, secret omission, cycles, traversal limits,
   hostile getters/proxies and unchanged output when no safe code exists.
3. Run the observability tests, Web typecheck, scoped lint, explicit Markdown
   formatting and normal commit hooks; inspect the final diff.
4. Prepare a reviewable PR assigned to Tatai. No merge or deployment. After an
   authorized rollout, a future transport failure must retain its safe code
   before a retry, DNS or connection-policy repair can be justified.

## Validation and limits

Three new code-retention cases failed against the original formatter; the
privacy, unchanged-output and traversal-limit controls already passed. With
the repair, the observability suite passes 52 tests across four files. Web
typecheck passes. The forwarding test also checks that the code reaches the
syslog payload with the original trace/span IDs and without cause content.

The formatter inspects at most eight queued cause/member entries. It follows
own data properties without evaluating getters, deduplicates allowlisted
codes, and puts them on the existing first stack line before the existing
syslog size limit can cut off later frames. Unknown codes and deeper causes
are intentionally omitted. Ordinary strings, objects and errors without a safe
code retain their existing formatting. The original Error is never changed.

This error-only formatting path adds no network requests, timers, imports or
successful-page render work. No browser or production-performance clearance is
claimed for the follow-up; the separate 60-minute verification of deployed
PR 2818 remains in progress. A future failure must still be captured after
owner review and an authorized rollout before its network cause is known.
