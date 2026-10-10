// GraphQL Armor — defense-in-depth query complexity controls.
//
// These plugins run as Yoga/envelop plugins BEFORE resolver execution.
// They reject queries that exceed structural thresholds, preventing
// resource abuse without touching application logic.
//
// Three ceilings were lifted from their conservative defaults to
// accommodate apps/web's typed-client (gql.tada + Apollo) WatchExperience
// fragment, which composes 17 inline block fragments plus nested
// Section/Container subtrees. Empirically observed on web's heaviest
// composed query: depth ~24, aliases ~80 (with Apollo's cache
// normalization), tokens ~3-5k. The defaults (10/15/1000) reject
// hand-written abuse shapes but also reject legitimate typed-client
// composition.
//
// cost-limit dropped: the plugin's multiplicative formula (depth × field
// count × nesting) explodes on deeply-composed fragment trees — web's
// WatchExperience hits 393k+ cost units even with a single block in the
// data. The fragment depth IS the design intent (one round trip per page),
// and cost-limit's heuristic cannot tell legitimate composition from
// pathological enumeration. The remaining three ceilings (depth, aliases,
// tokens) bound the abuse surface tightly without the false-positive risk.

import { maxDepthPlugin } from "@escape.tech/graphql-armor-max-depth"
import { maxAliasesPlugin } from "@escape.tech/graphql-armor-max-aliases"
import { maxTokensPlugin } from "@escape.tech/graphql-armor-max-tokens"

export const armorPlugins = [
  maxDepthPlugin({ n: 30 }),
  maxAliasesPlugin({ n: 200 }),
  maxTokensPlugin({ n: 10000 }),
]
