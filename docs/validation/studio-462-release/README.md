# Final integrated Studio local verification

This is unpaid local release verification, a bounded Prisma metadata correction,
and independent default-off production/publication admission controls.
**Feature462 remains in progress.** No external acceptance, OCI build, provider
call, account check, asset upload, shared DB/Redis access, archive/data operation,
push, PR, merge or deployment was performed.

Fixed review base: local `1dd20216`, equivalent root `3053db69`, tree
`e94ed4b2503533845d7f27298ae581bc308d7bf1`. Only reviewed calendar implementation
root9ed64232 and docs3053db69 were added after the already integrated retirement.
The retirement was not duplicated. Current changes exclude all prerequisites.

The [complete acceptance matrix](acceptance-matrix.md) maps the original brief,
plan and ticket to concrete evidence and outstanding gates. The
[release/canary/rollback runbook](../../runbooks/studio-release-canary-and-rollback.md)
is a future procedure, not a record of actions performed.

## New evidence actually executed

Task-owned scratch: `/home/tataihono/.local/share/forge/studio-462-release/`.
Admin/typed-client dependencies were absent, so a scoped frozen offline install
used the existing store, bounded concurrency and normal lifecycle/Husky hooks.
No dependency version or lockfile changed.

`replay.py.txt` and `correction.py.txt` are the exact launchers (adjust their owned
paths for a future authorized reproduction). Both ran inside:

```sh
unshare --user --map-current-user --keep-caps --net python3 /owned/path/launcher.py
```

The wrapper's `--keep-caps` allows loopback setup without becoming UID0 (Postgres
refuses UID0). An initial namespace-only setup without it could not raise loopback;
no DB/test had started. Each actual launcher enables only its private loopback,
asserts5432/6379 inaccessible, binds55462 to verify availability before startup,
uses explicit `postgresql://tataihono@127.0.0.1:55462/forge_studio_462_test`, uses no
Admin dotenv overlays, and passes a minimal environment with telemetry disabled.
The first launcher requires a nonexistent owned cluster directory, initializes it
with installed Postgres18 and creates an empty database. It copies no shared data.
The correction launcher reopens only this retained cluster. Both stop their owned
Postgres in `finally`; no shared listener was inspected, stopped or cleaned.

| Check                                                | Observed result                                                                                                                                                                              |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fresh initdb/create + complete migration replay      | 102 migrations applied successfully, final0092. Count is102, not92: names include branching numbers such as0078a.                                                                            |
| Migration status + physical ledger                   | Up to date; every applied name/checksum matches the102 source migration files, all finished and none rolled back.                                                                            |
| Physical schema inventory                            | Actual Studio/Content Pack columns and constraint definitions retained in database-inventory.log. This is freshly replayed Postgres evidence, not a previous fixture snapshot.               |
| Initial Prisma/SDL/typed-client generation and types | Passed, no tracked generated drift.                                                                                                                                                          |
| Database→Prisma red diff                             | 20 Studio FK update-action differences and three timestamp default differences; full red diff retained.                                                                                      |
| Corrected database→Prisma green diff                 | Zero Studio/Content Pack statements. Unrelated inherited differences remain in the full green log and are untouched. No diff SQL executed.                                                   |
| Regeneration after correction                        | Prisma/SDL/client passed; actual generated client declarations, SDL and introspection SHA256s match their pre-correction bytes exactly.                                                      |
| Focused schema and scheduled adapter checks          | 53 passed across2 files inside the isolated namespace; no provider or full predecessor suite rerun.                                                                                          |
| Admin and typed-client types after correction        | Both passed.                                                                                                                                                                                 |
| Integrated source boundary manifest                  | Four Studio page routes including calendar preserved; no tracked legacy API/UI files; both Admin build verifiers retained; worker/engine/devotional CLI/shared composition source unchanged. |

`results.json`/`correction-results.json` record command exits and duration;
`boundaries.json` records migration/source identities. Raw task logs remain in
owned scratch. Committed text logs normalize terminal control sequences/trailing
whitespace for review; launcher text and JSON data preserve their recorded values.
`SHA256SUMS` covers these committed evidence bytes. The boundary script initially
checked empty directory existence rather than tracked files and missed0078a in
its ledger regex; both evidence-harness errors were corrected without rerunning
DB work or changing source. The final script checks tracked entry points and all102
actual ledger rows.

