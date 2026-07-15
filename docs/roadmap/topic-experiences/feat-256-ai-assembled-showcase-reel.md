---
id: "feat-256"
title: "AI-assembled Showcase reel"
owner: "urim"
priority: "P2"
status: "not-started"
start_date: "2026-09-01"
duration: 14
depends_on:
  - "feat-255"
tags:
  - "tv"
  - "ai-pipeline"
  - "manager"
---

## Problem

feat-255's Showcase Mode plays a hand-curated Showcase Experience; manual curation goes stale against a catalog that AI pipelines grow continuously, quietly undercutting the mode's "live breadth" claim. The follow-up: the existing AI infrastructure assembles the reel itself — picking videos per felt need, balancing languages, refreshing on cadence — so the office demo can truthfully say the reel was assembled this week by the ministry's own AI. The stakeholder story is the point: the demo becomes a demonstration of the technology, not just the content.

## Entry Points — Read These First

1. `docs/plans/2026-07-15-001-feat-tv-showcase-mode-plan.md` — the Showcase Mode Product Contract; the Showcase Experience is the seam this feature fills, and the TV client contract must not change.
2. `docs/roadmap/topic-experiences/feat-255-tv-showcase-mode.md` — the v1 this depends on.
3. `docs/solutions/architecture-patterns/smart-crop-three-app-decomposition-20260610.md` — the established manager/mastra decomposition law for AI+media features (durable control loop in manager, bounded AI decisions in mastra).
4. `apps/admin` transcript/experience embedding workflows — candidate signal source for picking compelling, felt-need-relevant videos.

## Grep These

- `triggerManagerEnrichment` / `admin-trigger` — the cross-app trigger pattern (caller-side single key, receiver-side CSV) if manager drives assembly
- `experienceBySlug` — the read contract TV keeps using unchanged
- `transcript` embedding workflows in `apps/admin` — excerpt/video selection signals

## What To Build

A pipeline that authors or refreshes the Showcase Experience (or an equivalent data source behind the same TV-facing contract) automatically: felt-need coverage balancing, language-diversity balancing, and periodic refresh with provenance. Exact decomposition (manager job vs. admin workflow vs. mastra decision routes) is a planning question; this work is cross-app and needs an admin/manager-side owner handoff.

## Constraints

- The TV client contract is frozen: TV keeps fetching a curated Experience by slug and must not need code changes when assembly goes automatic.
- Follow the cross-app decomposition and trigger patterns already documented (see Entry Points 3 and the root CLAUDE.md known-patterns list); no new bespoke service seams.
- Editorial safety: assembled output must remain reviewable/overridable by a human curator before or after publish (mechanism decided in planning).

## Verification

- The Showcase Experience updates on cadence without human authoring, visible in TV's Showcase Mode on next reel loop.
- Coverage checks: assembled reel spans a configured minimum of felt needs and distinct languages per loop.
- A curator can override or roll back an assembled reel.
