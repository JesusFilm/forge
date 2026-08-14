---
id: "feat-367"
title: "Keep unsupported Watch locales compatible during rollout"
owner: "urim"
priority: "P1"
status: "complete"
start_date: "2026-08-14"
completed_date: "2026-08-14"
duration: 1
depends_on:
  - "feat-363"
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

1. Preserve legacy-compatible exact title and metadata fields for every valid
   two-letter tokenizer locale present in the source snapshot.
2. Keep stemmed and taxonomy expansion on the immutable supported-analyzer
   manifest, using expansion fallback fields for unsupported analyzers.
3. Preserve exact public-language identity filters across both paths.

## Verification

- An old-index/new-runtime Maori fixture returns exact results through
  `title_mi` and `metadata_mi`.
- Candidate schemas derive exact locale fields from the source snapshot while
  stem/taxonomy fields remain bounded by the immutable analyzer manifest.
- Suggestion and submitted-search requests name only the selected locale's
  exact fields and never enumerate unrelated locales.

## Completion Evidence

Resolved while integrating the global exact-title recall architecture from
Forge PR #1934. Exact-field compatibility and bounded expansion are exercised
by lexical, locale-routing, schema, indexer, and candidate-generation tests.

## Review Metadata

- Severity: P1
- Confidence: 100
- Reviewer(s): adversarial
- Finding ID: `typesense-watch-search-lexical.ts:84:mixed-rollout`
- Source: `feat/multilingual-watch-suggestions` at `8acbcd1c`
- Pull request: https://github.com/JesusFilm/forge/pull/1938
