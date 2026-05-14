import { initGraphQLTada } from "gql.tada"
import type { introspection } from "./admin-graphql-env"

export const adminGraphql = initGraphQLTada<{
  introspection: introspection
}>()

export { readFragment } from "gql.tada"

export type {
  FragmentOf as AdminFragmentOf,
  ResultOf as AdminResultOf,
  VariablesOf as AdminVariablesOf,
} from "gql.tada"
