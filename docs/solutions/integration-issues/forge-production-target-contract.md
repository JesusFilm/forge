---
title: "Production scripts must own their target contract"
module: "apps/rag"
tags: ["rag", "production", "doppler", "operations", "path-scope"]
problem_type: "integration_issue"
date: "2026-09-09"
---

# Production scripts must own their target contract

The production acquisition and indexing entrypoints selected JFRAG-named
credentials even when Doppler contained both Forge and legacy database values.
The repository needed an explicit Forge contract and complete setup instructions
for anyone running these scripts directly.

Acquisition/indexing now consume Forge database names, an independently
configured expected host, and a per-command write signal. Preview selects the
reader; apply selects the writer. Other consumers retain their existing
contracts. Both modes retain source/path metadata, including registered
language slices.

Verification covers real CLI argument refusal, environment installation with
both namespaces present, scope forwarding and receipts. These tests establish
the command contract; live database permissions and corpus completeness require
separate verification. Provision the reader and host pin before first use and
reconcile acquisition/indexing results before claiming production completion.

See [corpus-maintenance.md](../../../apps/rag/docs/ops/corpus-maintenance.md) for
the direct commands and exact completion checks.
