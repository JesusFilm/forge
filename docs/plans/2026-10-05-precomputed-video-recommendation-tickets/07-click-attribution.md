---
date: 2026-10-05
draft_id: "07"
title: "Count recommendation clicks against eligible visits"
status: published
issue_url: https://github.com/JesusFilm/forge/issues/2572
roadmap: feat-590
draft_blocked_by: ["06"]
---

# 07: Count recommendation clicks against eligible visits

## Parent

https://github.com/JesusFilm/forge/issues/2565

## What to build

Extend the existing card telemetry so both arms produce exact, deduplicated
clicked-visit counts and useful card-level diagnostics. Admin can follow a click
back to the actual served card, generation, position, visit, and assigned arm.

Preserve normal navigation and playback even when tracking fails.

## Acceptance criteria

- [ ] Accepted selection evidence binds to server-issued request/item/visit identity; client-supplied strategy, target, and rank are not trusted as attribution.
- [ ] A visit contributes at most one clicked visit even after multiple card clicks or retried events. A fallback click remains in the original experimental arm with actual strategy recorded.
- [ ] A legitimate accepted click can count without a preceding qualified card impression. Card CTR retains its separately defined impression-based denominator.
- [ ] Both arms use the same recording contracts and bot/test exclusions. Valid empty/error visits remain in the denominator established by the visit slice.
- [ ] Reuse render, qualified impression, selection, and subsequent playback bindings. Add only missing facts, without a parallel generic event stream or copied explanations/transcripts.
- [ ] Pointer, keyboard, supported modified/new-tab activation, navigation races, and short-deadline failure behavior are tested or explicitly qualified. Unsupported or lost observations are reported rather than fabricated.
- [ ] Capabilities/credentials do not enter URLs, analytics logs, or browser persistence, and tracking never becomes a player-start or navigation prerequisite.
- [ ] Admin reports clicked visits, card evidence, fallback rates, unmatched/late events, and measurement loss without interpreting unknown loss as zero true engagement.
- [ ] Native attribution tests cover replay, multiple clicks, wrong-visit evidence, missing impressions, delayed facts, bots, and fallback. Browser lifecycle tests prove trusted-target navigation and no duplicate count.
- [ ] Page-loading and event-write impact are measured for the changed telemetry boundary.

## Implementation context

Reuse the existing recommendation evidence ledger and selection path. Existing
matched-impression historical reports cannot be copied as the primary metric.
Longer-lived sufficient statistics and evaluation revisions are delivered next.

## Blocked by

- #2571

## Execution policy

The user approved this ticket breakdown and the parent spec's testing boundaries.
Use GPT-6 Sol development chats and Matt Pocock's implement, tdd, and code-review
skills. Do not invoke Compound Engineering skills, directly or through another
skill; this explicit user instruction overrides that default repository workflow.
Follow the other repository conventions. Development-chat Sol does not replace
the product's Astra model. Work under the orchestrator's integration branch;
public activation remains a separate explicit operation.
