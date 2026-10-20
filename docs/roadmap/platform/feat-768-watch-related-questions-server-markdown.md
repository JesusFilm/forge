---
id: "feat-768"
title: "Render Related Questions Markdown on the server"
owner: "vlad"
priority: "P2"
status: "complete"
start_date: "2026-10-20"
duration: 1
depends_on: []
blocks: []
tags:
  - "web"
  - "performance"
---

## Problem

The Related Questions Experience block (`RelatedQuestionsBlock`) was a client
component only because it holds single-open accordion state. Its answers are
Markdown, so `react-markdown` and the micromark parser (113 KB raw, about
30 KB brotli) shipped in the initial page entry of the Watch home and the
catch-all route, whether or not the page rendered the block.

## Entry Points — Read These First

1. `apps/web/src/components/sections/RelatedQuestions.tsx`: no `"use client"`;
   builds the rows and renders each answer with `<Markdown>`.
2. `apps/web/src/components/sections/RelatedQuestionsList.tsx`: the client
   island that owns the open row.
3. `apps/web/src/components/sections/index.tsx`: `renderAdminBlock` lazily
   imports `RelatedQuestions`. It runs on the server for the home and
   Experience pages and on the client under
   `components/watch/WatchSectionRenderer.tsx`.
4. `apps/web/src/components/watch/watch-faq-classes.ts`: the FAQ type-scale
   constants, kept out of the client `WatchFaqList` module.

## Grep These

- `rg -n "react-markdown" apps/web/src --glob '!*.test.*'`
- `rg -n "WATCH_FAQ_(HEADING|EYEBROW)_CLASS" apps/web/src`
- `rg -n "MessageCircleIcon" apps/web/src`

## What To Build

Delivered:

- `RelatedQuestions` renders the heading, CTA and Markdown answers. Under a
  server section renderer the answers become RSC output; under a client
  renderer the module joins that client graph unchanged.
- `RelatedQuestionsList` keeps the one-row-open behaviour, including ignoring
  the `toggle` echo from a row React just closed.
- Plain modules for the FAQ class constants and `MessageCircleIcon`. A server
  component that imports a non-component value from a `"use client"` module
  receives a client reference, not the value.

## Constraints

- Do not drop Markdown rendering or move answers out of the server HTML;
  closed `<details>` rows must still contain their answers.
- Do not add `"use client"` back to `RelatedQuestions.tsx`. Doing so returns
  micromark to the home and catch-all page entries.
- Keep `WatchSectionRenderer` behaviour. Video pages that render this block
  through the client renderer still load the parser lazily.

## Verification

- `pnpm --filter @forge/web exec vitest run src/components/sections src/components/watch src/components/whats-new`
- `pnpm --filter @forge/web exec tsc --noEmit`
- `next build`, then check that no file listed in
  `.next/server/app/[locale]/[htmlLang]/page_client-reference-manifest.js`
  `entryJSFiles` contains `micromark`.
- Matched local `next start` lab, 7 runs, 390x844, 4x CPU, 150 ms RTT,
  1.6 Mbps (2026-10-20, with no Admin data): home JS −35 KB on the wire, script
  time −131 ms and load −164 ms (medians). A server-rendered fixture of the
  block: −35 KB, −184 ms script time, the same open/close behaviour and no-JS
  markup. FCP, LCP and CLS were flat.
