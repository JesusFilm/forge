---
title: "GraphQL Armor cost-limit is incompatible with typed-client fragment composition"
date: "2026-05-14"
category: "tooling-decisions"
module: "apps/admin/src/graphql/plugins"
problem_type: "tooling_decision"
component: "tooling"
severity: "high"
related_components:
  - "apps/web"
  - "packages/admin-graphql"
applies_when:
  - "Configuring GraphQL Armor (or any cost-based limiter) on a Yoga/envelop server fronting a typed-client consumer"
  - "A consumer composes block, page, or route fragments into one round trip via gql.tada, Apollo, or Relay"
  - "Apollo Client v4 cache-normalization aliases inflate the alias count beyond hand-written query norms"
  - "A previously-passing query starts returning cost-limit errors after fragment composition is added"
tags:
  - "graphql-armor"
  - "graphql-yoga"
  - "gql-tada"
  - "apollo-client"
  - "query-complexity"
  - "fragment-composition"
root_cause: "config_error"
resolution_type: "config_change"
---

# GraphQL Armor cost-limit is incompatible with typed-client fragment composition

## Context

GraphQL Yoga servers fronted by GraphQL Armor typically ship four to five
complexity plugins as defense-in-depth. Four bound _structural_ abuse
surfaces (depth, breadth, alias count, token count). One —
`costLimitPlugin` — applies a _behavioral_ multiplicative cost formula.
When a typed GraphQL client (gql.tada, Apollo Client, Relay) is introduced
on the consumer, it deliberately composes block / page / route fragments
into a single deep round trip. That exact shape trips cost-limit's
heuristic as if it were a pathological nested enumeration.

Scenario: `apps/web` introduced a typed-client `WatchExperience` query
that composes 17 inline block fragments plus nested Section / Container
subtrees via Apollo Client v4 + gql.tada. The query parses, executes, and
returns roughly 30 KB of legitimate page data. GraphQL Armor's
`costLimitPlugin` rejected it at **393,000+ cost units** before resolution,
even with a single block in the response.

## Guidance

In any GraphQL Yoga server fronted by a typed client that composes
fragments at the consumer, **disable `costLimitPlugin` entirely**. Keep
`maxDepthPlugin`, `maxAliasesPlugin`, and `maxTokensPlugin` at ceilings
raised to accommodate the deepest legitimate composed query, sized from
empirical measurements.

The resolved configuration in `apps/admin/src/graphql/plugins/armor.ts`:

```ts
import { maxDepthPlugin } from "@escape.tech/graphql-armor-max-depth"
import { maxAliasesPlugin } from "@escape.tech/graphql-armor-max-aliases"
import { maxTokensPlugin } from "@escape.tech/graphql-armor-max-tokens"

export const armorPlugins = [
  maxDepthPlugin({ n: 20 }), // default 10; observed ~18 on WatchExperience
  maxAliasesPlugin({ n: 200 }), // default 15; Apollo emits ~80
  maxTokensPlugin({ n: 10000 }), // default 1000; observed ~3-5k
]
```

Do not raise ceilings reactively to silence one query — measure the
heaviest composed query the typed client produces, then add roughly 2×
headroom. Do not re-add `costLimitPlugin` "tuned" to a higher threshold;
the multiplicative formula has no stable point above which composition is
safe and below which abuse is bounded.

## Why This Matters

The three retained plugins measure _structural_ properties of the GraphQL
document: how deep selection sets nest, how many aliases a single response
can carry, how large the parsed token stream is. These bounds hold whether
the document is hand-written, machine-composed, or attacker-constructed.
A malicious actor cannot exceed depth 20, 200 aliases, or 10k tokens to
construct a runaway query, regardless of how cleverly fields are nested.

`costLimitPlugin` measures something different: a _behavioral_ cost score
of `depth × field count × multiplicative nesting factor`. The formula
assumes deep composition is a proxy for unbounded enumeration. That
assumption holds for hand-written abuse shapes — and breaks the moment a
typed client deliberately composes fragments to fetch a full page in one
round trip, which is the very design intent of gql.tada, Apollo, and
Relay. The heuristic cannot distinguish a 17-fragment page composition
from a 17-level nested-list attack; both score in the hundreds of
thousands.

Dropping cost-limit removes only the false-positive surface, not the
abuse floor. The three structural ceilings still bound depth, breadth,
and token volume tightly — those are the properties an attacker has to
inflate to cause real resource damage.

## When to Apply

- A consuming app introduces a typed GraphQL client that composes block,
  page, or route fragments at the consumer (gql.tada, Apollo Client,
  Relay).
- Apollo or Relay is added in front of a Yoga + Armor stack that
  previously served hand-written queries.
- A previously-passing query starts returning `Query exceeds maximum cost`
  after fragment composition is added on the consumer side.
- The server schema legitimately exposes page-sized composed shapes
  (`WatchExperience`, `Page`, `Route`) intended to be fetched in a single
  round trip.

Do not apply (i.e., keep `costLimitPlugin`) on servers whose consumers
are exclusively hand-written queries with no automated fragment
composition — the heuristic does its job there.

## Examples

**Before** — `WatchExperience` query against default Armor ceilings
(17 inline block fragments + nested Section / Container subtrees, Apollo
cache-normalized aliasing):

| Metric       | Default ceiling | Observed     | Outcome              |
| ------------ | --------------- | ------------ | -------------------- |
| Depth        | 10              | ~18          | rejected             |
| Aliases      | 15              | ~80          | rejected             |
| Tokens       | 1000            | ~3,000–5,000 | rejected             |
| Cost (limit) | (varies)        | 393,000+     | rejected (heuristic) |

**After** — three ceilings raised, cost-limit dropped:

| Metric  | New ceiling | Observed     | Headroom  |
| ------- | ----------- | ------------ | --------- |
| Depth   | 20          | ~18          | ~10%      |
| Aliases | 200         | ~80          | ~150%     |
| Tokens  | 10,000      | ~3,000–5,000 | ~100–230% |

The live configuration with the design-intent comment block:
`apps/admin/src/graphql/plugins/armor.ts`. Representative typed-client
composition that drove the numbers above:
`packages/admin-graphql/src/fragments/blocks/cta.ts`,
`packages/admin-graphql/src/fragments/blocks/card.ts`.

## Related

- `docs/solutions/architecture-patterns/dual-client-gql-tada-multi-schema-codegen-pattern-20260507.md` — the dual-client gql.tada architecture that produces the composed-fragment trees this guidance addresses.
- `docs/solutions/logic-errors/gql-tada-fragment-anchor-cast-drift-same-fragment-multi-query-20260514.md` — same composed-fragment surface, different failure mode (cast drift, not runtime rejection).
- `apps/admin/CLAUDE.md` § "Unit 9: GraphQL security hardening" — names Armor as the security stack; the cost-limit omission documented here is the deliberate deviation.
