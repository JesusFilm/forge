// GraphQL Armor — defense-in-depth query complexity controls.
//
// These plugins run as Yoga/envelop plugins BEFORE resolver execution.
// They reject queries that exceed structural thresholds, preventing
// resource abuse without touching application logic.

import { maxDepthPlugin } from "@escape.tech/graphql-armor-max-depth"
import { maxAliasesPlugin } from "@escape.tech/graphql-armor-max-aliases"
import { maxTokensPlugin } from "@escape.tech/graphql-armor-max-tokens"
import { costLimitPlugin } from "@escape.tech/graphql-armor-cost-limit"

export const armorPlugins = [
  maxDepthPlugin({ n: 10 }),
  maxAliasesPlugin({ n: 15 }),
  maxTokensPlugin({ n: 1000 }),
  costLimitPlugin({ maxCost: 5000 }),
]
