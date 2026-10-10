> Historical validation summary. Raw artifact paths and original checksum inventories below refer to the [preserved archive](../STUDIO-ARCHIVE.md); they are not a current checkout file inventory. Test fixtures remain in Git.

# Feat-457 validation

Reviewed prerequisite: `e12643ecc76c30f73722848195a62d66865f7a90` (root-integrated
456 on reviewed 455/459). All implementation is subsequent to that fixed base.
Evidence was produced on 2026-09-07/08 with isolated local services. No shared
fixture, production write, paid provider call, push or deployment was used.

## Native lifecycle and exact execution

`native-preparation.md` and `native-preparation-results.json` record the installed
Mastra core 1.55.0 / Editor 0.13.9 / Postgres 1.18.1 API probe, including actual
Postgres stop/start persistence. Native `agents.createVersion` retains the active
pointer; Editor convenience update activates. The prompt convenience draft
selector is ignored; exact storage versions are authoritative. An agent version
does not freeze a mutable referenced block.

`apps/mastra/src/services/studio-authoring/instructions.db.test.ts` exercises the
native save/compare/activate/restore lifecycle. `runtime.db.test.ts` runs actual
Node HTTP with two independently instantiated native stores/handlers and a
recreated handler, using the disposable Postgres database. A local deterministic
`MockLanguageModelV3` observes the admitted effective bytes after active agent
and block pointers move. Bound attempt, project, revision, message, language and
snapshot digests are verified. Unbound/changed admission, missing authorization,
delegated activation, running/completed/failed replay and provider failure are
covered. `execution.test.ts` covers advisory-lock cleanup, including destruction
of a connection whose unlock fails.

The durable claim is metadata only: `running`, `completed`, or `failed`. A crash
can leave a consumed, ambiguous `running` claim; it never silently reruns under
the same attempt. An explicit fresh admission/request identity is required.
Manager's completion regression proves a duplicate dispatch loser cannot finish
another execution and malformed streams cannot report success.

## Built native HTTP boundary

The production `mastra build --studio` output was started at loopback port 4127
with native Editor/composite Postgres storage and fixture-only legacy boot
configuration. No model was invoked. `native-http-proof.ts.txt` is the probe;
`native-http-evidence.json` records every actual route/status and native version
identity. The signed product adapter alone receives the authoritative native store in
schema `mastra_studio_authoring`; generic Editor/composite uses `mastra`.

The initial built-server probe caught generic lists exposing Studio bodies when
storage was shared. The final architecture removes that shared authority and
its route filters entirely. There is no production prompt migration or fallback
copy. The probe creates identical shadow IDs through name-derived generic
creation, reads collections/status/detail/version/compare routes, activates and
restores generic versions, updates/deletes them, resolves a generic block preview,
and clones an unrelated registered agent into the identical shadow ID. All of
these preserve the scoped authoritative marker, native version IDs and active
pointer. Generic reads never contain the authoritative marker. Missing scoped
authentication and delegated activation return 403. `native-restart-evidence.json`
proves the scoped state persists across two actual built-server processes.

## Manager, hosted tools and external MCP

Browser snapshots document actual authenticated Manager draft/save/test/compare/
activate/restore, streamed proposal, apply, undo, history and failure interactions.
The canonical project moved from revision 1 through a manual title edit (2),
interactive undo (3), hosted proposal apply (4), interactive undo (5), and the
same external MCP title edit (6). History retains the same human owner while
recording interactive authority versus delegated `studio-hosted` / `claude-local`.

Draft v2 test left active unset; explicit activation selected v2. Saving v3 and
restoring v2 as new draft v4 kept active v2. After restarting the deterministic
runtime, the visible instruction test sent project language `english`;
`provider-language-evidence.json` records the actual resolved provider input.
A deterministic streaming failure surfaced an error without applying changes.
These are local provider-double proofs, not paid generation evidence.

`mcp-proof.mjs.txt` and `mcp-evidence.json` exercise actual OAuth-authenticated
Manager HTTP MCP using a disposable local JWKS issuer, resource/app/environment
claims, current Operator membership and scoped tokens. They cover the same edit,
stale revision, invalid token, insufficient edit/upload scopes, absent approval/
activation tools, and scoped component upload/read with durable delegated actor.
This is protocol-level HTTP evidence; it does not claim a Claude Code application
or production Auth login was exercised. Auth's resource-derived claim regression
covers malicious client metadata without changing unrelated OAuth behavior.

