// Real content helpers (merge/prune) with only the Admin-backed resolver
// replaced by one synthetic video.
export * from "../../../src/lib/content.ts"

const language = { slug: "english", bcp47: "en", name: "English" }
const selectedVariant = {
  documentId: "var1",
  hls: "https://cdn.example/storyclubs.m3u8",
  muxVideo: { playbackId: "pb1" },
  language,
  published: true,
  duration: 30,
  downloads: [],
}

export async function resolveWatchRouteBySlug() {
  return {
    kind: "video",
    canonicalParent: null,
    selectedVariant,
    video: {
      documentId: "v1",
      slug: "storyclubs",
      title: "StoryClubs",
      label: "featureFilm",
      noIndex: false,
      images: [],
      parents: [],
      children: [],
      childDubLanguages: [language],
      playableLanguageCount: 2285,
      variants: [selectedVariant],
      subtitles: [],
      studyQuestions: [],
      bibleCitations: [],
    },
  }
}
