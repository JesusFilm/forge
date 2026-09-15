---
title: Studio video authoring implementation plan
type: feat
status: ready-for-implementation
date: 2026-09-07
design_ticket: feat-451
---

# Studio video authoring implementation plan

## Scope and authority

Replace Shorts in `apps/manager` with a general video authoring workspace. Start
with standalone projects using Lyuba's devotional work, then deliver generation,
immutable publication into the Forge catalog/Watch, and optional calendar use.
The user confirmed the design and authorized implementation planning on
2026-09-07. This document plans work; no application implementation or deployment
was performed while writing it.

The [confirmed brief](../brainstorms/2026-09-07-studio-video-authoring-brief.md)
is the product authority. The [research note](../research/devotional-editor-feasibility.md)
separates verified framework support from runtime work still required.
`CONCEPTS.md` defines **Content Pack**. The following are fixed requirements:

- Replace Shorts completely; no legacy import/archive is required.
- Standalone projects first; calendar assignment is optional.
- Flexible tracks and generated Remotion components; no hardcoded devotional arrangement.
- Manual UI, Claude Code over MCP, and hosted Mastra operate on the same project.
- Mastra Editor owns instruction bodies and versions; no second prompt store.
- Content Packs contain reusable evidence and editorial guidance and drive themes.
- Autonomous calendar planning produces titles/themes only, never scripts or media.
- Explicit generation prepares script/layout/source preview before paid narration.
- Exact source-language/edition/subtitle matching; no silent language fallback or replacement transcription.
- All assets retained initially. Explicit new music/voice experiments; reuse matching assets.
- Everything remains editable until publication. Edits invalidate stale approvals/results.
- Published and subsequently unpublished projects cannot be edited, restored to draft,
  cloned for correction, replaced, or republished. The only post-publication action is unpublish.
- First release includes Forge registration and Watch visibility; author language only,
  downloadable exports, no translation, direct social posting, or mobile UI work.

## Existing code and reuse

| Area                   | Existing implementation                                                                                        | Planned treatment                                                                                                   |
| ---------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Studio surface         | `apps/manager/src/app/dashboard/shorts/`, `src/features/shorts/`, `src/features/shell/manager-shell.tsx`       | Replace product views; retain useful Player/media plumbing.                                                         |
| Draft/job storage      | `apps/manager/src/lib/shorts-draft.ts`, `src/lib/state.ts`, `src/types/job.ts`                                 | Replace last-write-wins artifact drafts with durable projects; jobs remain attempts, not projects.                  |
| Media streaming        | `apps/manager/src/app/api/shorts/jobs/[id]/media/[artifact]/`                                                  | Reuse bounded Range streaming mechanisms; new asset identities are independent of old artifact literals.            |
| Worker                 | `apps/shorts-worker/src/{render,devotional-render,jobs,source-url}.ts`                                         | Reuse verified byte transfer/render mechanisms; generated-code execution needs separate containment.                |
| Composition            | `packages/shorts-compositions/src/`                                                                            | Keep React-free server subpaths and exact Remotion version lockstep; add general timeline/custom-component support. |
| Catalog/media          | `apps/admin/prisma/schema.prisma`, `src/services/{video,media-asset}.service.ts`, `src/graphql/types/video.ts` | Own project metadata, Content Packs, asset registry, and generated catalog identities.                              |
| Agent configuration    | `apps/mastra/src/mastra/index.ts`, native `MastraEditor`                                                       | Reuse configured Postgres-backed draft/version operations behind Studio authorization.                              |
| External MCP precedent | `apps/admin/src/{app/mcp/route.ts,mcp/admin-mcp-tools.ts,auth/admin-mcp-oauth.ts}`                             | Reuse the protocol/auth approach through a neutral module if appropriate; no cross-app imports.                     |
| Agent chat precedent   | Admin Experience chat and `apps/mastra/src/mastra/agents/`                                                     | Adapt streaming and apply/revert patterns into Manager; business writes go through the new commands.                |

Existing Shorts preparation calls Whisper and enforces a 180-second clip ceiling.
Neither is a new-product requirement; a supplied devotional example is 231 seconds.
Remove those inherited assumptions from the replacement, retaining explicit resource
limits based on measured workloads rather than silently truncating content.

## Module ownership and interface

