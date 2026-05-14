// GraphQL Armor — defense-in-depth query complexity controls.
//
// These plugins run as Yoga/envelop plugins BEFORE resolver execution.
// They reject queries that exceed structural thresholds, preventing
// resource abuse without touching application logic.
//
// All four ceilings were lifted from their conservative defaults to
// accommodate apps/web's typed-client (gql.tada + Apollo) WatchExperience
// fragment, which composes 17 inline block fragments plus nested
// Section/Container subtrees. Empirically observed on web's heaviest
// composed query: depth ~18, aliases ~80 (with Apollo's cache
// normalization), tokens ~3-5k, cost ~10-15k. The defaults
// (10/15/1000/5000) reject hand-written abuse shapes but also reject
// legitimate typed-client composition. The new ceilings keep abuse
// rejection meaningful while letting documented client patterns through.

import { maxDepthPlugin } from "@escape.tech/graphql-armor-max-depth"
import { maxAliasesPlugin } from "@escape.tech/graphql-armor-max-aliases"
import { maxTokensPlugin } from "@escape.tech/graphql-armor-max-tokens"
import { costLimitPlugin } from "@escape.tech/graphql-armor-cost-limit"

export const armorPlugins = [
  maxDepthPlugin({ n: 20 }),
  maxAliasesPlugin({ n: 200 }),
  maxTokensPlugin({ n: 10000 }),
  costLimitPlugin({ maxCost: 20000 }),
]