## Bounded correction and semantics

The Prisma correction changes only Studio declarations in
`apps/admin/prisma/schema.prisma`:

- 20 affected Studio relations explicitly use `onUpdate: NoAction`, preserving
  applied immutable/retention references and existing `onDelete: Restrict`.

- Render/Mux job `updatedAt` describe existing SQL `CURRENT_TIMESTAMP` with
  `@default(now())` while retaining `@updatedAt` client update behavior.
- Watch `deliveredAt` describes `clock_timestamp()` via `dbgenerated`, retaining
  actual statement-time server semantics rather than transaction-start `now()`.

`watch-delivery.ts` is the sole current delivery-row writer; its raw SQL inserts
only release/phase after complete receiver acknowledgements. No Prisma create
consumer loses optionality, and generated declarations remain byte-identical.
No migration, trigger, CHECK, partial index, application writer or unrelated model
was altered. Physical constraint inventory complements Prisma diff: zero scoped
diff does not certify raw-SQL features Prisma cannot represent.

See the [durable solution](../../solutions/database-issues/studio-prisma-immutable-relation-drift.md).

## Independent admission controls and regressions

`STUDIO_PRODUCTION_ENABLED` and `STUDIO_PUBLICATION_ENABLED` independently default
to false in validated Admin configuration. Existing narrow controls remain intact.
The [runbook](../../runbooks/studio-release-canary-and-rollback.md) records exact
operation/control coverage and activation limitations.

Production checks guard new attempts, experiments, runs, paid calls and render/Mux
claims before reservation, lease, dispatch generation or retry budget consumption.
Exact prior outcomes remain observable. Publication checks follow exact receipt/hash
lookup and precede every new manual/scheduled consumption, including persisted
submission envelopes. Disabled scheduled work retries its original window; expiry
is terminal. Editing, titles/themes planning, source/asset reads, retained proposals,
late result retention/settlement, cancellation, unpublish and Watch reconciliation
remain available.

The real owned Postgres regressions cover all five boundaries: manual publication;
stored scheduled denial/expiry plus accepted retry after unpublish and revoked
receipt; paid zero-reservation and late upload/finish; queued render/Mux claims
without consumed counters and later enable; and a two-connection project-lock wait.
The last case reproduced `execute: true` after concurrent terminalization. Re-reading
mutable attempt state after project lock acquisition and prior-call lookup now
rejects NEW work while preserving exact consumed-call replay after terminalization.

Focused checks: Admin 60 tests across five files, Manager 21 across six files,
contracts 6 across two files. The final DB fixture followup passes its five cases. Admin, Manager and contracts
types and targeted lint pass. Typed-client types passed after regeneration.
A revalidation ACK mock initially omitted required `httpStatus`; typechecking found
it and the fixture now reports200. The initial type diagnostic is retained as an explicitly
labeled transcription because the followup reused its scratch log filename. This is a local acknowledged-delivery double,
not a real Watch or provider request. The configuration-default test clears `CI`
because repository test configuration bypasses environment validation under CI.
Other retained red evidence distinguishes genuine missing-gate/expiry/lock-wait
failures from an initially reused fixture asset ID corrected to a UUID. No failed
run is presented as acceptance. Exact check exits are recorded in the launcher
results; no full predecessor suites were rerun.

## Reused reviewed evidence, not rerun