Admin's real Postgres delegated regression issues both human and delegated
component transfers through public commands, uploads actual bytes, and checks
stored actor authority/client, scope/actor spoofing, expiry, kind and byte guards.
Source capture/read and shared asset/Content Pack discovery use existing 455/456
services. Generation here means proposal admission and diagnostics; no narration,
experiment, rendering, publication or unsafe attachment patch is simulated.

## Frontend performance

`performance.mjs.txt` uses isolated Playwright 1.61.1 and headless Chrome
152.0.7977.64, without a user profile. Baseline and current production Manager
builds used the same service-owned blank composition and loopback fixtures.
Three matched cold/warm pairs used fresh contexts/cache clearing for cold and a
second navigation in the same context for warm. Each sample required preview
readiness, Add text card, visible inspector and Undo. It captured Navigation /
Resource Timing, CDP JavaScript waterfall, long tasks and CLS. Navigation DELETE
cleanup occurred outside every measured sample. Assistant was opened after the
base sample. No network/CPU throttling or decoded-media comparison was used.

| Median                      |  Baseline |   Current |
| --------------------------- | --------: | --------: |
| Cold load                   |  213.2 ms |  213.2 ms |
| Warm load                   |   61.2 ms |   58.0 ms |
| Cold controls ready         |  533.9 ms |  504.6 ms |
| Warm controls ready         |  250.4 ms |  261.1 ms |
| Cold JavaScript transferred | 256,283 B | 256,477 B |
| Warm JavaScript transferred |       0 B |       0 B |
| Cold long tasks             |     52 ms |      0 ms |
| CLS, cold and warm          |         0 |         0 |

`performance-final.json` contains raw samples/waterfalls; `performance-summary.json`
contains conditions and medians. These samples show no material loading
regression; they are local measurements, not a production latency guarantee.
Earlier restricted in-app timing was supplementary and is not the loading gate.

## Automated checks

- Manager full suite: 152 files / 1,178 tests passed; subsequent chat failure /
  canonical identity regression: 3 tests passed.
- Auth full suite: 43 files / 527 passed, 20 skipped; subsequent configuration
  claim suite: 31 passed (includes the added malicious-metadata regression).
- Mastra full suite: 250 files / 3,009 passed, 27 skipped. Subsequent native
  lifecycle/runtime/lock subset: 5 passed; language/runtime subset: 2 passed;
  final isolated native lifecycle/runtime/lock subset: 4 passed.
- Neutral contracts: 5 passed; Node-only signed boundary: 1 passed.
- Admin full run: 397 files / 6,166 passed, initially 6 failed files. The actor
  expectation and isolated-database allowlists were corrected. All Studio suites
  then passed on a fresh disposable public schema: 8 files / 32 tests. Remaining
  full-run failures were isolated fixture conditions: environment test expected
  its mock database URL (64 passed with DATABASE_URL unset for that test only),
  Redis fallback contacted the host listener (8 passed in an isolated network
  namespace), SEO timing under concurrent suites (30 passed alone). No shared
  listener was stopped. Earlier asset-import retry needed fresh metadata/bytes;
  recreating only the disposable public schema via all Admin migrations resolved
  it. The full Admin invocation was not represented as a single clean run.
- Admin, Manager, Auth and Mastra typechecks passed. Production builds of all
  four passed; Mastra was rebuilt after the final native storage-isolation changes. Reviewed
  preview package build passed for the local browser fixture.
- GraphQL SDL was unchanged; no schema generation was necessary.

Commands used the repository `pnpm --filter @forge/<package> test`, `typecheck`,
and `build` scripts; focused Vitest files were passed with `exec vitest run`.
Database tests used only `postgresql://tataihono@127.0.0.1:55457/forge_studio_457_test`.
Fixture launchers are included as text artifacts. Their private key/token file
is outside the repository and is intentionally absent. Build-only required
legacy configuration used inert local values. Test/build summaries and hashes
are in `check-summary.json` and `SHA256SUMS`.

## Review and downstream boundary

Independent Standards and Spec reviews used the fixed prerequisite above. Both
full reviews cleared the implementation, followed by an additional review of the
built native-route findings. Final review results are recorded in `review.md`.
The durable implementation/extension handoff is
`docs/solutions/security-issues/studio-native-agent-admission.md`.

Feat-458 owns paid/provider generation proof, narration execution and canonical
atomic attachment/timing ripple. Its admission must include approved effective
speech, including bridge/settle, in provider/cache identity. It must preserve the
native snapshot/effective-byte and delegated-authority boundaries. Catalog stage
remains trusted-service-only and hidden. Nothing here grants delegated review,
experiment or publishing authority.
