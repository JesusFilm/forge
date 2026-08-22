---
title: "Treat canonical-intent aliases as versioned ranking evidence"
date: "2026-08-21"
category: "architecture-patterns"
module: "apps/admin Typesense Watch search ranking"
problem_type: "architecture_pattern"
component: "service_object"
severity: "high"
applies_when:
  - "A reviewed seeker phrase names canonical content without matching its public title."
  - "The desired canonical group is already present in the bounded retrieval window."
  - "A ranking-only Candidate change must coexist with an accepted Serving revision."
  - "Relevance judgments must remain independent from internal canonical identifiers."
tags:
  - "watch-search"
  - "typesense"
  - "canonical-intent"
  - "aliases"
  - "ranking-revision"
  - "qrels"
  - "candidate-profile"
  - "search-eval"
---

# Treat Canonical-Intent Aliases as Versioned Ranking Evidence

## Context

Some common seeker phrases express audience or intent rather than a published
title. In the read-only production Watch snapshot on 2026-08-21, `Jesus for
kids` returned `jesus`, `storyclubs-childhood-of-jesus`, and
`magdalena-director-cut` before `the-story-of-jesus-for-children` at rank 4.
All of those leading results were playable, so availability alone could not
express which canonical work best satisfied the phrase. The production DOM and
API snapshot succeeded; it is pre-change evidence, not a deployment or live
qualification result.

The implementation needed to improve that phrase without turning an alias into
a public title, metadata keyword, availability signal, or query-specific
branch. It also had to preserve exact-title behavior and let the new ranking
logic be evaluated while the accepted Serving behavior remained available.

## Guidance

### Keep reviewed aliases language-scoped and canonical

Represent aliases in one reviewed, code-owned catalog. Key every alias by the
normalized phrase and Forge language slug, and map it to a stable Core canonical
group rather than an Admin row ID or public slug. Reject malformed language slugs,
non-Core targets, empty aliases, and collisions while constructing the resolver
(`apps/admin/src/services/typesense-watch-search-canonical-intents.ts:18-56`).
The current English catalog maps `Jesus for kids` and `Jesus for children` to
`core:1_cl-0-0` (`apps/admin/src/services/typesense-watch-search-canonical-intents.ts:70-77`).

An alias is ranking evidence only. Do not copy it into public title or metadata
fields, and do not infer it from playback availability. The search service
resolves the alias only for `canonical-intent-v2`, after query-language
interpretation, and passes the target into final ranking without changing the
retrieval request (`apps/admin/src/services/typesense-watch-search.service.ts:1242-1277`).

### Promote only an already-recalled canonical group

Canonical intent cannot manufacture recall. The ranker grants the evidence only
when the stable target ID is present among the fused canonical groups
(`apps/admin/src/services/typesense-watch-search-ranking.ts:480-501`). If the
target is absent, ranking falls back to the existing title/brand or semantic
classification; Evaluation must expose that miss instead of hiding it with a
new lookup.

Keep exact titles stronger than aliases. The evidence order places
`NORMALIZED_WHOLE_TITLE` before `CANONICAL_INTENT`, followed by title-core,
title, metadata, and semantic fill (`apps/admin/src/services/typesense-watch-search-ranking.ts:90-99`).
This prevents a future reviewed alias from displacing content whose real title
exactly matches the same query.

### Version ranking independently from physical projections

The immutable Candidate profile owns its ranking revision alongside generation,
application, transcript, qrels, and collection identity
(`apps/admin/src/services/typesense-watch-search-profile.ts:36-45`,
`apps/admin/src/services/typesense-watch-search-profile.ts:192-202`). The
service takes its implementation from that profile rather than from a process-
wide Candidate mode (`apps/admin/src/services/typesense-watch-search.service.ts:1016-1039`).
That lets private Evaluation run `canonical-intent-v2` while the separate
Candidate-serving ranking setting retains `title-and-brand-v1` by default; the
public `CURRENT` profile continues to use `legacy-rrf`
(`apps/admin/src/config/env.ts:785-790`,
`apps/admin/src/services/typesense-watch-search-profile.ts:122-133`).

Do not bump the physical application revision for ranking-only behavior. The
application revision remains `watch-search-candidate/v2` and is reserved for
schema, document-projection, or retrieval-contract compatibility; the ranking
revision changes qualification identity without requiring compatible physical
collections to be rebuilt
(`apps/admin/src/services/typesense-watch-search-candidate-identity.ts:6-22`).

