---
title: "fix(rag): recover omitted migration contracts"
date: "2026-09-04"
roadmap: "docs/roadmap/rag/feat-452-rag-migration-recovery.md"
origin: "JesusFilm/jesusfilm-rag#130"
---

# RAG migration recovery plan

## Scope

Repair the concrete omissions found by comparing the latest main branches of
`JesusFilm/jesusfilm-rag` and Forge. This is a Forge-native recovery, not a
second mechanical port. Runtime behavior that was deliberately reimplemented
under Forge conventions remains authoritative.

## Units

1. **Lifecycle records and integrity.** Adapt the legacy slice/source records,
   preserve the GotQuestions English-first and multilingual-batch decision,
   reconcile source-map claims, and make dangling references fail validation.
2. **Metered-source handoff.** Reimplement source-scoped `raw_documents`
   promotion with Forge target profiles, explicit acknowledgements, bounded
   transfer, transactionality, deterministic digests, and tests.
3. **Architecture authority.** Restore the still-live architecture and accepted
   ADR rationale, marking replaced mechanics such as Drizzle as superseded by
   Forge's Prisma implementation.
4. **Migration evidence audit.** Add a durable recovery report listing which
   historical proofs exist, which remain unavailable, and which actions belong
   to the still-open `feat-435`; never convert procedure into claimed evidence.
5. **Integration and review.** Run focused and full RAG checks, format all
   changed files, inspect the final diff against `origin/main`, and open a PR
   for review.

## Parallel ownership

- Lifecycle records and reference validation can proceed independently from
  raw promotion because they touch disjoint documentation/status and script
  surfaces.
- Session-memory research is read-only and feeds the lifecycle wording before
  final integration.
- Architecture/evidence reconciliation remains the integration lane because it
  cross-checks both implementation lanes and decides which historical records
  remain authoritative.

## Non-goals

- No production deployment, ingestion, corpus mutation, endpoint probe, or
  archival action.
- No completion of the small-source proof, soak, retirement, or repository
  archival tracked by `feat-435`.
- No invention of missing historical receipts.

## Verification

Run the RAG package test, typecheck, lint, dependency-cruiser, lifecycle status,
dashboard build/verify, Markdown formatting, and any focused raw-promotion and
reference-integrity suites introduced by the change. Review generated or
public artifacts for corpus text and secrets before committing.
