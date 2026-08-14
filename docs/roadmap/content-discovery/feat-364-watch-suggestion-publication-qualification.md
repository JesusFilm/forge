---
id: "feat-364"
title: "Require executable Watch suggestion qualification before publication"
owner: "urim"
priority: "P1"
status: "not-started"
duration: 2
depends_on:
  - "feat-361"
  - "feat-363"
blocks: []
tags:
  - "admin"
  - "watch"
  - "search"
  - "typesense"
  - "operations"
---

## Problem

The v2 publisher accepts the generic submitted-search qualification shape, while
the suggestion-specific evaluator has no credentialed collector, persistence
caller, or exact-generation publication requirement. Publication can therefore
proceed without exercising morphology, taxonomy, identity, phrase, or request
envelopes on the physical suggestion candidate.

## What To Build

1. Add an executable frozen multilingual suggestion collector bound directly to
   the candidate physical lexical collection.
2. Persist result identity, minimum-work, latency, request, capacity, and
   candidate-revision evidence.
3. Require the exact generation's passing suggestion report before the current
   publisher can publish v2.

## Verification

- The publisher rejects absent, stale, relabeled, empty-work, and failed
  suggestion evidence.
- A credentialed physical-candidate benchmark persists one immutable report and
  is required by the publication guard.

## Review Metadata

- Severity: P1
- Confidence: 100
- Reviewer(s): correctness, security, adversarial
- Finding ID: `typesense-watch-search-candidate-generation.ts:1218:suggestion-qualification`
- Source: `feat/multilingual-watch-suggestions` at `8acbcd1c`