### Bind independent judgments to distinct-case reporting

Keep relevance judgments independent from internal Core IDs by using reviewed
public canonical slugs plus acceptable alternates, rank bounds, availability,
content type, language, and playback requirements. The code-owned revision is
`watch-search-common-phrases/v1`, and exact-title and intent-query are separate
tracks (`apps/admin/src/scripts/watch-search-candidate-intent-eval-cases.ts:3-25`).

Reduce repeated attempts to one result per distinct case, but pass a case only
when every retained attempt passes. Report exact-title and intent-query success
separately (`apps/admin/src/scripts/benchmark-watch-search-candidate.ts:575-625`).
Candidate qualification rejects qrels drift and every failed Candidate case
while leaving Current results visible for comparison
(`apps/admin/src/scripts/benchmark-watch-search-candidate.ts:680-749`).

## Why This Matters

Titles, aliases, metadata, and availability answer different questions. A title
is authored content identity; an alias is a reviewed interpretation of a
seeker phrase; metadata can provide supporting entity evidence; availability
describes what can be played. Collapsing them into one score or public field
makes the match hard to audit and creates accidental product semantics.

Separating physical application identity from ranking identity also avoids two
unsafe rollout shortcuts: rebuilding an unchanged index just because ordering
logic changed, or silently applying new ordering under qualification evidence
collected for an older ranker. Profile-owned revisions make both mistakes fail
closed while allowing v1 Serving and v2 Evaluation to coexist.

## When to Apply

- A stable, reviewed phrase-to-canonical mapping exists for one language.
- The intended canonical group is already recalled within the bounded search
  window.
- Exact-title behavior must remain stronger and independently measured.
- The change affects application-side ordering but not Typesense schema,
  projections, or retrieval fields.
- Candidate activation requires immutable, reviewed qualification evidence.

## Failure Modes and Verification

- **Alias collision or unstable identity:** reject duplicate normalized aliases,
  empty values, malformed language slugs, and non-Core targets at catalog
  construction.
- **Target not recalled:** do not add a lookup or fabricate a result; fail the
  intent case in Evaluation.
- **Exact-title regression:** keep whole-title evidence ahead of canonical
  intent and retain the independent exact-title benchmark track.
- **Availability leakage:** judge playability and language after ranking; never
  make playback state the source of alias evidence.
- **Revision drift:** require the diagnostic ranking and qrels revisions to
  match the immutable profile and code-owned qrels exactly.
- **Flaky success hidden by aggregation:** retain every paired attempt and fail
  a distinct case when any attempt fails.
- **Premature rollout:** keep Serving on `title-and-brand-v1` until the exact
  `canonical-intent-v2` identity has paired relevance, latency, resource,
  capacity, interference, and operator-review evidence. This implementation
  does not itself qualify or deploy that identity.

Verify these boundaries with the alias-catalog, ranker, service, profile,
candidate-evaluation, benchmark-case, distinct-case, qualification, and
promotion suites. The production snapshot above remains baseline evidence;
post-merge live Evaluation and operator review remain required by the
[production-readiness runbook](../../operations/typesense-watch-search-production-readiness.md#qualify-a-ranking-only-common-phrase-revision).

## Examples

For `Jesus for kids` in English, a recalled `core:1_cl-0-0` group receives
canonical-intent evidence and can move ahead of semantic fill. The same phrase
in another language receives no mapping. If a content item later has the exact
published title `Jesus for kids`, its normalized whole-title evidence remains
stronger than the alias.

For a reviewed alias whose target is not in the fused candidate window, the
ranker does nothing. That result is intentionally a failed intent judgment and
evidence that retrieval needs separate investigation, not permission to widen
this ranking-only mechanism.

## Related

- [Keep strong title and brand evidence ahead of semantic-only Watch results](../logic-errors/typesense-watch-search-rrf-brand-ranking-regression.md)
- [Combine global exact-title recall with localized Typesense tokenizers](typesense-global-exact-title-recall-with-localized-tokenizers.md)
- [Keep Watch search Candidate generations compatible across unrelated Admin deploys](../integration-issues/watch-search-candidate-generation-stable-application-revision.md)
- [Bind eval manifest identity through execution and evidence publication](bind-eval-manifest-identity-to-execution-and-evidence.md)
- [FGE-30 implementation plan](../../plans/2026-08-21-2253-fix-common-phrase-ranking-plan.md)
