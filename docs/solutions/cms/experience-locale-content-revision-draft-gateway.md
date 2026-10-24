---
title: "Use one ContentRevision draft gateway per Experience locale"
category: cms
module: "Admin Experience publishing"
date: 2026-08-20
last_updated: 2026-08-21
problem_type: architecture_pattern
component: service_layer
related_components:
  - data_model
  - api_layer
  - frontend
severity: high
applies_when:
  - "Editing published Experience content without changing the live page"
  - "Exposing a shareable preview that follows the active draft lifecycle"
  - "Keeping Admin UI, GraphQL, MCP, and AI editing on one draft contract"
  - "Treating each language-specific Experience as an independent publishing unit"
tags:
  - experience
  - drafts
  - content-revision
  - publishing
  - preview
  - graphql
  - mcp
  - ai
---

# Use one ContentRevision draft gateway per Experience locale

## Context

Experience translations are independent publishable records, not fields on one shared translated row. The parent `Experience` owns non-localized concerns such as `isTemplate`, ownership, and archival state, while `ExperienceLocale` owns locale-specific content and its publish lifecycle (`apps/admin/prisma/schema.prisma:2208-2233`). The database also permits only one locale record for each `(experienceId, locale)` pair (`apps/admin/prisma/schema.prisma:2280-2286`). Consequently, English and Russian versions of the same parent Experience can each have their own draft without colliding.

The staging problem is to let every editing surface work on unpublished changes while ordinary public reads continue to see canonical content. Solving this independently in the Admin editor, GraphQL, MCP, and AI chat would allow those surfaces to disagree about which version is editable. The durable boundary is therefore the locale service, with one active `ContentRevision` keyed by `ExperienceLocale.id`.

