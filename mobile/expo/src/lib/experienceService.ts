import type { ApolloClient, ErrorLike } from "@apollo/client"

import {
  GET_WATCH_EXPERIENCE,
  type WatchExperience,
  type WatchExperienceQueryVariables,
  type WatchExperienceSection,
} from "./graphql/queries"

export type { WatchExperienceSection }

export type ExperienceResult =
  | { data: WatchExperience; error: null }
  | { data: null; error: ErrorLike | Error }

type Filters = WatchExperienceQueryVariables["filters"]

async function fetchExperience(
  client: ApolloClient,
  filters: Filters,
  locale: string,
): Promise<ExperienceResult> {
  try {
    const result = await client.query({
      query: GET_WATCH_EXPERIENCE,
      variables: { locale, filters },
    })
    if (result.error) return { data: null, error: result.error }
    const exp = result.data?.experiences?.[0]
    if (!exp) return { data: null, error: new Error("No experience found") }
    return { data: exp, error: null }
  } catch (e) {
    return { data: null, error: e instanceof Error ? e : new Error(String(e)) }
  }
}

export async function getWatchHome(
  client: ApolloClient,
  locale: string,
): Promise<ExperienceResult> {
  return fetchExperience(client, { isHomepage: { eq: true } }, locale)
}

export async function getExperienceBySlug(
  client: ApolloClient,
  slug: string,
  locale: string,
): Promise<ExperienceResult> {
  return fetchExperience(client, { slug: { eq: slug } }, locale)
}
