---
title: "Server-side Strapi GraphQL queries in Next.js pages"
date: 2026-03-22
category: graphql
tags: [strapi, graphql, nextjs, server-components, pagination]
---

# Server-Side Strapi GraphQL Queries in Next.js Pages

## Problem

Client components (LanguageGeoSelector, LiveJobsTable) need data from Strapi, but Strapi requires an API token that can't be exposed client-side.

## Solution

Fetch data server-side in Next.js page components (RSC) and pass as props to client components. No proxy API routes needed.

### Pattern

```typescript
// page.tsx (server component)
import { graphql } from "@forge/graphql"
import getClient from "@/cms/client"

const GET_LANGUAGES = graphql(`
  query GetLanguages($pagination: PaginationArg) {
    languages(pagination: $pagination) { gatewayId, name }
  }
`)

export default async function Page() {
  const client = getClient()
  const { data } = await client.query({
    query: GET_LANGUAGES,
    variables: { pagination: { pageSize: 100 } },
    fetchPolicy: "no-cache",
  })

  return <ClientComponent languages={data?.languages ?? []} />
}
```

### Pagination with `_connection` queries

Strapi v5 defaults `maxLimit` to 100 in `config/api.ts`. For server-to-server queries with large datasets (languages, countryLanguages), increase `api.rest.maxLimit` to 5000 so most collections fit in a single request. The pagination loop is still needed as a safety net:

```typescript
async function fetchAllPages<T>(
  fetcher: (page: number) => Promise<{ nodes: T[]; pageInfo: PageInfo }>,
): Promise<T[]> {
  const all: T[] = []
  let page = 1
  while (true) {
    const result = await fetcher(page)
    all.push(...result.nodes)
    if (page >= result.pageInfo.pageCount) break
    page++
  }
  return all
}
```

### Key points

- Use `fetchPolicy: "no-cache"` — Apollo's `InMemoryCache` is stale across requests on the server
- Use `graphql()` from `@forge/graphql` for typed operations on existing types
- Use `gql` from `@apollo/client` for untyped operations on newly created types (before codegen)
- Graceful degradation: wrap in try/catch, render with empty data on failure
