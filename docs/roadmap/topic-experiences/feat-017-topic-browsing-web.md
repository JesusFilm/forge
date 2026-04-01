---
id: "feat-017"
title: "Topic Browsing — Web"
owner: "urim"
priority: "P1"
status: "not-started"
start_date: "2026-04-21"
duration: 28
depends_on:
  - "feat-016"
  - "feat-013"
blocks: []
tags:
  - "web"
---

## Entry Points — Read These First

1. `apps/web/src/app/[slug]/[locale]/page.tsx` — Experience page pattern. Topic detail will reuse the section rendering logic.
2. `apps/web/src/lib/content.ts` — where to add `GetTopics` and `GetTopic` queries (Nisal will add these, or you add them from his spec)
3. `apps/web/src/components/sections/` — section renderers. Topic detail pages render an Experience, so all existing renderers apply.
4. `docs/roadmap/topic-experiences/feat-016-topic-experience-graphql.md` — GraphQL query shapes for topics

## Grep These

- `GetExperience` in `apps/web/src/lib/content.ts` — how Experience data is fetched and passed to section renderers
- `generateStaticParams|generateMetadata` in `apps/web/src/app/` — ISR and metadata patterns
- `revalidate` in `apps/web/src/app/` — ISR revalidation config

## Topic GraphQL Queries (from Nisal)

```graphql
# Browse topics
query GetTopics($limit: Int, $offset: Int) {
  topics(pagination: { limit: $limit, start: $offset }, sort: "videoCount:desc") {
    name, slug, description, videoCount
    childTopics { name, slug, videoCount }
    ogImage { url, blurhash }
  }
}

# Single topic with Experience
query GetTopic($slug: String!) {
  topics(filters: { slug: { eq: $slug } }) {
    name, slug, description, videoCount
    parentTopic { name, slug }
    childTopics { name, slug, videoCount }
    experience { title, slug, sections { ... } }  # full section fragments
  }
}
```

## What To Build

1. Topic listing page: `apps/web/src/app/topics/page.tsx`
   - Server Component
   - Fetches topics with `GetTopics` query
   - Renders grid of TopicCard components
   - Hierarchy: parent topics shown with their children nested or expandable
   - Pagination (load more)

2. Topic detail page: `apps/web/src/app/topics/[slug]/page.tsx`
   - Server Component
   - Fetches topic with `GetTopic` query
   - Topic header: name, description, video count, breadcrumb (Home → Topics → Parent → This)
   - Below header: renders the linked Experience's sections using the same section renderer system as `[slug]/[locale]/page.tsx`
   - Related topics sidebar or section: links to child topics and sibling topics

3. Shared component: `apps/web/src/components/TopicCard.tsx`
   - Name, description preview, video count, thumbnail
   - Links to `/topics/[slug]`

4. Breadcrumb component: `apps/web/src/components/Breadcrumb.tsx`
   - Home → Topics → [Parent Topic] → [Current Topic]
   - Uses `next/link`

5. ISR config: topic pages should be statically generated with revalidation:

   ```typescript
   export const revalidate = 3600 // 1 hour
   ```

6. Metadata:
   ```typescript
   export async function generateMetadata({ params }): Promise<Metadata> {
     // Fetch topic, return title, description, og:image
   }
   ```

## Constraints

- Reuse the existing section renderer system for the Experience content. Do NOT rebuild section rendering.
- Topic detail page = topic header + Experience section rendering. Keep it simple.
- Do NOT build infinite scroll for topic listing. "Load more" button is fine.
- Breadcrumb is plain links, not a library.

## Verification

- Navigate to `/topics` → page loads with topic grid
- Click a topic → navigates to `/topics/forgiveness` → topic detail with Experience sections
- Breadcrumb shows correct hierarchy and links work
- `pnpm build` → topic pages build without errors
- View page source → server-rendered HTML (not client-side loading)
- Meta tags present in `<head>` for SEO
