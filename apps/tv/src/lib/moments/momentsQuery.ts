// The moments document, alone in its own module so pure consumers and tests
// import the DOCUMENT without dragging in the Apollo client (the
// recordWatchEventDocument precedent — the client reaches the native Datadog
// SDK and cannot be parsed under jest).

import { adminGraphql as graphql } from "@forge/admin-graphql"

export const GET_VIDEO_MOMENTS = graphql(`
  query VideoMoments($slug: String!, $languageSlug: String) {
    videoBySlug(slug: $slug) {
      documentId: id
      moments(languageSlug: $languageSlug) {
        startSeconds
        endSeconds
        summary
        bibleVerses
      }
    }
  }
`)