Reviewed461 already included retirement and final460. Its
`integration/admin-source-guard-build.log` and `admin-schedule-build.log` record
both recommendation-retention and calendar verifiers passing; its final
`post-retirement-manager-build.log` covers the combined Manager routes. Its native
final offline build and focused calendar DB/production/timer/Watch chain retain
the original identities and qualifications in `../studio-461/HANDOFF.md`.
The added controls change canonical workflow dependencies, so one new Admin build
passed for this slice, including both normal workflow verifiers. The first
network-isolated attempt stopped at blocked Google Fonts fetches; its red log is
retained. The followup uses Next's existing `NEXT_FONT_GOOGLE_MOCKED_RESPONSES`
test hook with the retained task-local CSS fixture. `controls-build-results.json`
records exit0; the log records both verifier successes. `admin-built-artifacts.json`
identifies the final build/route/workflow artifacts. Retained NFT tracing warnings
from unchanged backup/instrumentation imports are not hidden. This proves compilation,
not actual downloaded font bytes, font rendering or loading performance. Manager
editor/routes/rendering/hydration and shared worker/composition source are unchanged;
reviewed loading evidence remains applicable to those unchanged boundaries, with
its original performance limitations. No fresh browser/performance run or copied
sibling build is claimed.

Retirement worker148, Manager947+2skip, compositions69, actual devotional prebundle
and host production HTTP evidence remain in `../studio-462-retirement/`. These
prove retained host behavior, not OCI. Calendar's later full Manager1230 and
Mastra3031 and root integrated contracts20 remain predecessor results, not this
slice's test counts. Historical Admin full-run failures, shared-default-port
incident and unresolved performance are explicitly retained in the matrix.

## Operational gates at the original verification baseline

At that baseline, actual object storage, creative quality/ElevenLabs, real Mux, exact OCI image,
deployed process containment/private transport/cache/revocation, actual Claude
app login, Lyuba acceptance, current target configuration and normal reviewed
release remained open. The dated VM update below supersedes only the stated local
image/runtime milestones. Source/host protocol fixtures cannot satisfy unrelated
external gates. All paid
batches remain closed. No fresh broad performance measurements were run.

The two new controls have local source/DB proof, not deployed fleet proof. The
runbook inventories all Admin HTTP/workflow/step processes requiring consistent
configuration and restart/drain. In-flight admitted calls can finish; no
instantaneous stop is claimed. Per-calendar planning, native agent admission and
Manager Mux creation controls remain separate. Stored scheduled envelopes now
pass the canonical publication gate before new visibility; exact accepted retries
remain observation-only after unpublish.

## 2026-09-09 reviewed VM documentation update

Aligned cleanly through the five reviewed root commits after equivalent root
`bb6ed63f`; no duplicate prerequisite patches. Fixed local review base
`08c69c4ebde7be71f2c6751bf64e14fa746c78d8` equals root
`a13dace2cdf3135353020ee59d6459fc506c9b2c`, tree
`a58514a14a9c4787807509a6621223a0db23dfbc` verified before edits.

Read-only evidence sources are
[VM handoff](../studio-460/vm-execution/HANDOFF.md),
[VM qualification](../studio-460/vm-execution/README.md),
[independent VM review](../studio-460/vm-execution/REVIEW.md),
[retained-worker image evidence](../studio-460/worker-shutdown/README.md), and
[VM ops contract](../../../apps/studio-render/ops/README.md).
The acceptance matrix now records their exact source/image/host-bundle and failure
qualifications. The runbook uses the outbound dedicated-VM model, additive0093,
scoped HTTPS pool authority and inactive install/drain sequence, with minimal named
next actions. Task460 owns hosted CI/ops tooling; this phase edits no such source.

Actual corrected worker OCI idle/active cancellation and actual VM direct-image /
daemon / OOM / restart / late-retention milestones are established on the recorded
owned substrates. They are not production storage/HTTPS/provider or full operator
acceptance. Final host bundle has idle rollout proof; composition evidence uses the
preceding bundle and unchanged job images. Historical231s is separate, and diagnostic
entrypoint/20s-deadline probes are not product-path or900s acceptance.

No suites, builds, migration replay, historical audit or external operation was
performed in this documentation phase. Original logs/results/source hashes retain
their original baseline and bytes; only the changed README/matrix entries in this
directory's manifest are refreshed. Independent docs review and normal hooks are
required for this change. Overall feat462 remains in progress: durable bucket,
reviewed hosted release supply, intended HTTPS/key/configuration and activation,
creative/ElevenLabs/Mux, actual Claude login, public revocation, performance, Lyuba
and normal release acceptance are still open. Closed paid batches remain closed.
