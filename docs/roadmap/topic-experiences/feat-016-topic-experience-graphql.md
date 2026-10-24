---
id: "feat-016"
title: "Topic / Experience GraphQL Wiring"
owner: "nisal"
priority: "P1"
status: "cancelled"
start_date: "2026-05-07"
duration: 28
depends_on:
  - "feat-003"
blocks:
  - "feat-017"
  - "feat-018"
  - "feat-059"
tags:
  - "cms"
  - "graphql"
  - "web"
  - "mobile"
---

## Entry Points — Read These First

1. `apps/web/src/lib/content.ts` — existing GraphQL operations (`GetExperience`, `GetWatchExperience`). Add topic queries here.
2. `packages/graphql/` — codegen pipeline
3. Feature 1 above — the Topic content type you built

## Grep These

- `graphql(` in `apps/web/src/lib/content.ts` — how typed operations are defined
- `GetExperience` in `apps/web/src/lib/content.ts` — existing query pattern with full section population
- `populate` in `apps/cms/src/api/` — deep population patterns for avoiding N+1

## What To Build

1. Add GraphQL operations in `apps/web/src/lib/content.ts`:

   ```typescript
   // Browse topics
   export const GetTopics = graphql(`
     query GetTopics($limit: Int, $offset: Int, $parentSlug: String) {
       topics(
         pagination: { limit: $limit, start: $offset }
         filters: { parentTopic: { slug: { eq: $parentSlug } } }
         sort: "videoCount:desc"
       ) {
         name
         slug
         description
         videoCount
         source
         childTopics {
           name
           slug
           videoCount
         }
         ogImage {
           url
           blurhash
         }
       }
     }
   `)

   // Single topic with its Experience
   export const GetTopic = graphql(`
     query GetTopic($slug: String!) {
       topics(filters: { slug: { eq: $slug } }) {
         name
         slug
         description
         videoCount
         parentTopic { name slug }
         childTopics { name slug videoCount }
         experience {
           title
           slug
           sections {
             ... on ComponentSectionsVideoHero { ... }
             ... on ComponentSectionsText { ... }
             // ... all section fragments
           }
         }
       }
     }
   `)

   // Search (REST, not GraphQL — separate fetch)
   export async function searchVideos(
     query: string,
     options?: {
       topicSlug?: string
       language?: string
       limit?: number
       offset?: number
     },
   ) {
     const params = new URLSearchParams({ q: query, ...options })
     const res = await fetch(`${CMS_URL}/api/search?${params}`)
     return res.json()
   }
   ```

2. Ensure Topic -> Experience -> Sections resolves without N+1. May need a custom resolver or population config in `apps/cms/src/api/topic/`.

3. Run codegen after schema changes:

   ```bash
   cd packages/graphql && pnpm codegen
   ```

4. Share the API contract with Urim — he builds UI against these queries.

## Constraints

- Reuse existing section fragments from `GetExperience` query — do NOT duplicate fragment definitions.
- The search endpoint is REST, not GraphQL (vector queries don't fit the GraphQL resolver model well). Document this clearly for Urim.
- Do NOT add custom GraphQL resolvers unless Strapi's default resolution has a concrete N+1 problem. Test first.

## Verification

- `GetTopics` query returns paginated topics sorted by videoCount
- `GetTopic("forgiveness")` returns the topic with its full Experience and all sections resolved
- `searchVideos("forgiveness")` returns results from the REST search API
- TypeScript compiles in `apps/web` after importing these operations
- No N+1: check Strapi logs for query count when resolving Topic -> Experience -> Sections
