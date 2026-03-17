// Strapi CMS client for apps/manager.
// Uses the shared @forge/graphql package for typed operations.
// REST is not used — all CMS access goes through the GraphQL API.

import { env } from "@/config/env"

export type StrapiRequestInit = {
  query: string
  variables?: Record<string, unknown>
}

export async function strapiGraphQL<T>(init: StrapiRequestInit): Promise<T> {
  const response = await fetch(`${env.STRAPI_URL}/graphql`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.STRAPI_API_TOKEN}`,
    },
    body: JSON.stringify({
      query: init.query,
      variables: init.variables,
    }),
    // Do not cache by default — callers opt in with next: { revalidate }
    cache: "no-store",
  })

  if (!response.ok) {
    throw new Error(
      `Strapi GraphQL request failed: ${response.status} ${response.statusText}`,
    )
  }

  const json = (await response.json()) as {
    data: T
    errors?: { message: string }[]
  }

  if (json.errors?.length) {
    throw new Error(
      `Strapi GraphQL errors: ${json.errors.map((e) => e.message).join(", ")}`,
    )
  }

  return json.data
}
