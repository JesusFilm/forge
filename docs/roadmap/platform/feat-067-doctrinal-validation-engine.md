---
id: "feat-067"
title: "Doctrinal Validation Engine"
owner: "vlad"
priority: "P2"
status: "not-started"
start_date: "2026-12-01"
duration: 31
depends_on:
  - "feat-066"
blocks:
  - "feat-069"
tags:
  - "ai-pipeline"
  - "validation"
  - "theology"
---

## Problem

AI-assisted ministry content needs more than generic factuality checks. The platform needs a doctrinal validation layer so generated summaries, topic pages, and scripts can be reviewed against approved theological sources before publication.

## Entry Points — Read These First

1. `docs/roadmap/platform/feat-066-llm-steering-system-rag-and-guardrails.md` — shared steering foundation
2. `apps/manager/src/services/metadata.ts` — structured content-generation output
3. `apps/cms/src/components/sections/bible-quote-item.json` — scripture-aligned content shape
4. `apps/web/src/lib/content.ts` — downstream published-content consumer
5. `apps/cms/schema.graphql` — CMS contract that generated content ultimately ships through

## Grep These

- `bible` in `apps/cms/src/components/sections/`
- `metadata` in `apps/manager/src/services/`
- `graphql(` in `apps/web/src/lib/content.ts`
- `guardrail` in `docs/roadmap/platform/`

## What To Build

1. Define the doctrinal review inputs, approved reference sources, and validation outcomes.
2. Add a machine-assisted validation pass that can flag theological risk before content is published.
3. Keep the validation result attached to the generated asset or page so reviewers can act on it.
4. Support escalation to human review rather than pretending the model can close every theological question automatically.

## Constraints

- Do NOT auto-publish high-risk content without a clear review path.
- Keep the doctrine source set explicit and maintainable.
- Validation outputs should explain the concern, not just return pass/fail.

## Verification

- A generated content sample can run through doctrinal validation and receive a structured result
- Validation findings are visible to reviewers before publication
- Low-risk and high-risk outcomes follow different review paths
