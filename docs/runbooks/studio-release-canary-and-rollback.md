# Studio release, canary and rollback

Status: reviewable procedure, **not executed release acceptance**. Feature462 stays
in progress. Read the full [acceptance matrix](../validation/studio-462-release/acceptance-matrix.md)
and its substrate/qualification columns before using this runbook.

Root coordinator owns release sequencing and external authorization; Lyuba is the
initial product acceptance owner. No step below authorizes provider calls, account
access, asset upload, infrastructure mutation, push, PR, merge or deployment.
All earlier paid batches are closed. Local verification does not waive any gate.

## Record the release envelope first

For each target record actual project/environment/service IDs, reviewed PR/main
commit, build/image digest, migration ledger, runtime/codec versions, configuration
version, current operator identity/membership, Auth resource/audience/environment,
MCP scopes, native instruction IDs and effective content hashes. Record artifact
sizes/checksums, source Video/Dub/Edition/language/track digests, project/revision,
approvals, attempts, release ID, provider request/asset/playback IDs and costs.
Do not store secrets or persistent signed resource URLs in the report.

Current execution model (reviewed root `a13dace2`, 2026-09-09) is a dedicated VM
that polls Manager outbound over HTTPS and launches separate immutable renderer
and verifier containers. It supersedes the proposed Railway renderer receiver.
The trusted host has Docker authority and one scoped worker key; job containers
have no credentials, socket or network. Preview remains a separate boundary.

The owned VM fixture at `10.2.1.100` is not a production deployment. Its selected
service is drained/inactive/boot-disabled, with loopback fixture configuration and
Admin local asset storage. Root supplies the intended target/configuration; do not
infer it from a CLI link or this fixture. The authoritative installation contract
is [VM ops](../../apps/studio-render/ops/README.md); task460 owns its hosted CI and
release-tooling followup. At this fixed base, hosted image publication is planned,
not an existing workflow. Production application changes use reviewed PRs to main
and normal Railway deployment. VM images/bundles require the corresponding reviewed
release and named pull/install/activation approval. Never `railway up`, a local
worktree redeploy or an arbitrary PR runner on the VM.

## Blocking dependencies and owners

| Owner to coordinate             | Required proof before enabling its dependent path                                                                                                                                                                                                                                       |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Root + repository release owner | Approve durable checksum-verified versioned codec supply from IMAGE.md; the original archive is absent and upstream versioned retention is14days. Record immutable approved supply/readback; never substitute latest. Task460 owns reviewed hosted CI image/bundle publication tooling. |
| Root + OCI/platform operator    | Use reviewed VM image/bundle evidence with its exact identities and limits; approve hosted release digests and intended VM pull/install. Existing local image proof does not establish hosted publication, final-bundle composition or production configuration.                        |
| Platform operator               | Record intended outbound HTTPS/key/configuration and original deadline/retention behavior; preserve measured2CPU/2GiB/no-swap/128 aggregate tasks plus96 untrusted child limit, native watchdog ownership, no job credentials/network, and exact physical retirement. No cgroup waiver. |
| Storage operator                | Actual private object-storage write/read/hash/current-auth/expiry/Range/HEAD/restart and immutable asset-version retention. Keep all132 originals unchanged; use copies and new identities. No archive migration or automatic deletion.                                                 |
| Root + provider account owner   | Separate fresh limits for creative LLM evaluation, ElevenLabs narration/music/voice, and one real Mux ingest; target account/environment, cost cap and approved exact request/prompt/tool versions. A tool-schema digest is not paid authorization.                                     |
| Auth/Manager operator           | Current interactive membership and revoked/insufficient-scope denial; intended OAuth resource/environment and actual Claude Code app login with scoped delegated operations. Broad Manager API keys never reach browser/model/external Claude.                                          |
| Watch/platform operator         | Receiver deployment, strict delivery receipts, public CDN/service-worker/private/no-store behavior, exact resource revocation with stale DOM and previously issued URLs, current source restrictions.                                                                                   |
| Lyuba + root                    | Dated standalone/manual and full hosted/MCP/audio/component/Watch/calendar acceptance; creative quality and performance qualifications resolved or explicitly returned for remediation.                                                                                                 |

## Receiver before sender

Stages are ordered prerequisites, not permission to deploy now. Keep new work
unavailable until its receiver and limits are proven. Existing published read and
revocation support must remain available throughout deployment and rollback.

