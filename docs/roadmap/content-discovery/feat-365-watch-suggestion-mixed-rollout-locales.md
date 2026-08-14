---
id: "feat-365"
title: "Keep unsupported Watch locales compatible during rollout"
owner: "urim"
priority: "P1"
status: "not-started"
duration: 1
depends_on:
  - "feat-361"
blocks: []
tags:
  - "admin"
  - "watch"
  - "search"
  - "typesense"
  - "i18n"
---

## Problem

The v1 lexical collection indexed every two-letter locale into fields such as
`title_mi`, while the v2 runtime selects fixed-manifest fallback fields for an
unsupported analyzer such as Maori. During a tolerant-reader-first rollout, the
new runtime can query fallback fields against the still-active v1 alias and
return no exact suggestions or submitted-search results.

## What To Build

1. Detect the served lexical manifest/revision before selecting v1 or v2 fields.
2. Preserve a bounded v1 compatibility path for unsupported two-letter locales
   while keeping v2 exact fallback fields and exact public-language identity.
3. Remove the compatibility path only after the rollback window closes.

## Verification

- An old-index/new-runtime Maori fixture returns exact results.
- The same runtime uses fallback fields against v2 without naming absent fields.
- Current/candidate, suggestion/submitted-search, and rollback combinations are
  covered without enumerating unrelated locale fields per request.

## Review Metadata

- Severity: P1
- Confidence: 100
- Reviewer(s): adversarial
- Finding ID: `typesense-watch-search-lexical.ts:84:mixed-rollout`
- Source: `feat/multilingual-watch-suggestions` at `8acbcd1c`
- Pull request: https://github.com/JesusFilm/forge/pull/1938
