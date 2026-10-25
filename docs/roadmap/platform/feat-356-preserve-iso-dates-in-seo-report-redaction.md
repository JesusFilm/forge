---
id: "feat-356"
title: "Preserve ISO dates in SEO report redaction"
owner: "codex"
priority: "P0"
status: "complete"
start_date: "2026-08-11"
duration: 1
depends_on:
  - "feat-355"
blocks: []
tags:
  - "platform"
  - "admin"
  - "seo"
  - "audit"
  - "production-fix"
---

## Problem

The first production v1 SEO audit report was stored but classified as
`malformed`. Admin validates the report before its shared text redactor runs;
the phone-number pattern then replaces ISO date and datetime strings, so the
stored JSON no longer satisfies the versioned report schema.

## What To Build

1. Add a regression test that proves whole ISO dates and datetimes survive SEO
   JSON redaction and the stored v1 report remains readable.
2. Narrow the text redaction boundary without weakening credential, email, IP,
   phone, URL, or token protections for ordinary text.
3. Re-run the focused Admin suite and verify a fresh production SEO job exposes
   `Detail available` with its query decisions.

## Constraints

- Do not rewrite or delete the malformed rollout record.
- Do not expose raw provider payloads or relax Manager-only report detail.
- Keep the fix scoped to the redaction transition that invalidates schema-safe
  ISO values.

## Verification

- The regression test fails on the deployed implementation because the stored
  GSC dates become `[redacted-phone]`, then passes after the fix.
- Admin typecheck, lint, and the complete SEO experiment service test file pass.
- Production verification is repeated after the follow-up PR deploys.