1. Set Admin `STUDIO_PRODUCTION_ENABLED=false` and
   `STUDIO_PUBLICATION_ENABLED=false` in the reviewed rollout configuration.
   Land/review shared schemas and additive Admin migration `0094_studio`. Generate
   Prisma, Admin SDL and `@forge/admin-graphql` in the same reviewed state. Normal
   Admin predeploy runs the existing migration-deploy wrapper. Verify the **target**
   ledger after deployment; local empty replay is not the deployed ledger. Do not
   run `db push`, generated diff SQL, reset, or destructive rollback migrations.
2. Deploy Watch receiver support for `watch-route-manifest` and `video` invalidation
   acknowledgements before enabling strict Admin emitters. Verify complete
   receipts; HTTP200 without the required acknowledgement is not delivery success.
   Preserve current-state checks, Core routes, no-store gateway resources and Studio
   image optimizer refusal. If old Studio optimizer copies actually exist, review
   exact affected keys/origins for purge; never blanket-purge unrelated content.
3. Deploy Admin canonical commands, publication/revocation/read gateway and runtime
   schema before Manager/native senders. The Admin build must invoke both
   `scripts/verify-recommendation-workflow-build.mjs` and
   `scripts/verify-studio-calendar-workflow-build.mjs`; calendar requires both
   planner and publication workflow/step IDs, not instrumentation-only discovery.
   Provision/verify Workflow Postgres schema through the normal runtime setup.
4. Deploy the private preview receiver on its distinct registrable site. For final
   rendering, deploy the authenticated Manager `/api/studio/render-pool` receiver
   after Admin migration `0094_studio` and before any VM assignment. Keep `STUDIO_RENDER_POOL_ENABLED`
   false. Complete the reviewed image/bundle supply and inactive install in the VM
   ops contract; preload approved digests outside claim execution. Use outbound
   HTTPS without redirects; fixture HTTP on literal127.0.0.1 is not production proof.
   Verify the900s shared render/verifier deadline inside the1200s lease,90s input,
   10s upload and persisted60s settlement window (45s retention/15s terminal record).
   The previous920s inbound renderer request is not the new VM transport contract.
   Configure/verify the approved endpoint and scoped keys before separately
   authorizing activation. No public renderer listener or Docker TCP socket.
5. Deploy native Mastra Studio receiver with scoped authoritative native store,
   public verification keys and admission secret before enabling Manager generation.
   `STUDIO_AGENT_ENABLED=false` remains the initial posture. Generic Editor shadow
   storage must not become a second instruction authority.
6. Deploy Manager broker/Studio routes and authenticated calendar/publication trigger
   receivers before configuring Admin timer dispatch to them. Initially leave
   `STUDIO_MUX_INGEST_ENABLED` unset/false, per-calendar `automationEnabled=false`,
   and create no scheduled publication authorizations. Do not enable a permanently
   nonfunctional renderer and call the product complete.
7. Verify current signed-in operator controls, scoped MCP and all disable/revocation
   actions below. Enable each proven path only for the specifically approved canary.
   Automatic planning is title/theme-only; explicit production and interactive
   publication authorization remain separate regardless of rollout order.

Configuration names are source contracts, not claims about current deployed values:

