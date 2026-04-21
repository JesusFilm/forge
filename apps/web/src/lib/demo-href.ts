import type { Route } from "next"
import type { SearchResult } from "@/lib/search"

// Shared between the search results grid and the AI-generated experience
// preview so their navigation stays consistent. Videos go to the demo player
// (scene recommendations underneath); experiences bypass the demo and render
// via the canonical /[slug]/[locale] route.
export function demoResultHref(result: {
  type: SearchResult["type"]
  slug: string
}): Route {
  return result.type === "experience"
    ? (`/${result.slug}/en` as Route)
    : (`/demo-search/${result.slug}/en` as Route)
}
