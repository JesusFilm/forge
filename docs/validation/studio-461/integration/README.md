# Calendar scheduling integration

Reviewed dependency base: `038f396e8b7f419ea7e9d969b11ad75b40191b78`.
Final460 root c6a9ec43 was incorporated once as8dc2d564; its docs correction
root aa4fc3d8 became038f396e. Prior calendar WIP was backed up byte-for-byte,
stashed and restored with explicit unions of Prisma models, interactive dispatch
and portable exports. No sibling WIP, fixtures, credentials or runtime services were reused. The
unintended default-port unit-test access remains separately qualified below.

## Actual local publication chain

The task-owned fixture is a five-second640×360 H264/AAC MP4, generated locally
from owned text and synthetic audio. Its actual full video/audio decode and
metadata verification used the reviewed codec binaries. The public codec archive
was supplied read-only; only the verified binaries were extracted into this task.
This is not another contained-renderer or actual Mux/provider acceptance run.

The initial fixture incorrectly used a language core ID where staging requires
its exact slug. A canonical `set-metadata` command created revision2 with
`english`; a new render admission/retention bound the same verified media bytes
to that revision. No immutable revision, approval or release was edited directly.
`render-review.json/png` records the built Manager playing that retained MP4 and
recording interactive approval. The editor reported “Preview requires a distinct
registrable site”; this proves the rendered-video review path, not fresh isolated
editor-canvas acceptance.

The built calendar linked the source-backed project, selected its exact approved
render, and saved interactive authorization for `2026-09-07T23:32:00.000Z`
(`2026-09-08 11:32 Pacific/Auckland`) through23:37Z. It did not lock the draft.
`schedule-authorized.json` contains that browser action. `scheduled-result.json`
is the retained **before-state**, DRAFT and unconsumed.

`scheduled-after-timer.json` records the separate real Postgres workflow timer
consuming authorization at23:32:12.340Z: dispatch ACCEPTED, attempts1, project
PUBLISHED, revision2. `protocol-requests.jsonl` has exactly one asset-observation
GET. Admin called authenticated Manager preparation, which observed the existing
same signed fixture asset, recorded fresh evidence, and returned the exact envelope
plus readinessId. Calendar persisted that envelope before the canonical publication
wrapper consumed authorization in the same transaction. No browser/manual publish
substitute was used. `timer-delivery.json` records the runtime identity and both
published/revoked canonical Watch delivery acknowledgements.

`watch-playback.json/png` shows the real built Watch page reaching readyState4 and
advancing through the canonical signed-proxy HLS master, media playlist and segment.
`watch-revocation.json` records all six issued resources200/private-no-store,
segment range206/128bytes and HEAD200/empty body. Actual built Manager **Unpublish
permanently** then made all six original URLs404/no-store while the original Watch
DOM and video remained open. Already delivered bytes cannot be revoked.

`scheduled-exact-retry.json` uses the actual stored envelope after that UI unpublish
and returns its original receipt: zero preparation calls, zero hook consumption,
identical authorization, unchanged UNPUBLISHED project. The five real-DB dispatcher
cases additionally cover a genuinely lost committed response, restart/retry,
cancellation during preparation, expired lease takeover and stale preparer fencing.

## Boundaries and retained failures

All services use owned loopback endpoints: Manager3461, Admin3462, login3463,
native3465, model fixture3466, Watch3467, signed-media fixture3468, Postgres55461
and Redis54619. Redis never fell back to6379. Runtime fetch/node request guards
reject non-loopback requests; only exact Mux host requests are rewritten to the
owned protocol fixture. The fixture rejects asset creation and verifies signed
playback tokens. No paid/provider, infrastructure or deployment action occurred.

The Watch optimizer500 is the guard rejecting an unrelated Unsplash image.
Recommendation/profile503s remain in request evidence. Zero browser page errors
is not an all-requests-success claim. `watch-first.json` retains a network-idle
harness timeout despite visible content. The corrected harness waits for actual
playback. `watch-revocation-selector-failure.*` retains the wrong “Unpublish” button
selector; it performed no unpublish. The corrected selector uses the actual label.
Shared/tmp inode exhaustion and the initial missing-RSA transaction fixture failure
are retained in their logs, not classified as product regressions. Browser and
child-process temp/cache paths use the owned rootfs directory.

## Integrated review and UI correction

Independent Standards and Spec reviewed frozen tree
`70d0b6606ad961e88b5998b3fd1b3898e56d8109` against038f396e. The original review
checkpoint under `../review` remains unchanged. Actionable integrated findings:

- Schedule dialog lacked the existing opaque panel and an accessible name.
- Definite stale authorization rejection did not refresh bindings and clear selection.
- Timer outcomes had no explicit refresh action on an open calendar.

The corrections reuse existing panel tokens, name the native modal, refresh after
definite rejection, require fresh selection/confirmation on binding change, and
provide calendar/dialog status refresh. Ambiguous requests remain retained.
`schedule-ui-delta.json/png` proves an actual concurrent configuration change
rejects the first authorization, the second explicitly confirmed request uses the
fresh version/key, and a lost successful cancellation response retries identical
JSON. `schedule-final-state.json/png` verifies current UNPUBLISHED/permanent-lock
state takes precedence over the historical accepted schedule, with no new
publication action. No publication was repeated for these UI checks.

## Bounded calendar-only loading comparison

`schedule-baseline-source.json` and the baseline build were captured before adding
the scheduling UI. Three alternating AB/BA rounds compare this preserved build
and the final built calendar on the same origin/backend/dataset. All12 cold/warm
samples, CPU profiles, resource waterfalls, long tasks, CLS, effective browser
paths and host load are retained. No own builds/tests overlapped measurements.
The timer was stopped; the dataset hash remained
`5cc70b4b7d0f5906097803eaa035f83f`. Final build restoration completed.

