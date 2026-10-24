// Synthetic loopback Admin for the production document-status regression.
import http from "node:http"
let state = { mode: "fresh", published: false, generation: 1 }
const audit = (data) =>
  console.log(JSON.stringify({ at: new Date().toISOString(), ...data }))
const manifest = () => ({
  version: "fixture-v" + state.generation,
  generatedAt: "2026-10-24T00:00:00.000Z",
  contentSlugs: ["fixture-video", "fixture-slow-video"],
  oneSegmentSlugs: [
    "runtime-positive",
    ...(state.published ? ["runtime-published"] : []),
  ],
  episodePairsByParent: {},
  audioLanguageSlugs: ["english", "spanish", "spanish-latin-american"],
  audioLanguageIndexesByContent: {
    "fixture-video": [0],
    "fixture-slow-video": [0],
  },
  audioLanguageIndexesByEpisode: {},
  nestedContainerAudioLanguageIndexesByParent: {},
})
function experience(slug, locale) {
  return {
    __typename: "ExperienceLocale",
    id: "fixture-" + slug,
    slug,
    locale,
    isHomepage: false,
    title: "Runtime fixture " + slug,
    metaDescription: "Controlled local renderer proof",
    ogTitle: null,
    ogDescription: null,
    ogImageUrl: null,
    pathSegment: slug,
    blocks: [
      {
        __typename: "TextBlock",
        t: "TextBlock",
        sectionKey: "runtime-heading",
        heading: "Rendered " + slug,
        headingLevel: "h1",
        subtitle: "Local synthetic GraphQL fixture",
        contentParagraphs: [
          "Actual unchanged Next document and client renderer.",
        ],
        textVariant: "default",
        imageAssetId: null,
        imageAsset: null,
        backgroundColor: null,
      },
    ],
  }
}
const backend = http.createServer(async (req, res) => {
  let body = ""
  for await (const chunk of req) body += chunk
  if (req.url === "/control" && req.method === "POST") {
    state = { ...state, ...JSON.parse(body) }
    audit({ kind: "control", state })
    res.writeHead(200, { "content-type": "application/json" })
    return res.end(JSON.stringify(state))
  }
  if (req.url === "/state") {
    res.writeHead(200, { "content-type": "application/json" })
    return res.end(JSON.stringify(state))
  }
  if (req.url === "/api/watch-route-manifest") {
    const etag = '"fixture-' + state.generation + '"'
    let status = state.mode === "unavailable" ? 503 : 200
    if (status === 200 && req.headers["if-none-match"] === etag) status = 304
    audit({
      kind: "manifest",
      status,
      validator: req.headers["if-none-match"] || null,
      state,
    })
    res.writeHead(status, { "content-type": "application/json", etag })
    return res.end(
      status === 200
        ? JSON.stringify(manifest())
        : status === 503
          ? "Unavailable"
          : "",
    )
  }
  if (req.url === "/api/graphql") {
    let query
    try {
      query = JSON.parse(body)
    } catch {
      res.writeHead(400)
      return res.end()
    }
    const op = query.operationName || query.query?.match(/query\s+(\w+)/)?.[1]
    audit({ kind: "graphql", op, variables: query.variables })
    if (
      state.recoveryDelayMs &&
      Object.values(query.variables ?? {}).some(
        (value) => value === "fixture-video" || value === "fixture-slow-video",
      )
    ) {
      await new Promise((resolve) => setTimeout(resolve, state.recoveryDelayMs))
    }
    const slug = query.variables?.slug
    let data
    if (/Get(?:Legacy|PreCopy)?WatchExperience/.test(op))
      data = {
        experienceBySlug: [
          "runtime-positive",
          ...(state.published ? ["runtime-published"] : []),
        ].includes(slug)
          ? experience(slug, query.variables.locale)
          : null,
      }
    else if (/Get(?:Legacy|PreCopy)?WatchSettings/.test(op))
      data = { watchSetting: null }
    else if (op === "GetWatchVideoRouteSnapshotBySlug")
      data = { watchVideoRouteSnapshotBySlug: null }
    else {
      res.writeHead(200, { "content-type": "application/json" })
      return res.end(
        JSON.stringify({
          errors: [{ message: "Unimplemented synthetic operation: " + op }],
        }),
      )
    }
    res.writeHead(200, { "content-type": "application/json" })
    return res.end(JSON.stringify({ data }))
  }
  res.writeHead(404)
  res.end()
})
audit({ kind: "fixture-boot", state })
const port = Number(process.env.WATCH_MANIFEST_FIXTURE_PORT || 32849)
backend.listen(port, "127.0.0.1", () => console.log(`manifest fixture ${port}`))
