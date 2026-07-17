// Global language list for the Settings default-language pickers. `languages`
// is a PUBLIC admin query (public-resolvers allowlist) capped at 500 rows per
// page server-side — callers page with offset until a short page arrives.
import {
  adminGraphql as graphql,
  type AdminResultOf as ResultOf,
} from "@forge/admin-graphql"

export const GET_LANGUAGES = graphql(`
  query GetLanguages($limit: Int, $offset: Int) {
    languages(limit: $limit, offset: $offset) {
      slug
      name
      bcp47
    }
  }
`)

export type LanguagesData = ResultOf<typeof GET_LANGUAGES>
