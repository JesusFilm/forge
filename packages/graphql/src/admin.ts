import { initGraphQLTada } from "gql.tada"
import type { introspection } from "./admin-graphql-env"

export const adminGraphql = initGraphQLTada<{
  introspection: introspection
}>()

// Re-exported so callers narrowing imports to `@forge/graphql/admin` get the
// full fragment API. `readFragment` is schema-agnostic in gql.tada — works for
// both Strapi and admin documents.
export { readFragment } from "gql.tada"

export type {
  FragmentOf as AdminFragmentOf,
  ResultOf as AdminResultOf,
  VariablesOf as AdminVariablesOf,
} from "gql.tada"