**Admin owns canonical product state.** Add a Studio authoring module at proposed
`apps/admin/src/services/studio-authoring/` with GraphQL types under
`src/graphql/types/studio-authoring.ts`. Its interface owns validation, revision
checks, actor attribution, job admission, approval invalidation, asset references,
and publication invariants. Prisma/Postgres remains the sole canonical product
store. Manager must not add a separate project database.

**Manager owns the human surface and transport adapters.** Proposed paths are
`src/features/video-studio/`, `src/app/dashboard/shorts/` (replace in place),
`src/app/api/studio/`, and `src/app/mcp/route.ts`. Keep the existing route during
replacement to avoid an unrelated URL migration. Use `src/backend/admin-client.ts`
for canonical contracts. Manager's durable workflows coordinate rendering and
Mux completion; the new path does not extend the legacy Mastra Workspace exception.

**Mastra owns intelligence and instruction storage.** Add a dedicated Studio agent,
tools, and bounded generation entrypoints under proposed
`apps/mastra/src/mastra/agents/studio-authoring/` and
`src/services/studio-authoring/`. Mastra calls authenticated product commands,
never Admin Postgres or Manager implementation code. Manager uses a scoped service
adapter for agent execution and native Editor operations; human authentication
continues to be Manager/Auth-owned. Mastra Studio gateway authorization is not
implicitly granted by access to Manager.

**The worker owns media execution.** A credential-free execution child handles
generated code; a trusted broker handles bounded asset download, result hashing,
and upload. Reuse a fixed prebuilt host bundle, compiling generated TSX as input
inside the isolated runtime. No arbitrary server-side package installation or
credential-bearing code evaluation. If the current Railway worker cannot provide
the necessary process isolation, use a separate isolated execution service on the
same approved infrastructure; prove this in feat-453 before committing the runtime.

**Neutral contracts own portable data shapes.** Introduce proposed
`packages/studio-contracts` for Zod schemas/types used by Admin, Manager, Mastra,
and the worker. It has no React, provider, Prisma, or app imports. Reuse
`packages/admin-graphql` for generated GraphQL clients and shared operations; do
not hand-edit introspection outputs or move product schemas into the renderer.

The initial external interface comprises read/list, create, apply operations,
request generation, approve script, request narration/render, approve publication,
publish, and unpublish. These may map to distinct GraphQL mutations but share
one product module. UI/MCP tools should expose meaningful operations rather than
arbitrary database patches. Each mutation carries authenticated actor context,
`expectedRevision` where applicable, and an idempotency key for side effects.

```ts
type StudioOperation =
  | { kind: "set-text"; itemId: string; text: string }
  | { kind: "move-item"; itemId: string; trackId: string; startFrame: number }
  | { kind: "trim-source"; itemId: string; startMs: number; endMs: number }
  | { kind: "set-properties"; itemId: string; properties: JsonObject }
  | { kind: "insert-item"; item: TimelineItem }
  | { kind: "remove-item"; itemId: string }
  | { kind: "assign-content-pack"; packRevisionId: string }

type ApplyStudioOperations = {
  projectId: string
  expectedRevision: string
  idempotencyKey: string
  operations: StudioOperation[]
}
```

These names are proposed contracts, not existing exports. Complete the operation
set against actual NLE behavior in feat-454; constrain properties to registered
item/component schemas. Full-document restore also passes the same revision and
publication checks. Revision protection is mandatory on every caller, including
background result attachment. Notifications distribute accepted state; CRDTs are
not needed to begin.

## Proposed durable data model

Implement additive migrations with narrow named models; finalize names in feat-454.

| Record                                  | Responsibility                                                                                                                             |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `StudioProject`                         | Stable ID, author language, current revision, owner/context, optional schedule, publication state, permanent `firstPublishedAt` latch.     |
| `StudioProjectRevision`                 | Immutable bounded composition document; actor, source/pack/component references and dependency hashes.                                     |
| `ContentPack` / `ContentPackRevision`   | Editable pack identity and immutable versions of source references plus guidance; never a viewer video collection.                         |
| `StudioAttempt`                         | Generation/narration/render attempt identity, input hashes, base revision, job reference, status, costs and recoverable result references. |
| `StudioApproval`                        | Explicit SCRIPT or PUBLICATION approval bound to effective dependencies; stale approvals cannot authorize work.                            |
| `StudioPublication`                     | At most one successful publication per project; immutable output/catalog identities and exact published snapshot.                          |
| `StudioPlanSlot`                        | Date/timezone/title/theme/pack suggestion; optional project link; planning never implies production authorization.                         |
| `MediaAsset` extensions / usage records | Audio type and role, provenance, source text/model/voice settings, checksums and usage edges, without creating another blob registry.      |
| Generated-video derivation records      | Output Video to source Video/Dub/Edition and exact source ranges; retain pack/source excerpts and composition provenance.                  |

