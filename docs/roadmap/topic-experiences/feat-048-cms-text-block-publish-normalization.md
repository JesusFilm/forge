---
id: "feat-048"
title: "Normalize CMS Text Blocks During Experience Publish"
owner: "urim"
priority: "P1"
status: "complete"
start_date: "2026-04-04"
duration: 1
depends_on:
  - "feat-047"
blocks: []
tags:
  - "cms"
  - "experiences"
---

## Problem

Publishing a watch-template `Experience` from the Strapi admin can fail with `500 Internal Server Error` when a `sections.text` block is present. The current schema expects `contentParagraphs` to be JSON, but editor flows can still submit plain text, which reaches Postgres as invalid JSON input.

## Entry Points — Read These First

1. `apps/cms/src/api/experience/content-types/experience/lifecycles.js` — experience save/publish validation
2. `apps/cms/src/components/sections/text.json` — text block content contract
3. `apps/web/src/components/sections/Text.tsx` — frontend expectation for paragraph arrays

## What To Build

1. Normalize `sections.text.contentParagraphs` during experience create/update/publish so plain text is converted into the paragraph array shape expected by the web app.
2. Reject unsupported text-body payloads with a clear application error instead of letting Postgres throw a generic 500.
3. Verify the local `single-video` template can be updated/published from the CMS after the change.

## Verification

- Restart local Strapi
- Update and publish the `single-video` experience in the CMS
- Confirm the request no longer fails with `invalid input syntax for type json`
