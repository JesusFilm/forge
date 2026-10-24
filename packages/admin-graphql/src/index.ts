import { initGraphQLTada } from "gql.tada"
// Type-only import: erased at compile/bundle time, so the NodeNext-style
// `.js` extension is safe for bundler consumers (web Turbopack, tv Jest,
// mobile Metro) while satisfying NodeNext consumers' typecheck (TS2835).
// Do NOT add value-level relative imports with `.js` extensions here -
// Turbopack and Jest resolve this package as TS source and cannot map
// `./x.js` -> `./x.ts` (broke web build + tv tests on 2026-06-10).
import type { introspection } from "./admin-graphql-env.js"

export const adminGraphql = initGraphQLTada<{
  introspection: introspection
}>()

export { readFragment } from "gql.tada"

export type {
  FragmentOf as AdminFragmentOf,
  ResultOf as AdminResultOf,
  VariablesOf as AdminVariablesOf,
} from "gql.tada"
