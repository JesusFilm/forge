---
title: "RAG review evidence and read-only boundaries"
date: 2026-09-23
module: "RAG review tooling"
problem_type: "workflow_improvement"
tags: [rag, review, skills, documentation]
---

# RAG review evidence and read-only boundaries

[feat-541](../../roadmap/rag/feat-541-rag-adversarial-review-skill.md) adds
[`rag-review`](../../../plugins/jfp-rag/skills/rag-review/SKILL.md) to the existing
RAG plugin. A review needs the same ownership and evidence checks for code,
source additions, and documentation: an inaccurate runbook or completion claim
can change the next operator's behavior without changing runtime code.

## Decisions to preserve

- Keep the review phase read-only even when the surrounding work loop normally
  edits tickets or applies fixes. Test scripts, setup hooks, code generation,
  and lifecycle commands may write despite looking like validation. Inspect
  their effects first; recommend checks that cannot run read-only.
- Distinguish plugin discovery from mutation approval. Existing RAG operator
  skills remain explicit and approval-gated. The review skill is normally
  discoverable and has no mutation path. Packaging assertions must not impose
  operator approval prose on a review-only skill.
- One reviewer can apply multiple lenses cheaply, but those are not independent
  model reviews. Optional extra passes need available tools and authorization;
  reports identify actual coverage and missing required passes.
- Treat a documentation claim as an evidence obligation. Trace to current code,
  contracts, lifecycle records, or observed results. Preserve historical records;
  report only introduced defects or bounded risks made relevant by the change.
- Verify remediation against local mechanisms. The repository's
  [review mechanism lesson](../best-practices/code-review-prescribed-mechanism-verification-gap.md)
  explains why a correct finding does not make its proposed API/import real.

The implementation session had no available `ce-code-review` skill. The task
explicitly allowed a repository-native fallback: use the evidence and bounded
re-review conventions from `.claude/commands/review-fix-loop.md` without its
autofix actions. This is a recorded availability constraint, not a claim that
Compound Engineering is unavailable in every Forge environment.
