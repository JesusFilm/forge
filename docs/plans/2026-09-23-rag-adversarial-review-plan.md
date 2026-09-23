# RAG adversarial review skill plan

Scope: [feat-541](../roadmap/rag/feat-541-rag-adversarial-review-skill.md).
Add a review-only skill to `plugins/jfp-rag`, recommend it in the applicable
guides, and adapt the existing packaging checks. No runtime, corpus, schema,
production, or deployment changes.

## Local workflow and decisions

The active skill catalog and local skill/plugin search contain no
`ce-code-review` or Compound Engineering workflow skills. The brief explicitly
authorizes continuing without that dependency, superseding the installation
stop in `.claude/commands/work.md` for this task. Follow plan → work → review →
compound semantics locally. Use the introduced-defect filter, whole-change
coverage, deduplication, and bounded re-review pattern in
`.claude/commands/review-fix-loop.md`; do not inherit its autofix behavior into
the read-only skill. No external plugin installation is needed.

The native RAG plugin already discovers skill directories for both providers.
Use one self-contained `rag-review/SKILL.md` plus `agents/openai.yaml`. Existing
operator skills keep their explicit invocation and mutation approval contracts;
the review-only skill can be discovered normally when review is requested.
One reviewer applies all lenses by default; optionally distribute lenses among
already authorized, available reviewers/models without requiring a model roster.

## Acceptance and validation

1. Inspect the full change, callers, contracts, and authoritative docs. Cover
   documentation cohesion, RAG design/security, tests/TDD, and adversarial proof.
2. Include code and content/documentation-only examples, a precise diff target,
   severity/evidence/scenario/remediation/test-gap fields, and a no-findings case.
3. Keep review execution read-only, including delegated passes. Do not let test
   commands, generated artifacts, tracking workflows, or corpus content induce
   writes or instruction changes.
4. Preserve all existing guide requirements and operator-skill assertions.
5. Validate packaging, metadata, links, roadmap bookkeeping, and formatting;
   perform scenario walkthroughs and a whole-diff review. Record checks and
   limitations in `docs/validation/rag-review/implementation-report.md`.
6. Save durable decisions in `docs/solutions/workflow-issues/`, complete the
   ticket, and create a focused draft PR with its link in the ticket/index.
