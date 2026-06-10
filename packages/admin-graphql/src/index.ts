// The tada instance is defined INLINE here (duplicating ./admin.ts) instead of
// being re-exported from it. Reason: this package ships TypeScript source to
// two kinds of consumers with incompatible resolution rules —
//   - NodeNext consumers (apps/yt-video-mapper-backend's tsc) REQUIRE relative
//     ESM imports to carry a .js extension (TS2835),
//   - bundler consumers (web's Turbopack, Metro, jest-expo) cannot resolve a
//     relative `./admin.js` VALUE import back to admin.ts (web's prod build
//     broke on exactly that — see PR #1188).
// Type-only imports satisfy both (erased before any bundler sees them), so the
// only safe shape is: no relative VALUE imports in any module a NodeNext
// consumer reaches from ".". ./admin.ts stays as the instance the fragments
// entry point uses internally (bundler-only path). KEEP THE TWO IN SYNC.

import { initGraphQLTada } from "gql.tada"
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
