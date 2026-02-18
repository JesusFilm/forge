import { graphql } from "@forge/graphql"
import client from "@/lib/client"

const GET_EXPERIENCE = graphql(`
  query GetExperience($slug: String!, $locale: I18NLocaleCode!) {
    experiences(filters: { slug: { eq: $slug } }, locale: $locale) {
      documentId
    }
  }
`)

export async function readPublishedContent(slug: string, locale: string) {
  if (!process.env.NEXT_PUBLIC_GRAPHQL_URL) return null
  const result = await client.query({
    query: GET_EXPERIENCE,
    variables: { slug, locale },
  })
  if (result.error) return null
  const items = result.data?.experiences
  return items?.[0] ?? null
}
