# Top Shelf API interception verification

## Scope

Verify the unchanged `codex/tv-selected-improvements` application at
`14f4804a1c6c618a650416829b1e99ff605712b5` with selectable local API fixtures on a
separate Apple TV 4K simulator. This extends feat-630's verification, not its
product implementation. No admin content, public API, schema, player behavior or
push support changes are authorized by this test.

## Execution

Use the existing Debug simulator app and embedded Top Shelf extension; verify
artifact identity before installation. Keep the original simulator's preferences,
history and app data untouched. Use dedicated Metro 8099 and loopback proxy 8098.
Back up private local configuration byte for byte, verify the emitted endpoint
and actual proxy requests, and restore normal configuration/Metro after testing.

The fixture proxy serves local recommendation/bootstrap responses and only
forwards explicitly reviewed catalogue reads. Recommendation fixtures use
`requestId: null`, inert capabilities and real catalogue media identifiers,
destinations, durations and eligible artwork. It rejects other mutations instead
of returning fabricated accepted receipts. Logs omit credentials and payloads.

Root owns the QA simulator, configuration, evidence and documentation. Delegated
agents own disjoint ignored proxy/test files, UI helpers and independent review.
All scratch tools and artifacts live in `.local-tools/top-shelf-interception/`.

## Cases and acceptance

- Establish baseline Spotlight content from the normal app-to-snapshot path.
- Change titles/descriptions, long copy and verified same-film artwork.
- Use Collection to reorder position fields and remove real items.
- Test empty/invalid fixtures and distinguish their fallback from transport errors.
- Inject HTTP failure/timeout, verify the last unexpired snapshot, then recover.
- Reselect a style in beta Settings and inspect actual Apple TV system Home.
- Change fixtures while backgrounded and separately terminated; observe each for
  60 seconds before reopening. Report lack of refresh separately from a failed
  foreground refresh; no push capability is manufactured by interception.
- Exercise eligible Short/Journey content. Fresh Continue Watching must fall back
  honestly without fabricated history. Record cache-blocked updates before any
  explicitly labelled QA-only cache reset.
- Confirm changed cards retain their real destinations and inspect native
  Play/More Info where reachable. Existing unverified player-control checks stay
  separate from this exercise.

Record fixture revisions, request/snapshot/display times, native screenshots,
short captioned silent clips and an outcome table. A response or snapshot alone
does not prove visible system Top Shelf. Retain failed attempts and use the
development harness's bounded repair limit. Keep feat-630 in progress for any
broader distribution or platform gates this test does not cover.

## Result

Verification completed on October 19. The application and branch HEAD remain
unchanged. The local tool, selectable fixtures, UI drivers and evidence are in
`.local-tools/top-shelf-interception/`; no admin or schema changes were made.

The outcome table and limitations are appended to
`docs/tv-system-home-validation-2026-10-02.md`. Open
`.local-tools/top-shelf-interception/deliverables/index.html` for the captioned
silent clips and before/after evidence. Detailed observations and timing are in
`runtime-summary.md` and `metrics.json` beside that directory.

Foreground content changes, filtering, transport retention/recovery, native
More Info and actual Play destinations were observed. The two closed-app windows
did not refresh. Journey required reopening; persistent Continue metadata required
an explicitly labelled QA-only catalogue-cache reset. These are reported limits,
not product fixes. Real viewing history was preserved during that reset.

The unchanged app passed TV typecheck, lint and Jest; proxy v2 passed all 12 tests.
There were 65 UI executions: 62 succeeded and three initial automation failures
remain archived with successful focused follow-ups. The harness records the five
task acceptance observations separately from the broader performance gate:
matched launch-performance samples were not collected, so this is not an
unqualified all-gates or release-readiness pass.

QA harness run:
`apps/tv/test-results/development-harness/top-shelf-api-interception-0b334a1d-0e94-4510-84e9-9cb9de8d8d43`.
Its source digest binds the temporary QA endpoint, before restoration. The
separate ignored `cleanup.json` records the actual endpoint/configuration restore,
normal Metro verification and isolated simulator shutdown. Do not reuse the QA
configuration digest as evidence for the restored normal API.
