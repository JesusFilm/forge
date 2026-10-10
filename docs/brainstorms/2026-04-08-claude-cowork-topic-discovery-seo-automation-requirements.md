---
date: 2026-04-08T00:00:00.000Z
topic: claude-cowork-topic-discovery-seo-automation
---

# Claude Cowork Topic Discovery and SEO Automation

## Problem Frame

Some of the topic-finding and optimization work does not belong inside the manager UI at all. A bot that goes to Google to discover emerging topics and an automatic SEO review that runs on a schedule are better modeled as Claude Cowork automation: background systems that watch the outside world, generate briefs, and surface recommendations back to the team.

Keeping these concerns in automation avoids turning manager into a crawler dashboard or scheduled-audit console. Manager can stay focused on operator review and publishing, while Claude Cowork handles recurring discovery and governance work in the background.

## Requirements

- R1. Claude Cowork runs a scheduled automation that checks approved external discovery sources such as Google search patterns or trend surfaces for new topic opportunities.
- R2. Discovery automation produces structured topic briefs with evidence, likely audience fit, and suggested follow-up actions rather than publishing anything directly.
- R3. Claude Cowork runs a scheduled SEO review against approved topic or experience pages and reports issues such as missing metadata, thin copy, duplicate intent, weak linking, or stale optimization opportunities.
- R4. Automation results land in a durable review surface for humans, such as a brainstorm doc, task queue, or editorial inbox item.
- R5. Discovery and SEO automation stay auditable: each run records sources checked, pages reviewed, and the reasoning behind its recommendations.

## Success Criteria

- Topic discovery from Google happens automatically without requiring a manager operator to manually run a search workflow.
- SEO review happens on a schedule and produces actionable findings instead of a one-off manual pass.
- Automation outputs create reviewable work for humans rather than silently changing production content.

## Scope Boundaries

- Not a manager dashboard feature.
- Not an unrestricted crawler across arbitrary sites.
- Not autonomous publishing or SEO edits without human review.

## Key Decisions

- These ideas belong to Claude Cowork automation, not the `/manager` brainstorm set.
- The automation produces briefs and audits, not direct content mutations.
- Human review remains mandatory between automation output and publication decisions.

## Dependencies / Assumptions

- Claude Cowork has a place to schedule recurring runs and deliver results back to the team.
- Discovery sources and SEO targets can be explicitly allowlisted before automation begins.

## Outstanding Questions

### Deferred to Planning

- [Affects R1][Policy] Which external discovery sources are allowed in the first version?
- [Affects R4][Workflow] Where should automation outputs land first so the team will actually use them?

## Next Steps

-> `/ce:plan` for structured implementation planning
