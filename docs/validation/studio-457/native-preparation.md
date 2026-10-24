> Historical validation summary. Raw artifact paths and original checksum inventories below refer to the [preserved archive](../STUDIO-ARCHIVE.md); they are not a current checkout file inventory. Test fixtures remain in Git.

# feat-457 preparation findings

Preparation only, 2026-09-07. No tracked implementation edits, no shared database access, no paid providers, no push/deploy/upload. Implementation gate remains closed pending reviewed455/456 and coordinator release.

## Reviewed baseline

Incorporated in requested order: 29c187d2 -> fd01ed22; fe7425a2 -> bbb6fd52; bfe7421c -> bf080f2d; e08ce7d6 -> 6997dfba; 55bd5f11 -> 8275feed; 037ff6d8 -> 1aa423ab. Working tree clean after frozen-lockfile pnpm install (normal prepare/postinstall hooks enabled).

## Actual native API evidence

Installed core1.55.0/editor0.13.9/pg1.18.1, CLI1.21.0. Main runtime explicitly uses MastraEditor and composite storage with Postgres default/schema mastra; only observability uses DuckDB. Probe uses native Postgres/composite/Editor without importing application bootstrap or env. Database is the dedicated own cluster 127.0.0.1:55457/forge_studio_457_test; data and logs under this directory.

`probe.mjs` invokes native Agent.generate with ai/test MockLanguageModelV3, whose deterministic response echoes the system instruction it received. It exercises actual Postgres and native Editor resolution, not a storage double. This is selected-prompt execution proof, not actual paid generation, editorial quality or end-to-end hosted HTTP proof. `results.json` records version UUIDs, provider-observed texts and SHA256 values. `reopen.mjs` confirms active/draft/history identities after actually stopping and restarting this Postgres cluster.

Verified:

- `storage.getStore('agents')` and `getStore('promptBlocks')` provide getById, getByIdResolved, createVersion, getVersion, getLatestVersion, listVersions, update.
- Thin entity records hold activeVersionId/status; native snapshot rows hold bodies and version identities. No new prompt-body table needed.
- CRITICAL: editor.agent.update({id,instructions}) creates a version AND updates activeVersionId automatically. This is unsuitable for Save Draft under explicit-activation requirements. Use native agents.createVersion with complete snapshot, generated UUID/versionNumber, conflict retry and expected-draft checks. Explicit activation updates activeVersionId/status only after operator action.
- editor.prompt.update({id,content}) creates a new draft version without moving activeVersionId. Actual provider still receives old published text until explicit activation.
- CRITICAL: editor.prompt.getById(id,{status:'draft'}) ignores options in this installed adapter; the adapter only forwards id. Native promptBlocks.getByIdResolved(id,{status:'draft'}) returns the real latest draft. Likewise use direct native version selection for exact block reads.
- editor.prompt.preview(blocks,context) includes latest drafts and templates. It does not activate anything.
- editor.agent.applyStoredOverrides(codeAgent) defaults to draft. Pass {status:'published'} or {versionId} explicitly. It returns a fork and keeps code-defined model; editor:{instructions:true,tools:false} preserves fixed tool authority.
- An explicit agent version does NOT pin referenced blocks. prompt_block_ref is only {type,id}, no version selector. The fork resolves active blocks when getInstructions/generate runs, after selection. Probe creates a pinned fork, activates a new block, then observes the NEW block in generation.
- Agent draft selection does not automatically select draft prompt blocks: resolveStoredInstructions delegates resolveInstructionBlocks without includeDrafts. UI test selection must resolve the intended block snapshot explicitly.
- Restoring old active pointers returned old effective text. Copying an old snapshot into a new native draft version preserved active version, with history retained across Postgres restart.

Implementation implication: at admission read exact agent snapshot and referenced block snapshots once, resolve those same frozen snapshots through native resolveInstructionBlocks (including templates/conditions), record agent/block UUIDs and hashes plus final resolved instruction digest, and execute a per-attempt immutable instruction string. Do not record hashes and then let native reference lookup resolve again after admission. Fail closed on absent/unpublished/mismatched snapshots rather than allowing native skip/fallback behavior to silently change prompt identity. Keep persisted instruction bodies exclusively in native snapshots; attempt provenance stores identities/digests.

Source-inspected native HTTP routes (not yet executed through HTTP): /api/stored/agents/:agentId/versions supports list/get/create, /versions/compare, /versions/:versionId/activate and /restore. Prompt blocks mirror this under /api/stored/prompt-blocks/:promptBlockId. Version CREATE handler snapshots CURRENT configuration, accepts changeMessage rather than arbitrary draft content. ACTIVATE validates parent/version then update({activeVersionId,status:'published'}) and clears cache. RESTORE creates a new version. Generic server handlers enforce a retention limit; do not expose deletion/pruning through Studio where provenance must remain resolvable.

## Auth/transport findings