| Boundary                    | Required configuration / authority                                                                                                                                                                                                          |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Admin canonical state       | `DATABASE_URL`, `STUDIO_PRODUCTION_ENABLED`, `STUDIO_PUBLICATION_ENABLED`, appropriate `STUDIO_ENVIRONMENT` (`production` in production), `STUDIO_INTERACTIVE_PUBLIC_KEYS`, existing Auth and membership configuration                      |
| Manager → Admin/native      | Manager `STUDIO_INTERACTIVE_KEY_ID`/`STUDIO_INTERACTIVE_PRIVATE_KEY`, existing authenticated Admin/native adapter origins and service transport; receiver public-key map matches key ID                                                     |
| Native Studio               | `STUDIO_ADMIN_URL`, `STUDIO_AGENT_ENABLED`, `STUDIO_ADMISSION_SECRET`, `STUDIO_INTERACTIVE_PUBLIC_KEYS`, native Postgres-backed Editor storage                                                                                              |
| Preview                     | Manager `STUDIO_PREVIEW_ORIGIN`, `STUDIO_PREVIEW_SERVICE_URL`, `STUDIO_PREVIEW_API_KEY`; separate preview service authority                                                                                                                 |
| Manager VM pool             | `STUDIO_RENDER_POOL_ENABLED=false`, `STUDIO_RENDER_POOL_ID`, `STUDIO_RENDER_WORKER_ID`, dedicated `STUDIO_RENDER_WORKER_KEY`, separate `STUDIO_RENDER_CAPABILITY_KEY`; generic keys/OAuth/cookies do not authorize pool work                |
| Trusted VM host             | Root-owned0600 `/etc/forge-studio/worker.json`: version, enabled:false, endpoint, token, poolId, workerId, fixtureHttp:false, renderImage, verifyImage. Exact schema and install/switch operations in VM ops; no secrets in images/evidence |
| Actual audio/storage        | Approved `ELEVENLABS_API_KEY` in trusted broker only; existing private storage configuration and registry permissions; no executor secrets                                                                                                  |
| Mux creation vs observation | `STUDIO_MUX_INGEST_ENABLED`, `STUDIO_ASSET_INGEST_ORIGIN`, trusted broker Mux configuration; distinguish creation permission from same-asset observation                                                                                    |
| Playback and delivery       | Admin `STUDIO_PUBLIC_PLAYBACK_ORIGIN`, `STUDIO_MUX_SIGNING_KEY`, `STUDIO_MUX_PRIVATE_KEY`, `WEB_REVALIDATE_URL`, `WEB_REVALIDATE_TOKEN`; matching Watch receiver and private/no-store routing                                               |
| Admin timers → Manager      | `MANAGER_API_BASE_URL`, `MANAGER_TRIGGER_API_KEY`; HTTPS outside explicitly local mode, both Manager trigger routes deployed first; Workflow Postgres runtime configured                                                                    |

## Disable controls: what each actually stops

| Control                                                                                    | Effect and limitations                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Calendar settings `automationEnabled=false` through the authenticated UI/configure command | Stops future automatic title/theme admissions for that calendar. Does not cancel existing planning work, explicit production or authorized publication. Reconcile already admitted results; human changes remain protected.                                  |
| Native `STUDIO_AGENT_ENABLED=false`                                                        | Both `/forge-studio` and `/forge-studio-calendar` return503 for new requests. It is a joint agent/planner admission switch, not a cancellation of in-flight work, an ElevenLabs switch or a publication switch.                                              |
| Manager `STUDIO_MUX_INGEST_ENABLED=false`                                                  | Stops new dispatcher ticks/creation admissions in that loop. Does not cancel an already issued provider request, revoke a published item or stop an exact prepared publication. Preserve ambiguous creation evidence; never issue a second automatic create. |
| Cancel an unconsumed scheduled authorization through the calendar UI                       | Revokes that exact schedule with version/idempotency checks. Inspect canonical state if cancellation races publication. An accepted publication needs authorized unpublish; cancellation cannot reverse an accepted receipt.                                 |
| Current operator membership/scoped delegation revocation                                   | Canonical admission/current publication eligibility recheck prevents unauthorized actions. Operational blast radius is broader than a dedicated production switch; do not treat it as a silent substitute for a fleet control.                               |
| Canonical **Unpublish permanently**                                                        | Removes public visibility and denies subsequent old resource requests while retaining bytes/history/permanent lock. It never restores draft/edit/clone/replacement/republish capability.                                                                     |

The Manager pool switch and VM `enabled:false`/durable drain stop new pool
admission, independently of publication. Apply configuration through the reviewed
ops procedure; do not replace or erase a running journal. Historical assignment
lookup, ownership and signed terminal receipt recovery must remain usable. A claim
replay marked `execute:true` permits resuming that same issued assignment only,
never another container start; disabled new-work controls cannot create a lease.
Drain/update waits for physical retirement and canonical settlement. Unconfirmed
work refuses switching. Do not disable recovery endpoints to stop new claims.

**Canonical independent controls now implemented:** Admin
`STUDIO_PRODUCTION_ENABLED=false` rejects new generation/narration/render attempt
admissions, experiment and paid-run admissions, and new paid/render/Mux execution
claims. Existing exact receipts return their canonical outcome without dispatch.
A denied new claim consumes no paid reservation, render lease/generation or Mux
dispatch identity. Queued work remains eligible after enablement subject to its
original validity/retry rules. Existing consumed calls and render/Mux outcomes may
still finish/upload/retain/settle; disabling does not turn an in-flight paid call
into a fabricated failure or authorize replay. Zero-cost registration claims are
also new work and are blocked. Ordinary manual editing, source/asset reads,
proposal inspection and title/theme-only calendar planning are not gated.