This pattern shipped in [PR #1983](https://github.com/JesusFilm/forge/pull/1983). Release verification included focused Admin and Web suites, type/build/lint/format/schema/codegen and CI checks, followed by a production browser exercise of an English “Exploring Faith” draft: save and refresh persistence, a stable preview reflecting a later edit, unchanged live content, immediate UI restoration after discard, and a real 404 from the retired preview URL (session history). Treat those observations as release evidence, while the current source and tests below define the continuing contract.

Two QA dead ends shaped the prevention rules (session history): a rendered 404 page was not sufficient because the underlying HTTP response initially remained 200, and a metadata-only marker was not visible in the preview, so preview-freshness checks should use visible content.

## Guidance

### Make the active revision a complete locale snapshot

Keep the revision payload limited to locale-owned fields. `ExperienceLocaleDraftDataSchema` requires the route fields, title and SEO fields, image, and blocks as a complete object; the versioned envelope is `{ v: 1, data }` (`apps/admin/src/services/experience.schemas.ts:66-85`). `isTemplate` does not appear in that schema because it remains parent-scoped (`apps/admin/prisma/schema.prisma:2208-2217`).

On every save, acquire a row lock on the locale, load canonical content, then load the active revision for the same `ExperienceLocale.id`. Merge the caller's partial patch over the effective active snapshot, or over canonical content when no draft exists, and validate the resulting complete snapshot before persisting it (`apps/admin/src/services/experience.service.ts:160-194`). This preserves convenient partial-update APIs without letting a partial draft become the source of truth. The compatibility merge also fills fields missing from older or externally created snapshots with canonical values (`apps/admin/src/services/experience.service.ts:125-135`).

Update the existing revision rather than replacing it. The service retains a non-null preview token and only mints a 32-byte base64url capability when the draft is new or an older draft lacks one (`apps/admin/src/services/experience.service.ts:197-225`). The database enforces at most one active draft for an entity with a partial unique index on `(entity_type, entity_id) WHERE status = 'draft'` (`apps/admin/prisma/migrations/0001_init/migration.sql:78-82`) and enforces token uniqueness (`apps/admin/prisma/migrations/0052_experience_draft_preview_token/migration.sql:1-5`).

Use intentional last-completed-save-wins semantics for the shared draft. The `FOR UPDATE` locale lock serializes writers, and `READ COMMITTED` lets a waiting writer observe and merge the preceding committed snapshot (`apps/admin/src/services/experience.service.ts:160-188`, `apps/admin/src/services/experience.service.ts:244-248`). The concurrency regression test models two overlapping partial saves and verifies that both fields survive in the shared snapshot (`apps/admin/src/services/experience.service.test.ts:739-850`). This is a deliberate collaboration policy, not accidental absence of conflict detection.

### Expose canonical and effective state explicitly

Editor reads should return three concepts: the canonical locale, the effective editable locale, and optional active-draft metadata. `getLocaleDraftState` performs the permission check before reading the revision and overlays the validated draft onto canonical content when one exists (`apps/admin/src/services/experience.service.ts:251-304`). The GraphQL draft-state type exposes `canonical`, `effective`, `hasDraft`, and `activeDraft`, while keeping the preview bearer capability behind write authorization (`apps/admin/src/graphql/types/experience.ts:118-205`, `apps/admin/src/graphql/types/experience.ts:278-291`).

Route every mutation surface through this gateway:

- Admin Save calls `ExperienceService.updateLocale`, and the page is initially populated from `draftState.effective` (`apps/admin/src/app/dashboard/experiences/[id]/page.tsx:279-284`, `apps/admin/src/app/dashboard/experiences/[id]/page.tsx:429-487`).
- GraphQL mutations are thin adapters over `updateLocale`, `publishLocale`, `discardLocaleDraft`, and revision restoration (`apps/admin/src/graphql/mutations/experience.ts:34-119`).
- MCP dispatch exposes locale read/list/validate/diff/create/update/publish/discard/preview tools (`apps/admin/src/app/mcp/route.ts:150-167`); update, publish, discard, and preview delegate to `ExperienceService` rather than writing persistence directly (`apps/admin/src/services/experience-locale-mcp.service.ts:431-509`). MCP draft-state serialization preserves both canonical and effective shapes and uses the effective shape for its backwards-compatible `locale` alias (`apps/admin/src/services/experience-locale-mcp.service.ts:967-988`).
- AI chat reads the same effective state before generating the next edit (`apps/admin/src/services/experience-ai/experience-ai-chat.service.ts:667-681`) and persists its validated patch through `stageLocaleDraft` with AI attribution (`apps/admin/src/services/experience.service.ts:937-999`).

New Experiences and newly added locales should start with the minimum canonical identity row and put authored content in an initial active revision. Both creation paths create the locale and full draft together in a transaction (`apps/admin/src/services/experience.service.ts:334-380`, `apps/admin/src/services/experience.service.ts:412-441`).

### Make publish and discard lifecycle transitions, not alternate save paths

Publish must be atomic. Under a locale row lock, read the active draft, create a historical snapshot of the prior canonical locale, apply the complete draft to canonical with published status and timestamp, and then mark the draft historical with the same application timestamp (`apps/admin/src/services/experience.service.ts:617-688`). Only after that transaction does the service request public revalidation and route-manifest refresh (`apps/admin/src/services/experience.service.ts:690-715`). Save therefore cannot leak staged fields into ordinary public pages or prematurely refresh public routes; the service regression test asserts that staging a published locale does not refresh the public manifest (`apps/admin/src/services/experience.service.test.ts:611-627`).

Discard takes the same locale lock, marks the active revision `DISCARDED`, and returns the untouched canonical row (`apps/admin/src/services/experience.service.ts:735-769`). Its regression test verifies that no canonical update or public manifest refresh occurs (`apps/admin/src/services/experience.service.test.ts:1122-1147`). The Admin server action returns canonical field values after discard (`apps/admin/src/app/dashboard/experiences/[id]/page.tsx:521-547`), and the client immediately resets every scalar, block selection, draft flag, and preview URL before refreshing (`apps/admin/src/app/dashboard/experiences/experience-editor.tsx:10029-10069`). Preserve the corresponding UI regression assertion that the title visibly returns to its published value (`apps/admin/src/app/dashboard/experiences/experience-editor.test.tsx:2401-2456`); server correctness alone is insufficient if stale local editor state still looks like an active draft.

### Treat preview URLs as draft-lifetime capabilities

Resolve preview tokens only against `ContentRevision` rows whose entity type is `ExperienceLocale` and whose status remains `DRAFT`. Validate the snapshot and require a non-archived parent; never fall back to canonical content for a malformed, retired, foreign, or invalid capability (`apps/admin/src/services/experience-preview.service.ts:22-80`). Because publish changes the revision to `HISTORICAL` and discard changes it to `DISCARDED`, the same stable token automatically stops resolving at the end of the draft lifetime (`apps/admin/src/services/experience.service.ts:681-684`, `apps/admin/src/services/experience.service.ts:746-764`).

The Web preview must remain dynamic and uncached and must call `notFound()` when capability resolution returns null (`apps/web/src/app/(preview)/preview/experience/[token]/page.tsx:25-43`, `apps/web/src/app/(preview)/preview/experience/[token]/page.tsx:96-102`). Its route and layout both advertise no-index/no-follow/no-archive behavior and no-referrer policy (`apps/web/src/app/(preview)/layout.tsx:7-20`, `apps/web/src/app/(preview)/preview/experience/[token]/page.tsx:29-43`), while the proxy adds private no-store, `X-Robots-Tag`, and `Referrer-Policy` response headers specifically for the preview prefix (`apps/web/src/proxy.ts:156-160`, `apps/web/src/proxy.ts:701-706`). The sitemap generator emits only manifest video-route groups and the fixed home entries, so it has no path that inserts capability URLs (`apps/web/src/lib/watch-sitemap.ts:203-236`).

Browser QA for PR #1983 found that a segment-level loading boundary could allow a streamed response to commit HTTP 200 before the invalid capability reached `notFound()` (session history). Keep an explicit deployed assertion that a retired token returns a genuine HTTP 404, not merely a page that displays 404 content. The route-level unit test protects the `notFound()` branch (`apps/web/src/app/(preview)/preview/experience/[token]/page.test.tsx:138-147`), but it cannot replace the HTTP-level check.

## Why This Matters

A single aggregate gateway makes Save, Preview, Publish, and Discard mean the same thing across every editor. Complete snapshots make preview and publication deterministic, while partial API inputs remain ergonomic. Locale identity isolates languages naturally, the row lock gives the accepted collaboration policy a precise concurrency meaning, and status-based capability resolution invalidates previews without an expiry scheduler or separate token revocation table.

This boundary also prevents two subtle regressions that database-only testing misses: a correct discard can still leave stale draft state in a client, and a correct `notFound()` branch can still produce the wrong HTTP status when streaming begins too early. Both are part of the lifecycle contract and deserve browser-level coverage.

## When to Apply

- A published locale must remain live while an editor prepares changes over multiple saves.
- Several interfaces—Admin UI, GraphQL, MCP, or AI—can edit the same locale aggregate.
- Translations publish independently and must not share a draft keyed by the parent Experience.
- The team accepts one shared draft and last-completed-save-wins instead of per-editor branches or optimistic conflict rejection.
- Reviewers need a shareable preview URL that follows the latest saved draft but is unlisted, uncached, and invalid after publish or discard.

Do not put parent-level settings such as `isTemplate` into this locale revision. Do not reuse this pattern unchanged when the product requires concurrent named drafts, approvals, scheduled expiry, or conflict detection; those requirements need a different identity and state model.

## Examples

Suppose the English homepage is already published. Saving a title change creates or updates the English locale's active revision and leaves the canonical English row untouched. A later MCP blocks-only update reads the effective English snapshot first, merges the new blocks, and retains the staged title. The ordinary homepage continues to render canonical data, while the stable capability URL renders the updated revision. Saving Russian content targets a different `ExperienceLocale.id`, so the database permits a separate Russian draft.

Publishing English creates a historical snapshot of the former English canonical row, copies the full English draft into canonical, and retires only the English revision. Its preview token then resolves to null because it is no longer attached to a `DRAFT`. Discarding Russian instead marks only the Russian revision discarded, returns Russian canonical values to the editor, and leaves both the English publication and Russian live page unchanged.

For prevention, keep a verification matrix that covers: first save, partial save over an existing draft, overlapping saves, locale isolation, refresh persistence, stable preview URL after another save, unchanged live content before publish, atomic publish, immediate client reset on discard, crawler and cache headers, and a real HTTP 404 for the retired token. The current service, editor, preview-page, and proxy tests provide the focused anchors cited above; repeat the end-to-end path in a real browser for changes to routing, streaming, hydration, or editor state.

## Related

- [PR #1983](https://github.com/JesusFilm/forge/pull/1983)
- `docs/plans/2026-08-20-1607-feat-experience-draft-staging-plan.md`
- `docs/solutions/cms/admin-app-data-model-decisions.md`
- `docs/solutions/architecture-patterns/oauth-protected-mcp-tool-parity-pattern-20260721.md`
- `docs/solutions/architecture-patterns/mastra-seo-experiment-ledger-boundary.md`