- apps/manager/src/lib/auth.ts authenticateInteractiveManagerRequest reads signed Manager session and revalidates ManagerMembership through Admin; it rejects bearer-only review. Generic authenticateRequest also accepts MANAGER_API_KEY, so it is not Studio's agent authorization boundary.
- apps/manager/src/lib/admin-manager-session.ts obtains an Auth client_credentials token for resource /api/manager/session and scope admin:manager-session:validate, falling back to ADMIN_MANAGER_API_KEY. This resource is session validation, not general agent commands.
- apps/admin/src/auth/manager-service-token.ts introspects active token, issuer, exact audience, client ID, environment, scope, expiry.
- apps/manager/src/backend/studio-client.ts exports createStudioAdminAdapter(transport); AdminGraphqlClient.studio currently uses backend service transport. Commands create/apply/request/start/complete/approve/unpublish plus read/list/history/attempts/approvals all pass canonical schemas. No public publish method exists.
- Foundation studioActor maps canReviewStudio users to human, MANAGER_BACKEND/SYSTEM to service. approve/unpublish demand human; start/complete demand service. Principal and StudioActor currently lack delegated-client provenance. Do not promote a delegated OAuth user into interactive reviewer by supplying ordinary user principal.
- apps/admin/src/auth/admin-mcp-oauth.ts verifies JWT issuer/audience/scopes, optional client allowlist/environment, optional app claim; resolves user by email then subject and returns ordinary Principal. This is an existing Experience precedent, not a safe Studio review capability. Missing client_id is allowed even when allowlist configured. New Studio verifier should require exact intended client/product/environment and retain subject/client/delegation independently; do not change unrelated Admin MCP behavior.
- Auth's apps/auth/src/domain/{apps,scopes,oauth-resources}.ts owns registered apps, grants/scopes and resource policy. Current catalog has admin-mcp/changelog-mcp/manager-session, no Studio MCP. apps/auth/src/auth/config.ts mints trusted resource-derived app/environment claims for admin-mcp, while other resource paths can use client metadata. Add Studio resource-specific claims narrowly without widening generic OAuth/DCR/custom-audience behavior.
- New external scopes should cover read/edit/request/instructions-read or draft/test as approved; exclude SCRIPT/PUBLICATION review, publish, persistent activation. Those remain explicit interactive human operations. Hosted tool execution must be distinguishable from the initiating human even if it uses that user's OAuth grant.
- Native Mastra /api/agents/\* and stored editor routes are framework-exposed. Existing architecture protects generic API via gateway/network, not Forge service auth. Studio must not be bypassable via direct native route, stored tool override or body.requestContext impersonation. Native requestContext merges caller body keys; trusted authority cannot be a client-supplied boolean/string or leaked marker. Keep Studio routes targeted rather than breaking unrelated Studio/Seeker/Workspace APIs.

## Coordination / remaining gates

Coordinator and456 received exact review/delegation distinction and acknowledged it.456 owns final trusted interactive human transport;457 consumes reviewed public API and adds delegated hosted/MCP seam. No unreviewed worktree imports.

After gate release: mark ticket in-progress, add explicit implementation scope, TDD at agreed seams, full Manager chat/diagnostics/proposals/undo and native instruction UI, scoped Auth/MCP and hosted agent. Test actual command scenario across manual/hosted/external with actor history, stale revisions, denied scopes/human review impersonation, streamed failures and explicit activation. Full affected test/typecheck/build/schema/performance evidence, independent Standards+Spec review and hooks-enabled implementation commits then compound/ticket complete. Actual provider/generation proof stays458. Current preparation is not ticket completion.

## Reviewed455 preparation update

Incorporated c04509e400308a1ebc10a09c0193b947339cf34e as 2db98d20 and370da45dec960615ac5f7294a65b525dea2dd58c as c81fc94b, in order. Read durable studio-shared-assets-and-source-retention handoff and final portable assets/content-packs/sources/experiments contracts. No implementation edits or database migrations run.

- Consume neutral subpaths and Admin GraphQL; no cross-app imports. Pack guidance is separate from immutable source evidence. Assets use exact assetId/versionId/digest.
- Source descriptors do not prove retained media or render eligibility; use canonical source snapshot plus CURRENT eligibility and broker materialization. Do not substitute media language/edition/track.
- Experiments require explicit human admission with settings, unexpired estimate, confirmed:true, count/cost ceiling. confirmed:true is input acknowledgement, not trusted human identity. request() currently uses actor.kind human, so the same delegated-authority exclusion must cover experiment admission as SCRIPT/PUBLICATION approval. Candidate attachment and materialization require trusted service.
- Completed experiment candidates retain matching settings/provenance even on overruns; actualCostMicros aggregate is decimal string and outcome carries cost/count flags. No dispatch on cache miss/admission;458 owns paid execution/budgets.
- Read/upload capabilities are five-minute bounded tokens; never treat them as generic agent credentials or log/store returned secrets in model history.

457 gate remains closed pending reviewed456. Existing native probe artifacts are preserved unchanged.

## Reviewed455 correction, 2026-09-08

Incorporated reviewed dd3465cc exactly once as370cb614a046a3c08c07846fc501acaf94eb9c03. Additive0078a_studio_source_revision_guard parenthesizes JSON extraction before range-key subtraction in studio_validate_source_references; source-revision.db.test.ts supplies reviewed real-Postgres regression. Inspected migration; no local migration or regression execution claimed in this preparation step. Tree clean and457 gate unchanged: await reviewed456 and explicit release.

## Reviewed459 alignment, 2026-09-08

Incorporated reviewed3bfe2ecc252ddd8c2761f9e8fff577ed90f8e384 as20b3f523 and88b835e1063bf141e2571ab62873a7e65affba9c as6fc2e29e, in order; existing dd3465cc equivalent370cb614 retained once. Read only final @forge/studio-contracts/catalog and studio-generated-catalog-identity durable handoff. No tests/migrations/implementation work performed.

Tool eligibility: catalog staging is trusted-service only, never a manual/delegated tool bypass. Stage envelope binds revision/idempotency/render attempt to signed/ready Mux identity; retained render report binds exact input/output digest, runtime, language, dimensions and timing. Declared JSON verification is not actual codec/Mux proof (460 owns that). Staging stays hidden: DRAFT locale, unpublished/non-downloadable dub, no-index Video, no public HLS. No publication command. Current source eligibility/restrictions and materialized coverage remain mandatory. Use Forge identities with nullable Core IDs; do not manufacture Core IDs or route Studio through legacy Core-only clients.457 remains gated on final reviewed456 and explicit release.