Existing `apps/admin/src/services/media-asset.usage.ts` discovers only Experience
and Video locale usage; it does not already persist Studio usage records. Add
durable edges from project revisions, attempts, packs, components, and publications
to immutable asset versions. Extend generic asset deletion/replacement/visibility
checks to consult them. Replacing bytes creates a new asset/version; old published
references keep their original bytes and metadata snapshot. Keep all assets initially,
including unselected experiment candidates.

Large media, source documents, and generated code bundles live in existing private
object storage; durable workflow messages carry bounded IDs/hashes, not bytes or
unbounded transcripts. Admin owns asset registration and lifecycle; the existing
Manager storage adapter may perform byte I/O under that module's authorization.
The trusted broker issues per-attempt transfer capabilities. Generated code and
worker children never receive object-store/provider credentials. Do not transfer
ownership of the old devotional Workspace through incidental reuse of its classes.

Pack revisions store source references and guidance. Resolve/download content on
request and retain effective content identity/excerpts used by each attempt.
Start with exact passage/document selection from the provided corpus and Forge
media; vector indexing/RAG expansion is not a prerequisite and must reuse the
existing RAG service if later needed, not introduce another vector store.

## Editing, generation, and approval semantics

Separate independent concerns instead of one overloaded status enum:

- Project lifecycle: `DRAFT -> PUBLISHED -> UNPUBLISHED`; no backward transitions.
- Attempts: queued/running/succeeded/failed/cancelled/stale; success does not mean published.
- Script approval: hash all effective spoken content, including bridge/settle lines
  and suppression choices, not only visible reflection text.
- Publication approval: exact project revision, renderer/component versions, source
  dependencies, audio, and render manifest identity.

While lifecycle is DRAFT, all edits are allowed. Text changes invalidate affected
speech and SCRIPT approval; visual-only edits can preserve matching speech.
Every content edit invalidates PUBLICATION approval for the previous revision.
Completed stale jobs retain assets for possible reuse but do not replace current
content. Undo is another validated revision and never reopens published content.

Narration cache identity includes exact spoken text, role, voice/provider/model,
voice settings, pronunciation dependency/version, and language. Paid regeneration
is an explicit action after script review. Also implement explicit music and voice
experiments: show estimated cost, generate audition candidates only on operator
request, retain original provider/settings/prompt provenance, and let Lyuba select
a candidate for the shared library or project. Experimentation is a real product
operation, not just an import path; it never runs automatically on a library miss. Layout edits alone do not bill TTS.
Linked timing ripples by default; locked timings surface an actionable conflict
rather than shortening speech. Narration, music, video audio, and captions each
retain their own time mapping to the composition.

Mastra Editor is the new agent's instruction authority. Expose draft/test/compare/
publish/restore through an authenticated Studio adapter. Record effective prompt
block versions/content hashes because an agent version can refer to moving blocks.
Tests compare saved examples; they do not silently modify live prompts. The external
Claude client can retrieve guidance or invoke the hosted agent; its own system
prompt is not controlled by Mastra. All clients remain subject to product controls.

## Source media and dynamic composition

Discovery may use existing search interfaces; final resolution must identify the
exact `Video`, `VideoDub`, `VideoEdition`, and subtitle track. `preferredPlayableDub`
and search can return another language: check returned identity, not just requested
locale. `Video.moments`/search transcript snippets are not full canonical subtitles.
Fetch timed track bytes, retain a digest, and maintain source-to-composition ranges.
A primary/non-AI label is a selection signal, not proof of immutable verified text.
When no eligible track exists, select another source or block for Lyuba. Source
eligibility includes current access and Watch/platform restrictions. Recheck sources
at publication, preventing a new generated Video from bypassing restrictions on its
inputs merely by acquiring a new catalog identity.