Admin `STUDIO_PUBLICATION_ENABLED=false` rejects every **new** canonical manual or
scheduled publication, including an already stored submission envelope. Exact
accepted receipt lookup and conflicting-hash rejection precede the flag. Accepted
retry after unpublish returns only the historical receipt, with no verifier,
schedule consumption or visibility change. `PUBLICATION_DISABLED` is retryable in
the calendar dispatcher without replacing the envelope/window. Its original
expiry still wins while disabled; reenabling never extends the window or chooses
a different release. Unpublish, current playback denial and delivery reconciliation
remain available with both flags off.

Configuration is captured by each Admin process at startup. Inventory and update
**all** Admin Next HTTP replicas serving interactive/delegated/GraphQL commands,
all workflow flow/step execution processes (including separately scaled runtime
workers if present), and any other trusted Admin process invoking these canonical
services. Confirm effective flags/builds and drain old configured replicas before
claiming fleet disable. Durable workflow invocations executed by an older process
can retain its old configuration. Neither process restart nor the final transaction
check is an instantaneous global barrier; already consumed external calls may
complete. No process is restarted by this runbook preparation. Native and Manager
flags above remain additional narrower controls, not substitutes for the Admin
publication authority. `DEVOTIONAL_NEW_RUNS_ENABLED` remains legacy-only.

Do not disable canonical playback authorization or the revocation/delivery
reconciler as a substitute for stopping new production. Already published items
must keep current access enforcement and unpublish recovery available.

## Minimal next actions and evidence

These are named dependencies for root to coordinate, not operations performed by
this documentation update. Preserve the owned fixture and previous evidence.

1. **Task460/release owner:** finish reviewable hosted CI and durable codec supply;
   record source/main commit, codec checksum, two approved OCI digests, bundle
   manifest/toolchain/SHA and provenance. Approve actual publication separately.
2. **Root/platform:** name intended VM/Manager/Admin environment and scoped worker
   identity; approve immutable pull/inactive install and HTTPS configuration using
   VM ops. Retain effective config identities without secrets, TLS/origin/redirect
   checks, wrong-key/pool/worker denial, and original assignment/deadline recovery.
3. **Storage owner:** verify approved Admin bucket configuration and one new fixture
   object's write/hash/private read, Range/expiry/current authorization and read
   after service restart. Actual `RAILWAY_S3_BUCKET` originals use
   `media-assets/{assetId}/original/{filename}`; `.tmp/media-assets` is local fallback
   and does not pass durability. Keep all132 recovered originals untouched.
4. **Root/platform/operator:** approve bounded activation with production/publication
   controls still independently held. Record one final-bundle representative
   composition through intended HTTPS/storage, exact render/verifier identities,
   retained receipt and native retirement. Reuse specific established VM failure
   proofs where applicable; do not relabel preceding-bundle, direct-image or
   diagnostic evidence as this run. Qualify required long/multiple-cut output and
   deadline/transport limits. Record drain/update/rollback on the approved target.
5. **Root/provider owner and Lyuba:** separately authorize exact creative/ElevenLabs
   and Mux requests/caps; execute the operator sequence below with actual Claude app
   login, paid-audio reuse/cost evidence and current auth. Then verify publication,
   Watch playback/export and subsequent-request revocation; signed URL lifetime is
   insufficient. Record agreed loading/performance observations and dated Lyuba
   acceptance. Unresolved results remain open; no paid batch is reopened here.

## Operator canary sequence

Run only with the named external prerequisites and explicit caps approved. Record
actual results next to each step; none is passed by this document.

1. Sign in as Lyuba/current Operator; verify unauthorized and revoked actors fail.
   Create a standalone project without a calendar. Add/edit tracks/text/media,
   trim/crop, undo/redo, reopen, and reconcile a second-client stale revision.
2. Select exact library language/Dub/Edition/canonical subtitle track and retain
   source ranges/digests. Demonstrate missing/ineligible source blocks without
   alternate-language or transcription fallback. Review clip ends and pauses.
3. Inspect native instructions, save a draft, test/compare without activation,
   explicitly activate, restore into a new draft. Record effective immutable
   bytes/versions observed by the approved real generation. Use actual Claude Code
   login to read/edit/request generation on the same canonical project; reject
   stale/scope-violating operations and delegated approval/activation.
