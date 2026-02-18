import { graphql } from "@forge/graphql"
import client from "@/lib/client"

const GET_EXPERIENCE = graphql(`
  query GetExperience($slug: String!, $locale: String!) {
    experience(filters: { slug: { eq: $slug }, locale: { eq: $locale } }) {
      id
    }
  }
`)

export async function readPublishedContent(slug: string, locale: string) {
  const { data } = await client.query({
    query: GET_EXPERIENCE,
    variables: { slug, locale },
  })
  return data?.experience
}
