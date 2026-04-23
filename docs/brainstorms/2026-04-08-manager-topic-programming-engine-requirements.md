---
date: 2026-04-08T00:00:00.000Z
topic: manager-topic-programming-engine
---

# Topic Programming Engine for Manager App

## Problem Frame

The current roadmap covers clustering and topic-page generation, but it does not yet define how the team turns internal signals into a repeatable programming slate. The missing layer is editorial programming inside manager: selecting promising topic directions from existing content signals, turning them into Bible-video page opportunities, and packaging recurring formats like daily devotionals. Without that layer, topic generation risks becoming reactive and generic.

## Requirements

- R1. Add a topic programming engine in the manager app that turns internal content signals, reviewed clusters, and editorial seeds into a ranked queue of candidate topics.
- R2. Discovery produces a ranked queue of candidate topics with reasons, source evidence, Scripture fit, audience fit, and freshness score.
- R3. Operators can turn a candidate into a topic-page brief that feeds existing topic-page generation flows.
- R4. The engine supports recurring program types, including a daily video devotional sequence assembled from existing videos and topic-page assets.
- R5. Generated topic pages and recurring programs can be reviewed in a single editorial queue before publication.
- R6. The system keeps candidate discovery, programming, and editorial review connected so that topic signals can produce pages and recurring packages deliberately rather than ad hoc.

## Success Criteria

- The team has a clear "what should we generate next?" queue instead of relying on ad hoc prompts.
- Daily devotional and topic-page programming feels deliberate rather than one-off.
- The queue stays grounded in reviewed internal signals instead of scattered prompts and manual notes.

## Scope Boundaries

- Not autonomous web publishing from external trends with no review.
- Not a general-purpose web crawler for arbitrary content domains.
- Not a full editorial calendar product on day one.

## Key Decisions

- Daily devotionals are treated as a repeatable program format powered by the same topic graph.
- Candidate programming is driven by reviewed internal signals plus explicit editorial seeds.

## Dependencies / Assumptions

- Existing topic clustering and AI topic content generation remain the downstream production engines.
- External discovery and SEO governance can live in separate Claude Cowork automation rather than inside manager.

## Outstanding Questions

### Deferred to Planning

- [Affects R1][Product] Which internal signals belong in v1: reviewed clusters only, manual editorial seeds, engagement data, or some combination?
- [Affects R4][Product] Should daily devotionals be generated as a fixed-length series, a rolling feed, or both?

## Next Steps

-> `/ce:plan` for structured implementation planning
