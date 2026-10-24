---
id: "feat-607"
title: "Studio subtitle-free footage, source focus, and MCP diagnostics"
owner: "tataihono"
priority: "P1"
status: "complete"
start_date: "2026-10-06"
duration: 3
depends_on: []
blocks:
  - "feat-608"
tags: [studio, manager, cms, infrastructure]
---

## Problem

Colleague feedback reports missing LUMO sources `6_GOLuke2611` and
`6_GOLuke2616`, centre-only portrait reframing, and opaque Shorts MCP failures.

## Entry Points — Read These First

1. `apps/admin/src/services/studio-authoring/interactive.ts` — search.
2. `apps/admin/src/services/studio-authoring/sources.ts` — capture, retention,
   eligibility, preview and materialization.
3. `packages/studio-contracts/src/index.ts` and `src/sources.ts` — portable shapes.
4. `packages/shorts-compositions/src/studio/Composition.tsx` — shared renderer.
5. `apps/manager/src/features/video-studio/{library,inspector}.tsx` — authoring.
6. `apps/mastra/src/mastra/index.ts` — hosted instruction availability.
7. `apps/admin/src/app/api/shorts/delegated/route.ts` — error boundary.

## Grep These

`subtitle.trackId|subtitleUrl|objectFit|Studio command rejected|Studio agent unavailable`

## What To Build

- Allow explicitly subtitle-free source snapshots with nullable track identity;
  keep exact dub, language, edition, download and current restriction checks.
- Search and trim playable downloadable footage independently of subtitle availability.
  Missing captions must remain explicit; never synthesize canonical dialogue.
- Add bounded source focus coordinates shared by HLS preview and exported video.
- Report expected missing-source, validation and permission failures safely.
- Separate authenticated instruction inspection from hosted execution enablement.

## Constraints

Preserve existing snapshots and catalog digests, immutable retention and delegated
scope checks. Do not publish local worktree code or change production flags.

## Verification

Run focused contracts, composition, Admin, Manager and Mastra tests, package
typechecks, targeted lint and formatting. Validate the source migration against an
isolated database. Record renderer/page-load evidence and distinguish local tests
from the colleague's production client reproduction.

## Implementation evidence

Implemented against `main` `2e914c52a`. Fresh full-migration Postgres source and
catalog tests pass, as do signed native instruction-read tests, Manager MCP/editor
tests, portable skill archive tests, contracts/composition suites and package
typechecks. Main-code falsification reproduces both missing-footage search and
centre-only reframing. The production-client replay is tracked in feat-608.

Details: `docs/solutions/ui-bugs/studio-source-focus-and-optional-subtitles.md`.
