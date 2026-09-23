# External-agent workflow implementation review

Review follows the approved specification and published roadmap, with independent
standards and specification axes. This record is incremental; passing a slice
review does not qualify the complete workflow or either client.

## Connection and render

Reviewed on 2026-09-23. Standards review covered `fdd34d12c...b1862e6bd`;
render specification review covered `0c0006abf...b1862e6bd`. Reviewers did not
implement the reviewed render slice. Both were static reviews; the test evidence
below was produced separately by implementation and integration runs.

| Axis          | Actionable findings | Scope                                                                        |
| ------------- | ------------------- | ---------------------------------------------------------------------------- |
| Standards     | 0                   | Connection/render conventions, authority, immutable records, tests           |
| Specification | 0                   | Render admission, retries, source preparation, exact output, human authority |

The specification review traced descriptor materialization through the trusted
broker, per-issued-lease immutable preparation, and winning admitted execution
selection at catalog/publication gates. It checked expired/stale behavior and
scoped output access. Exact review UI and full real-client qualification remain
later acceptance gates.

A nonblocking duplication observation concerns manifest validation in
`draft-render.ts` and `catalog.ts`; no behavior change was requested.

After integrating narration and resolving overlapping scope/tool contracts,
Manager typechecking passed, nine focused Manager tests passed, and fifteen
guarded real-Postgres render/narration/catalog tests passed. The commit hook's
lint-staged and repository-wide formatting check passed. Prisma was regenerated
for the combined model. No Pothos fields changed in these slices.

The connection slice also received a separate specification review of
`72d02d991...0c0006abf`, with zero actionable implementation findings. It checked
current Operator enforcement, same-environment URL resolution, recoverable
conflicts, actor/client-bound retry receipts, and canonical history pagination.

## Narration recovery

Independent specification/authority review identified one P1: a lost response
after paid audio retention could invoke `preflight-error` and terminalize a
successful attempt before attachment. A duplicate runner's context failure could
also terminate another runner's live attempt.

Fix `1cef7c108` (integrated as `abdf03264`) replaces this path with bounded,
deduplicated reconciliation observations. It preserves run, attempt, and claim
ownership. Status exposes the diagnostic; retrying the original accepted request
can attach retained completed speech without another provider dispatch. Live or
ambiguous claims remain consumed, and already completed attachment stays intact.

An independent reviewer checked the fix, separate observation identities,
run-lock serialization, allowance accounting, and regression tests: zero
remaining actionable findings. Twelve real-Postgres tests passed again after
integration. The slice's eight fake-provider runner tests and Admin/Manager
typechecks passed. No paid provider call was used.

## Sampled inspection

Independent review found zero standards violations and one specification P2:
the original decoder deadline did not include context/asset-capability RPCs.
The fix propagates cancellation and bounds those calls, handles the broker's
earlier download timeout, and returns uncached incomplete evidence where exact
context is known. A failed final authority check remains fail-closed.

Final re-review found zero remaining findings on either axis. It checked exact
completed-output binding, immutable retention, decoder isolation, report size,
honest sampled-cut counts, and explicit retry after a stalled grant. Tests were
inspected by the reviewer; the implementer ran 16 Manager tests, 10 Admin DB
tests, 43 contract tests, and Admin/Manager typechecks. Six contained-render
fixtures separately measure rendering and evidence preparation; client reasoning
time is not established by those fixtures.

## CI integration correction

CI exposed a stale Auth seed test expectation of 29 scopes after the two explicit
consent scopes brought the count to 31. The full local Auth suite reproduced that
single failure. Updating the count and asserting both new scope records produced
587 passing tests; 99 environment-gated integration tests remained skipped.
Admin SDL and gql.tada regeneration produced no tracked drift.

## Human review and revision

Independent review found zero standards violations and one specification P2:
a definitive revision conflict needed an explicit way to discard a rejected
additional-narration authorization and obtain renewed consent against the current
revision. The fix preserves the original receipt after uncertain transport
failure, and permits discard only after a definitive rejection. The reviewer
independently ran four regression tests and cleared both axes. Metadata, playback,
and inspection requests also forward lifetime cancellation.

The coordinator separately exercised actual panel components with synthetic
canonical state and a contained-render MP4. Historical output remained identified
as revision 1 after canonical revision 2, with stale approval disabled. With a
fully loaded video, unsaved edits disabled both confirmation and approval. Clean
unchanged output enabled confirmation, while approval remained disabled until
explicit confirmation. No approval or publication was submitted. Three matched
warm load runs and the production dependency comparison are recorded in
`docs/validation/studio-546/README.md`; these do not establish authenticated
production UI qualification.

## Remaining review gates

Final integration, rebuilt-image validation and real-client qualification require
their own evidence before this record can establish completion. The later review
entries below supplement the earlier slice record; they do not close unavailable
Claude or authenticated human-browser acceptance.

## Portable skill and qualification infrastructure

Independent standards/specification review of the portable package found zero
actionable findings. The reviewer checked examples against actual operations,
relative archive references, narration limits, human-edit preservation and modality
claims. Two Manager package/schema tests, one Admin operation-engine test, both
typechecks, scoped lint and the Manager production build passed. The client
qualification snapshot matched the archive at that review point. A later final
specification review found one P2 in the first-draft skill summary: it listed
`narrationQuote` before persisting speech, even though the authoring reference
and actual Codex run applied the composition first. The shipped summary now
requires apply/read, then quote/status, then narration attachment and exact
revision rendering. Deterministic packaging and both operation/schema tests
passed for the rebuilt 28,788-byte archive. The prior full client run used the
28,510-byte version. The separate actual Codex rerun with the corrected bytes is
recorded in `final-skill-replay.md`; it confirms the repaired instruction order,
three exact renders and feedback with no second narration dispatch.

Independent harness safety review found and cleared one P2: an output directory
symlink could resolve exactly to the checkout root. Fresh private directory
creation and canonical equality/descendant checks now reject it. The reviewer
also checked isolated database admission, outbound network denial, exact fake
provider interception, renderer containment and secret handling. Two guard
regressions passed again after integration.

## Render failures discovered by real-client qualification

The actual Codex composition exposed intermediate audio commands that bypassed
the final encoder's thread settings. A contained replay reproduced FFmpeg
`pthread_create` failure. An opt-in patch to the pinned renderer now bounds every
input decoder, encoder and filter pool. Both module formats load, and actual
subprocess argument tests cover enabled, ordinary and probe behavior.

Further replay showed rendering and stdout streaming finished but a replacement
browser remained alive after crash recovery. The installed SDK's lifecycle test
fails before the patch (closing the original browser twice) and passes afterward
(closing the replacement), while preserving caller-owned browser behavior.
The trusted child also enables the SDK's existing non-surface capture mode within
its supported dimensions to avoid observed Chromium surface-copy failures.

Independent review cleared all three fixes without weakening containment. The
original 1080×1920, 300-frame composition then rendered in 98.670 seconds, passed
independent full codec decoding and matched the prior completed-but-unretained
MP4 byte-for-byte. Four focused regressions and a frozen offline install passed
again after integration. Rebuilt-image qualification remains a separate gate.

An independent transport fix removes global fetch's shorter implicit header
timeout from private executor requests. Native HTTP retains the caller's overall
abort deadline, fixed-origin validation, redirect denial and bounded output.
Eight real HTTP/signed-transport tests passed, as did types, build and independent
review. A delayed-header differential reproduced the old timeout and succeeded
with the new transport; it does not substitute for a full-duration render test.
