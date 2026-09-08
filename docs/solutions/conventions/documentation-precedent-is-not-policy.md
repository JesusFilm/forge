---
title: Existing documentation is precedent, not a directive
date: "2026-09-09"
category: conventions
module: apps/rag documentation workflow
problem_type: convention
component: documentation
severity: medium
applies_when:
  - Adding durable documentation or evidence artifacts during an established workflow
  - An existing directory or historical artifact suggests a convention without an explicit
    producer or retention contract
  - Consolidating redundant records while preserving approved decisions and required
    evidence
tags:
  - documentation
  - artifact-ownership
  - agent-workflows
  - rag
  - slice
  - evidence
  - conventions
---

# Existing documentation is precedent, not a directive

## Context

The GotQuestions Icelandic work in [PR #2202](https://github.com/JesusFilm/forge/pull/2202) added 11 files beneath `apps/rag/docs/slice-evidence/`. A pre-existing English language audit was already in that directory. In this session, the operator challenged the expansion because no identified procedure required a new family of slice evidence documents.

The cleanup is part of that open, unmerged PR as of 2026-09-09. The existing slice record retains the necessary results and decisions. The earlier English audit stays in place.

## Guidance

Before adding a recurring artifact, identify the instruction, procedure, or explicit task requirement that owns its purpose and location. An existing file can inform how to satisfy a requirement; its existence does not establish that every similar task needs another file.

Use the current documentation contract first. For RAG, per-slice results belong in the slice files and `sources.md` (`apps/rag/docs/eval-approach.md:3`). Detailed evaluation attempts remain local under ignored `apps/rag/eval/attempts/`; reviewed, redacted comparison evidence has a separately documented destination (`apps/rag/docs/ops/evaluation.md:5`, `.gitignore:82`). These are distinct requirements, not a general ban on JSON or evidence artifacts.

When removing an unnecessary document family:

- Consolidate decision-relevant results, run identity, limitations, and reasons into the existing owner document before deleting duplicates.
- Preserve explicit review obligations. Non-English golden cases require English question translations and translated retrieved results; those comments remain necessary even when adjacent evidence files are removed (`apps/rag/docs/eval-approach.md:429`).
- Preserve pre-existing artifacts outside the authorized cleanup scope. Do not infer that an unnecessary expansion invalidates the original file.
- Verify deleted paths have no surviving references and that canonical cases and lifecycle state remain unchanged.

If a proposed artifact supplies a durable need that the existing contract cannot serve, explain that need and establish its ownership and retention rules before treating it as a repeated convention.

## Why This Matters

Extra files can create an accidental policy: later agents copy them, reviewers assume they are mandatory, and multiple documents become competing accounts of the same result. Consolidation makes the authoritative record easier to locate without discarding the evidence needed to interpret it.

The opposite overcorrection also loses information. Removing required translations, run identity, or unresolved limitations would weaken review merely to reduce file count. Keep the review contract and change only the unnecessary packaging.

## When to Apply

Apply this guidance when an agent proposes a new evidence directory, receipt family, checklist, or repeated report based primarily on a neighboring example, or when a reviewer asks which instruction requires an artifact. It also applies when cleaning up duplicated operational records after the underlying work is complete.

## Examples

For the Icelandic slice, replace separate acquisition, indexing, retrieval, evaluation, and adjudication documents with the established `apps/rag/docs/slices/gotquestions.md` record. That record contains canonical run identity, limitations, and relevance decisions with precedents. Keep detailed attempts untracked and retain the pre-existing `gotquestions-null-language-paths.md` audit.

Keep `apps/rag/eval/candidates-gotquestions-is.yaml` and the approved canonical cases: they serve the explicit multilingual review contract. Likewise, retain machine-readable comparison evidence when the evaluation procedure actually requires it (`apps/rag/docs/ops/evaluation.md:63`). The deciding factor is the artifact's documented role, not its extension or the presence of an older sibling.

## Related

- [Challenge predecessor framing](../best-practices/challenge-predecessor-plan-framing-and-read-named-memory-pointers-20260429.md) — re-derive inherited assumptions from current requirements.
- [Sweep prose when retiring a mechanism](../workflow-issues/mechanism-retirement-docs-prose-sweep.md) — check surviving consumers and references during cleanup.
