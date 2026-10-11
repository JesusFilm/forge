---
id: "feat-620"
title: "Build the RAG Consumer Manual with database-backed filters and code samples"
owner: "jaco"
priority: "P1"
status: "not-started"
start_date: "2026-09-30"
duration: 5
depends_on: []
blocks: ["feat-576"]
tags: ["rag", "portal", "documentation", "ready-for-agent"]
---

## Problem

Consumers can manage access and view sources, but cannot learn how a use case
maps to a retrieval policy or obtain a matching request in their language.
The historical manual is detached from the portal and omits current fields.

## Entry Points — Read These First

1. [Implementation spec](../../plans/2026-09-30-001-rag-consumer-manual-spec.md) — authoritative behavior, stories, scope, and test decisions.
2. `apps/rag/AGENTS.md`, `apps/rag/docs/architecture.md`, `apps/rag/docs/decisions/0011-retrieval-full-document.md` — boundaries and passage/document semantics.
3. `apps/rag/src/serving/http/portal-assets/{index.html,portal.js,portal.css}` and `portal-ui.ts` — Knowledge placeholder, view lifecycle, assets, CSP, and fonts.
4. `apps/rag/src/serving/http/portal.ts` — authenticated portal routes and `PortalDeps`.
5. `packages/rag-contracts/src/retrieval.ts` — `SearchRequest`, `RetrievalPolicy`, and `RankedResult`; all seven policy fields.
6. `apps/rag/prisma/schema.prisma`, `apps/rag/src/adapters/postgres/index.ts`, `apps/rag/src/contracts/ports.ts`, `apps/rag/src/main.ts` — actual source/category values, metadata read port, and composition.
7. `apps/rag/tests/portal-ui.e2e.ts`, `portal-registry.e2e.ts`, `portal-sources.e2e.ts`, `portal-ui.helpers.ts`, and `apps/rag/playwright.portal.config.ts` — existing browser harness.
8. `docs/solutions/best-practices/prototype-defaults-vs-data-derived-enumeration-20260422.md` — options must come from corpus data, not the mockup.

## Grep These

`knowledge`, `construction`, `createPortal`, `authorize`, `allowedSourceKeys`,
`preferSourceKey`, `defaultCategory`, `d.category`, `chunk_embeddings`,
`searchRequestSchema`, `includeDocument`, `clipboard`, `resource`.

## What To Build

- Replace the Knowledge placeholder with the approved combined A/D manual:
  grouped sidebar; selected scenario; compact behavior visuals; database-derived
  source/category dropdowns; disabled Test bench with synthetic sample output;
  enabled code tabs and independent code/request copy buttons.
- Add a portal-local metadata read boundary, proposed `GET /portal/manual/options`,
  authorized by current portal admission. Inject an app-local metadata port through
  `PortalDeps`; wire the read-only Postgres adapter in `src/main.ts`. Source values
  are actual `sources.key`, categories are actual nonblank `documents.category`
  values for searchable documents. Do not reuse the snapshot's brand display IDs.
- Derive one `SearchRequest` from the selected preset and all dropdown values.
  Generate cURL, TypeScript, Bash, Python and a separate `request.json` from that
  request. Each pane copies only its own content. No runtime credential is used.
- Keep every Test bench interaction disabled, including query editing, Run,
  result/JSON toggles, citation links and document expansion. No search route,
  embedding call, token issuance, or test-bench environment configuration in this
  ticket. The dropdowns, navigation, code tabs and copy controls remain enabled.
- Treat feat-530, feat-527 and feat-528 as existing portal foundations; their
  broader programme closure is not a new dependency of this UI slice.

## Constraints

Seven public policy fields only. Preserve source scope, exact language/category
filtering, tie-only source preference, and optional full-document semantics.
Serving is read-only over the corpus; no cross-app imports. No frontend direct
database access. No credentials or production corpus text in fixtures or evidence.
Jaco approved the [combined A/D mockup](evidence/feat-575/consumer-manual-combined.png)
on 2026-09-30. Use it as the layout reference; the written spec and current
contract govern behavior and field values.
Keep this lane hidden from the public roadmap viewer. Label/tag the local ticket
`ready-for-agent`; do not create a duplicate standalone-repository GitHub issue.

## Verification

- Use the existing local portal browser harness with disposable Postgres:
  actual metadata values, all scenario/dropdown permutations of interest,
  separate clipboard contents, disabled bench, navigation races and failures.
- Parse every generated request with `searchRequestSchema`; execute each example
  against a local capture server with synthetic credentials to prove equivalent
  method, headers, query and policy, without any live retrieval.
- Prove signed-out/removed sessions cannot read metadata; prove no database writes,
  embedding calls, or search requests occur while exploring the manual.
- Run `pnpm --filter @forge/rag portal:verify`, `test`, `typecheck`, `lint`, and
  `depcruise`, plus appropriate adapter integration checks for metadata reads.
  Measure cold page loading and lazy metadata/module loading against the baseline;
  visual smoke alone is insufficient. Follow the spec's exact acceptance cases.
- Check Markdown formatting and `pnpm exec tsx scripts/check-hidden-roadmap-lanes.ts`.

## Delivery scope

This ticket remains not started until implementation begins. The current PR
publishes the spec and roadmap entry only. Live execution is separately tracked
by [feat-576](feat-576-rag-governed-test-bench.md).

Specs and roadmap publication: [#2485](https://github.com/JesusFilm/forge/pull/2485). The implementation status remains not started.

## ID reconciliation — October 8, 2026

Renumbered from feat-575 to feat-620 to resolve the collision with the other RAG
ticket and the platform retirement ticket. Status, approved scope, PR history,
and historical `evidence/feat-575/` paths are preserved.
