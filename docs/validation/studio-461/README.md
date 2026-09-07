# Studio calendar validation — local implementation

Local calendar implementation and the actual scheduled publication → Watch → unpublish → exact retry chain are verified against reviewed final feat-460. See `integration/README.md` for exact bindings, tests, retained failures and review outcomes. Overall acceptance remains **incomplete** because performance findings and external/provider qualifications remain open; no paid generation or deployment is represented here.

## Current built browser evidence

Task-owned Postgres on loopback port 55461, Admin 3462, Manager 3461, Mastra 3465; disposable task keys and a loopback model protocol fixture on 3466. The native process rejects non-loopback fetches. Chromium 152.0.7977.64, desktop viewport 1440×1000. Synthetic operator and source fixtures only.

- `browser/calendar-browser.json`: initial built Manager/Admin flow; explicit IANA validation, current/following 14-day windows, persisted human overrides and standalone-project linking, weekly override protection, missing-source production rejection.
- `browser/calendar-native-browser.json` and `calendar-native.png`: subsequent clean built Manager/Admin/Mastra flow; corrected breadcrumb/action/date/validation labels, default-collapsed weekly settings, native profile inspection/save/activation, signed empty-pack planning resulting in UNCHANGED, override preservation.
- `browser/calendar-guidance-browser.json` and `model-fixture.jsonl`: guidance-only assigned pack produced a persisted title/theme through the native OpenAI-compatible protocol. Request had zero tools; exact admitted pack/date and empty source indices returned. Source eligibility remained missing/unready. This verifies wiring and source boundaries, not model quality. Explicit manual planning deliberately admits gaps in both fortnights; automatic planning has a separate following-fortnight admission guard.

The browser found and reproduced a real built-runtime issue: Hono replaces global `Response`, while static `Response.json()` can return the original constructor. An `instanceof Response` discriminator mistakenly proceeded into generation after instruction inspection. Runtime now returns an explicit response/execution tag. A real-native-database regression models the constructor mismatch (400 before, 200 after), and clean rebuilt browser inspection/activation/planning passes. Temporary generated-bundle diagnostic logging was removed by the clean rebuild.

The first guidance test clicked settings before the initial asynchronous read settled; that read reset the toggle. Settings is now disabled during initial loading; the rebuilt browser check passes in `browser/calendar-final-smoke.json`.

## Remaining acceptance gates

- Independent fixed-base Standards and Spec source reviews cleared the original calendar and final integrated corrections. The original `review/` checkpoint is preserved; final local evidence and delta review are under `integration/`.
- Page-loading acceptance remains unresolved. Earlier create-cold +59.1 ms/script +13.1 ms is retained under `loading/`; the bounded calendar-only comparison improves controls-ready medians but adds +12.680 ms cold script time. No blanket performance pass or further measurement round is claimed.
- Actual Mux/provider, creative/ElevenLabs, production topology and deployment acceptance are not established by owned loopback protocol fixtures.
- The full Admin test run exposed an existing test reaching default Redis6379; its expiring shared counter may have been touched. No shared inspection/cleanup occurred. Explicit socket-guard preflight and isolated reruns are retained as a qualification incident, not a clean isolated full-run claim.
- Final root acceptance, including these limitations, remains outstanding. The ticket stays in progress rather than claiming complete release acceptance.

### Durable workflow discovery diagnosis

The installed `@workflow/next` 4.0.3 builder discovers `pages/app/src/pages/src/app` imports. Its current options do not consume the older `workflows.dirs` configuration. A timer referenced solely from instrumentation was absent from emitted workflow registration. A direct builder-discovery check reproduced the absence and passed after adding a side-effect discovery import in the authenticated calendar worker route. This import defines the workflow but does not start it or widen route authorization. A calendar-only postbuild check now requires both scheduler and tick IDs in the generated manifest and executable routes. Generated registration and actual timer/restart evidence pass. The automatic input contained only following-fortnight dates; the human-owned first future slot was excluded. No model request was replayed after restart.

The existing search-trace-retention scheduler was also absent from the inspected generated bundle. It is outside feat-461 and was reported to root without changing its behavior. Changing the runtime target alone did not resolve calendar discovery; the initial target mismatch was a separate local setup issue.

### Explicit production and review

`production/calendar-production-browser.json` records one explicit single-target
request followed by one explicit two-target batch. Both used reviewed native
`proposeEdits` against synthetic source-backed drafts; no automatic planner tools
were involved. `production/calendar-review-browser.json` proves both drafts still
had revision 1 and no items before review, then navigates from the calendar to the
existing retained generation workflow, displays exact operations and explicitly
applies a proposal. `production/production-snapshot.json` records three successful
GENERATION attempts, one project at revision 2 after that human action, and the
other still at revision 1. No narration/render/publication attempts were created.

That browser path revealed an incorrect missing-source label for manually linked
projects. Planner provenance alone cannot describe a project's own selected
sources. The calendar read model now checks reference presence at each exact
project revision in one batched DB query, without transferring full documents or
fetching assets. The card says selected sources still need eligibility validation.
A real DB regression covers both selected pack source references and their removal
from the project. Rebuilt browser verification passes in `browser/calendar-final-smoke.json`.

Production PrismaPg exposed a raw VALUES integer/text mismatch missed by the engine-client fixture. Explicit casts pass the adapter red/green and rebuilt browser source-state smoke. Both source-backed projects now display selection without implying eligibility, while the source-less manual project remains unready. Browser launch initially hit shared /tmp inode exhaustion; a short, task-owned disk temp directory resolved it without shared cleanup.

### Interrupted production response and exact retry

`production/calendar-production-retry-browser.json` records actual built native
production against the owned protocol fixture. The browser transport deliberately
removed only the terminal batch marker after the server completed. UI reported
interruption and retained the exact confirmed envelope/selection. Retrying sent
identical JSON, reused the same attempt and made zero additional model requests;
the project remained revision 1. The consumed native claim surfaced an instruction
to inspect retained results instead of replaying generation. This verifies an
ambiguous response boundary, not provider quality or a new production request.

### Additional independent contract/transaction checks

Production-PrismaPg calendar database suite: nine tests pass after review corrections. Added transaction
checks preserve a previously retained envelope when cancellation wins, then reject
its publication; reauthorization uses a new slot version. A second connection
holds the actual slot row lock while publication waits. Advancing only server Date
past the immutable delivery deadline causes DELIVERY_EXPIRED after that lock is
released, with consumption rolled back. These are internal transaction fixtures,
not final readiness/provider/publication acceptance.

A red/green contract test exposed that 16 legal default packs plus a separate slot
assignment exceeded the previous total-context pack count of 16. The context now
allows up to 43 (16 defaults for one slot and distinct assignments for the other
27). The independent 192 KiB serialized context limit is unchanged and tested.
No material is silently dropped and no missing source eligibility is invented.

### Weekly suggestions and confirmed rejection recovery

Independent review added strictly admitted complete-week theme suggestions.
Automatic runs retain the following-fortnight boundary; partial weeks are omitted.
Immutable provenance records the selected pack without changing effective pack
assignments. Human weekly settings and pack-only slot edits after admission win.
The Manager production UI can refresh a definitively rejected stale selection;
ambiguous completion retains its exact envelope. Original findings, red/green
regressions and independent follow-ups are retained in `review/`.

Final bounded review and built follow-ups now pass (`review/README.md`): weekly
provenance/override protection, confirmed rejection recovery, exact ambiguous
retry, and terminal production status refresh. Both independent axes have zero
remaining findings at that checkpoint. Final publication integration now passes locally
in `integration/`; the performance and external qualifications above remain open.