Controls-ready medians: cold517→485.8ms; warm384.8→349.1ms.
Script medians: cold110.277→122.957ms (+12.680ms); warm86.510→86.366ms.
CLS is zero throughout. Cold long tasks overlap67–78ms versus73–77ms; warm samples
contain one54ms long task per variant. Initial calendar loads make the same three
Studio command requests; the lazy schedule-dialog chunk is not fetched before
opening it. Resource counts40→38 reflect two fewer fetches, not extra scheduling
requests. The cold CPU difference remains a limitation of this bounded comparison;
there is no blanket performance pass and no further measurement round.

Earlier create-page cold+59.1ms/script+13.1ms remains unresolved in `../loading`.
This comparison neither repeats nor supersedes that result. External provider,
creative/ElevenLabs, production topology and deployment acceptance remain open.

## Final checks and qualification incident

- Owned production-PrismaPg calendar/dispatcher/scheduler suite: 18 tests pass.
  Separate native calendar instruction/provenance/runtime suite: 6 tests pass.
- Portable Studio contracts: 20 pass. Full Manager: 1230 pass, 2 skipped.
  Full Mastra: 3031 pass, 32 skipped. Its logged port1 connection refusal is the
  asserted `ai-chat-pg-failmode-contract` test, not an unhandled background error.
- Admin, Manager, Mastra, Studio contracts and Studio server types pass. Final
  Manager and Admin production builds pass; the Admin verifier finds all four
  planner/publication workflow identities. Native final build is recorded separately.
- Initial full Admin run: 28 failures from leaked fixture env/guard behavior.
  A clean-environment full run: 6174 pass, 2 fail, 178 skipped, 1 todo.
  Those remaining failures were a default-database-name assertion and the existing
  auth-rate-limit test explicitly using default Redis6379. It unexpectedly returned
  `source: redis`, so the test **may have touched its expiring shared counter**.
  This is a qualification incident. No shared inspection or cleanup was performed.
- Unit harness configuration was separated from explicitly owned runtime/DB config.
  Socket preflight proves ports6379 and5432 fail before connection with the guard's
  own error. Only then the two affected files were rerun: 72 pass, with the guarded
  Redis error handled through the expected fallback and no Vitest unhandled errors.
  Initial logs and both isolated follow-ups are retained. This is not claimed as
  a clean isolated full Admin run. No unnecessary broad repeat was performed.
  Remaining unit checks disable available test-only telemetry. Runtime/DB evidence
  remains explicitly on55461/54619; product Redis/default configuration is unchanged.

## Independent final delta reports

Original integration tree:70d0b660; source/evidence follow-up tree:028c2c0.
The latter alternate-index snapshot accidentally included the temporary comparison
build. Both reviewers explicitly excluded it from source review. The artifact was
moved back under ignored task storage; it is not included in implementation commits.
The normal Git index was unchanged by these review snapshots.

**Standards:** No new actionable source issues. Named opaque dialog correction
closed; definite rejection refresh and exact ambiguous cancellation retry are
supported by built evidence. Current UNPUBLISHED state takes precedence. Local
publication/revocation/receipt evidence is supported. Performance remains unresolved.

**Spec:** Both scheduling P2 findings closed. Actual timer publishes the bound
revision/release within its window; Watch playback advances and all six resources
are revoked after UI unpublish. Exact stored-envelope retry performs no preparation,
consumption or republication. No new actionable source defects. This is functional
clearance for local scope, not blanket performance/provider acceptance.

## Reviewed retirement alignment

After all loading/publication measurements, root released only retirement commit
7d0cf7bf. It was incorporated as local `2a03da7cd701c97e238645d1646592c38eeb88d9`
above038f396e. An exact272-file WIP backup and retained stash6ab22b8a preserved the
calendar; all restored file hashes matched with no conflict or shared-hunk union.
This is the final dependency/review base; retirement is excluded from calendar
implementation commits. Only the retirement solution and validation delta were read.
The completed measurements retain their earlier baseline/final identities; they
are not silently relabeled as measuring the later retirement CSS/module removal.
Two calendar production route tests pass again in an isolated network namespace.

The final native compiler completed, but its generated-package install attempted
registry metadata reads blocked by the runtime endpoint guard. The failure log is
retained. An offline-only install from the existing package cache passed; the normal
native build was then rerun with offline package resolution. No provider operation
or dependency upgrade was authorized or performed.

Final offline native build and post-retirement Manager production build both pass.
The original review/loading manifests still verify all43 and53 entries. Original
review Markdown was restored byte-for-byte after formatting touched it; a narrow
frozen-report ignore preserves that manifest, while new handoff/solution Markdown
remains format-checked. Final implementation source differs from the reviewed
follow-up only by two Prettier chain-layout changes; no behavior changed during
retirement alignment or evidence packaging.

The two source-readiness red logs printed a large resolved fixture during the
failed assertion. They are retained as deterministic gzip files with both original
and compressed digests in `compressed-log-identity.json`; decompression restores
exact bytes. Full originals remain in owned scratch. Raw command logs preserve
terminal carriage returns/trailing spaces intentionally; source whitespace checks
exclude those immutable evidence bytes.

## Commit and final fixed-base review

Implementation-only commit: `11872e7de3cca077301db0a3523b64adbc681a08`, parent
`2a03da7cd701c97e238645d1646592c38eeb88d9`, tree
`784cd2b121ce70bf8f602c81fb16cbaef839fb0e`. Both independent reviewers verified
this exact final base/tree, the retirement-base equivalence, formatting-only source
deltas, absence of generated build artifacts and retained qualifications. No new
actionable findings. `implementation-commit-hooks.log` records normal ESLint,
staged Prettier and repository-wide `format:check` passing.
