---
id: "feat-366"
title: "Make candidate grouped coverage counts exact"
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
  - "reliability"
---

## Problem

Candidate coverage validation compares Typesense grouped `found` with the exact
expected language/canonical pair count, but the grouped count is approximate
unless exact-count controls are requested. A healthy production-sized candidate
can therefore be rejected before READY despite complete observed-pair coverage.

## What To Build

1. Request exact grouped cardinality with a bounded `group_max_candidates`, or
   remove the approximate equality in favor of complete paged pair coverage.
2. Keep the request and page envelope bounded for production-sized candidates.

## Verification

- A production-shaped approximate-`found` double cannot false-reject complete
  coverage.
- Missing, duplicate, and unexpected language/canonical pairs still fail closed.

## Review Metadata

- Severity: P1
- Confidence: 75
- Reviewer(s): correctness
- Finding ID: `index-typesense-watch-search-candidate.ts:446:grouped-count`
- Source: `feat/multilingual-watch-suggestions` at `8acbcd1c`