Custom component versions declare code hash, supported dependencies, dimensions,
duration policy, asset references, and editable props schema. Unknown layouts remain
possible through new component code. NLE item transforms and exposed props are
editable; internal arbitrary React objects do not magically become timeline items.
Handle compile/render errors as item/job failures with diagnostics. Version the
runtime and component dependencies with the project and exported output.

The proof in feat-453 must use HLS source footage in preview and high-quality
source media at export with the same trim/subtitle semantics. Remotion's current
HLS path chooses the highest track; measure a deliberately lower-cost preview
strategy and seeking performance. Do not claim an adaptive preview from URL shape.

## Catalog identity and publication

A generated video must enter the normal Admin catalog, not exist only as a Mux ID
or generic Manager job. `Video`, `VideoDub`, and `VideoEdition` currently require
unique Core IDs. Proposed correction: allow absent Core IDs for MANAGER-origin
records, retain the constraint for CORE-origin rows, and use Forge IDs/slugs as
canonical identity. Feat-459 owns the migration, GraphQL nullability and complete
consumer/sync audit. Do not manufacture fake Core IDs to satisfy existing fields.
If evidence requires a different schema, record the alternative before coding it.

Create hidden staged Video/locale/dub/edition/Mux associations and derivation edges
idempotently. Final publication is an Admin transaction that checks current DRAFT
revision, valid approval, matching verified render, language, Mux readiness and
schedule eligibility, then makes the catalog content visible and sets the permanent
publication latch. A simultaneous edit either commits first and invalidates the
publish request, or loses to publication and is rejected. Never hold a database
transaction open while rendering or calling Mux.

Use a durable intent/outbox for external side effects and reconciliation. Mux
upload success, MP4 existence, job completion, and public visibility are distinct.
Retries reconcile the same identities rather than uploading/publishing duplicates.
Guard generic Admin mutations and direct MCP/GraphQL paths too; `locked` UI state
is not sufficient to enforce immutability. Core sync must not replace MANAGER
records. No correction clone, content replacement, or republish command exists.

Publication/unpublication updates all relevant Watch visibility predicates,
route manifests, cache invalidations, search/index eligibility and related-video
reads. Provide a Watch entry point for the published devotional and its source
relationships; catalog insertion alone does not satisfy the release.
Generated draft playback/downloads stay authorized. Avoid persistent signed URLs:
store asset/playback identities, and issue short-lived access under current
visibility. Prove unpublished content stops receiving public playback access,
including the policy used for Mux playback; existing downloaded exports cannot be
recalled. This playback integration is part of feat-460, not a claim that current
Watch consumers already support it.

## Delivery sequence and roadmap

Each ticket is a scoped deliverable; split its implementation into focused PRs
where schema, runtime, and UI changes require receiver-first rollout. Estimates
and start dates in frontmatter are planning placeholders, not delivery promises.

| Ticket   | Deliverable                                          | Depends on         | Exit evidence                                                                        |
| -------- | ---------------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------ |
| feat-452 | Preserve and characterize Lyuba's complete baseline  | —                  | Branch ancestry, asset hashes, reproducible saved-example coverage.                  |
| feat-453 | Prove isolated dynamic preview and export            | —                  | One generated component with editable props, real media and contained failures.      |
| feat-454 | Durable project model and revision-checked commands  | 453                | Database concurrency and publication-latch tests; generated contracts.               |
| feat-455 | Content Packs, shared assets, exact media resolution | 452, 454           | Pack revisions, narration metadata, exact-language/time mapping tests.               |
| feat-456 | Standalone NLE in Studio                             | 453, 454, 455      | Save/reload/undo, manual edits, browser playback and load-performance evidence.      |
| feat-457 | Mastra configuration, hosted agent and MCP           | 454, 455, 456      | Both clients perform the same attributed edits; native prompt lifecycle tested.      |
| feat-458 | Generation and narration review workflow             | 452, 455, 456, 457 | Script gate, incremental audio, linked timing and stale-result recovery.             |
| feat-459 | Generated catalog identity and provenance            | 454, 455           | Native generated Video/Dub/Edition without fake Core IDs; sync/client compatibility. |
| feat-460 | Render, immutable publication and Watch              | 456, 458, 459      | Actual render-to-catalog-to-Watch path, race tests and unpublish enforcement.        |
| feat-461 | Planning calendar and scheduled release              | 455, 457, 460      | Titles/themes-only automation, explicit production, timezone/idempotency tests.      |
| feat-462 | Shorts cutover and release verification              | 461                | Lyuba acceptance plus complete runtime, performance and operational evidence.        |