4. Generate script/layout/source preview explicitly, review every spoken segment
   including bridges/settles/suppression and approve script. Perform approved real
   narration; inspect pacing with actual audio. A visual edit must make zero new
   TTS calls; one spoken edit regenerates only the affected exact identity. Verify
   model/voice/pronunciation changes miss cache and manual timing locks conflict
   visibly. Record estimate, provider request IDs, costs and retained assets.
5. Perform separately authorized music/voice experiments, audition/select candidates
   and retain unselected ones. No new creative call follows an automatic cache miss.
6. Add a versioned custom component with editable props, review compile failure and
   isolation diagnostics. Render representative long/multiple-cut media including
   the231s workload where selected. Independently decode/check final audio, frames,
   dimensions, duration and subtitle/source mapping. Exercise exact-image restart,
   cancellation, timeout, OOM and stale-output retention; do not infer from source.
7. Ingest one verified output into actual Mux under a fresh explicit limit. Verify
   signed-only policy/readiness and exact identity; stage hidden catalog/source
   derivations. Hidden staging is not publication. Review the final render and
   approve the exact current revision; a prepublication edit must invalidate it.
8. Publish manually through the canonical UI. Verify Watch entry/source relationships,
   playback progression, authorized export, Range/HEAD and private/no-store media.
   Keep the page open and retain issued resource identities for revocation checks.
9. Unpublish permanently. Request all previously issued master/variant/segment/image/
   audio/download forms and verify denial, current read/search/related/route state,
   strict invalidation receipts and public CDN/service-worker behavior. Verify no
   further media requests succeed in stale DOM. Already delivered buffers/exports
   cannot be recalled. Prove edit/undo/restore/correction clone/replacement/republish
   rejected through UI/MCP/generic Admin. Exact accepted retry returns history only.
10. In a separate never-published draft, configure calendar zone/time/DST and packs,
    current/following fortnight, weekly themes and bounded once/twice planning.
    Automatic run produces titles/themes only and preserves overrides/edited work.
    Explicit single/batch production retains reviewable results and exact ambiguous
    retry. Approve a render and interactively authorize exact due/window bindings.
    Observe the independent timer, restart/recovery, same-release readiness and
    atomic consumption without manual publish substitution. Failed/unready/expired
    cases remain unpublished. Demonstrate cancellation/reschedule and permanent
    unpublish of the successfully delivered item.
11. Record cold/warm controls, JS/media resources, preview startup/seek, long tasks,
    CLS and Watch behavior under agreed conditions. Retain prior inconclusive and
    adverse measurements; do not repeat until a preferred result appears. Lyuba
    records dated acceptance or concrete failures against the full matrix.

## Rollback and incident handling

Stop new work with the exact controls above and record in-flight attempt/schedule/
provider identities. Do not clear queues or erase receipts/assets to force a retry.
An ambiguous render/provider/submission result must reconcile the same identity;
accepted publication remains permanently immutable. If publication succeeded,
use canonical unpublish when authorized, then verify actual subsequent-request
revocation and delivery reconciliation. Never edit the latch, fake a receipt,
clone for correction, replace bytes or republish the same project.

For the VM, use only the reviewed ops drain/switch procedure and approved prior
bundle/images. Running assignments keep their original digest, boot identity,
lease and deadline. A1200s bounded drain is not new execution time; unconfirmed
journals refuse switching. Keep old images/releases and small journals. Rollback
leaves the service inactive/drained unless activation is separately authorized;
never delete torn journals to regain capacity. Key rotation must preserve terminal
signature verification for historical receipts. No production activation or
rollback was executed by this documentation phase.

Keep additive schema and retained assets/history. Roll back application code only
through a reviewed PR/main normal deployment to a version compatible with the
applied schema and permanent publication/Watch authorization rules. A pre-Studio
binary that bypasses those rules is not a safe rollback target. Preserve receiver
support while newer senders or delayed deliveries remain; stop senders first.
Do not disable unpublish/delivery recovery when cancelling future production.

Attach incident and canary records to feat462, including exact unsuccessful probes,
configuration/build identities, unresolved drift/performance, actual costs and
Lyuba signoff. Mark complete only after all acceptance requirements are actually
satisfied; this runbook and local checks are not a release waiver.
