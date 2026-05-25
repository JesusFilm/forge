/**
 * Admin GraphQL operations for Experience blocks and search.
 *
 * Uses adminGraphql() from @forge/admin-graphql with the shared
 * AdminWatchExperience fragment that composes all block fragments.
 */
import {
  adminGraphql,
  type AdminFragmentOf,
  type AdminResultOf,
} from "@forge/admin-graphql"
import { adminWatchExperienceFragment } from "@forge/admin-graphql/fragments"

// ── Experience queries ──────────────────────────────────────────────

export const GET_EXPERIENCE_BY_SLUG = adminGraphql(
  `
    query GetExperienceBySlug($locale: String!, $slug: String!) {
      experienceBySlug(locale: $locale, slug: $slug) {
        ...AdminWatchExperience
      }
    }
  `,
  [adminWatchExperienceFragment],
)

export const GET_WATCH_SETTING = adminGraphql(
  `
    query GetWatchSetting($locale: String!) {
      watchSetting(locale: $locale) {
        documentId
        homepageExperience {
          ...AdminWatchExperience
        }
      }
    }
  `,
  [adminWatchExperienceFragment],
)

// ── Search query ────────────────────────────────────────────────────

export const SEARCH = adminGraphql(`
  query Search(
    $q: String!
    $locale: String!
    $limit: Int
    $offset: Int
  ) {
    search(
      q: $q
      locale: $locale
      limit: $limit
      offset: $offset
    ) {
      query
      hasMore
      results {
        type
        id
        slug
        title
        imageUrl
        snippet
        startSeconds
        playbackId
        score
      }
    }
  }
`)

// ── Derived types ───────────────────────────────────────────────────

export type WatchExperience = NonNullable<
  AdminFragmentOf<typeof adminWatchExperienceFragment>
>

export type AdminBlock = NonNullable<WatchExperience["blocks"]>[number]

export type SearchResult = NonNullable<
  AdminResultOf<typeof SEARCH>["search"]
>["results"][number]

export type SearchResponse = NonNullable<AdminResultOf<typeof SEARCH>["search"]>