The first useful operator checkpoint is feat-456: create a standalone project,
select Forge footage, manually arrange it, save, reopen and preview. The first
agent checkpoint is feat-458; first public delivery is feat-460. Calendar work
must not delay testing the standalone authoring path. Feat-459 can run alongside
editor/agent work after the product and asset contracts settle.

## Verification strategy

Test behavior at the shared command interface and real integration points. Include:

- Two writers on the same revision; stale agent completion after manual changes;
  undo with publication latch; timing ripple versus manual lock.
- Full spoken-text fingerprint coverage; visual changes reuse speech; voice/model/
  pronunciation changes cannot falsely hit cache; planning has no TTS/render calls.
- Wrong-language fallback, wrong-edition subtitles, source mutation, clip end and
  silent beats, multiple source cuts, and high-quality export alignment.
- Generated-code compile failures, infinite work/timeouts, forbidden network access,
  credential absence, iframe/process containment and preview/export equivalence.
- Separate Postgres and object-storage tests with real reads/restarts; never treat
  mocks or green typechecks as evidence of deployment readiness.
- Mux timeout/duplicate callbacks, render recovery, edit-versus-publish race,
  immutable catalog mutations, public visibility and unpublish across read paths.
- Calendar days/timezones/DST, duplicate planner runs, manual overrides, no automatic
  script generation, no substituted content when a slot fails or lacks approval.

For each schema-changing PR, regenerate and check consumers in the same scope:

```bash
pnpm --filter @forge/admin db:generate
pnpm --filter @forge/admin schema:print
pnpm --filter @forge/admin-graphql generate
```

Run focused Vitest suites plus touched-package typecheck/lint/build scripts.
Manager and Web changes need real production builds and browser checks, not only
TypeScript. Preserve Remotion package version-lockstep and React-free server import
tests. Run HTTP-driven worker container smoke: the image must actually compile,
launch Chromium, resolve fonts, access media and export the expected output.
Do not run database migration commands against shared environments as a test.

Capture a baseline before changing Studio loading; compare the same fixture and
network conditions afterward. Record cold/warm load, transferred JS/media, time to
usable controls, preview startup, seek behavior and main-thread long tasks. Proposed
acceptance is no material regression in shell loading, no compiler/media downloads
on list/calendar routes, responsive local property edits, and bounded cold preview
startup. Establish numerical budgets from the baseline in feat-453/456 rather than
inventing latency promises. Repeat equivalent load checks for the Watch release path.

## Rollout, retirement, and documentation

Follow normal PR-to-main Railway deployment; no direct worktree production deploy.
Use receiver-first contract rollout and an initially disabled replacement entry
point while stages land. Keep automatic generation and publication independently
controllable; the calendar planner never receives paid-generation capabilities.
Use signed-in Studio operator access, scoped MCP tokens and attributable service
calls; do not expose Manager's broad API key to browsers or external Claude clients.

At cutover, remove the old Shorts creation/draft/caption/clone flow and obsolete
navigation, tests and instructions; retire only its exclusive runtime paths after
tracing other consumers. Do not delete shared worker/devotional modules merely
because their paths contain "shorts". No legacy data migration is required.
Update old roadmap tickets with explicit supersession notes, preserving historical
completion evidence rather than marking abandoned old acceptance criteria as met.

Update package guides in the implementation PRs: Manager's Whisper-specific Shorts
rules no longer apply to the replacement; Mastra's legacy date-keyed Workspace
exception is not the new architecture; native Editor becomes the instruction
authority for the new agent, without changing Seeker's separate prompt contract.
These are explicitly planned consequences of the user-approved scope, not new
permission requests. Document the new glossary/invariants and durable findings.

The Compound Engineering commands are not available in the current skill/tool
inventory. This explicit plan and roadmap represent the planning stage; subsequent
work must include scope-focused review and durable learning capture. No CE command,
runtime test, or production operation is claimed to have run during planning.
