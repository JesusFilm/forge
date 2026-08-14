---
id: "feat-363"
title: "Reject empty Watch suggestion qualification workloads"
owner: "urim"
priority: "P1"
status: "not-started"
duration: 1
depends_on:
  - "feat-361"
blocks:
  - "feat-364"
tags:
  - "admin"
  - "watch"
  - "search"
  - "typesense"
  - "testing"
---

## Problem

The Watch suggestion candidate evaluator enforces upper bounds but no minimum
work. An all-zero sample set can therefore qualify without proving retrieval,
phrase validation, hydration, or result identity, making a permanently empty
candidate look faster and cheaper than the current serving collection.

## What To Build

1. Define exact minimum work for every frozen candidate/current benchmark order
   and cache state.
2. Require non-empty multilingual result and exact-language identity evidence,
   not only duration and request counters.
3. Reject all-zero, missing-lane, missing-hydration, and empty-result evidence.

## Verification

- An all-zero workload fails qualification.
- Frozen exact, morphology, taxonomy, unsupported-analyzer, and identity-collision
  samples prove the expected work and result identities.

## Review Metadata

- Severity: P1
- Confidence: 100
- Reviewer(s): adversarial
- Finding ID: `benchmark-watch-search-suggestions-candidate.ts:224:empty-workload`
- Source: `feat/multilingual-watch-suggestions` at `8acbcd1c`
- Pull request: https://github.com/JesusFilm/forge/pull/1938
