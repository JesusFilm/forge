/* eslint-disable @typescript-eslint/no-require-imports */
/* global describe, expect, it, require */
// KTD8: the read-only server routes a request by its root field NAMES, never by
// an alias or by the text before the operation. Real app documents throughout.
const path = require("node:path")
const { getOperationAST, print } = require("graphql")

const { classifyRequest } = require("../lib/server/classify")
const { CONFIG_DIR, readJson } = require("../lib/lists")

const {
  GET_EXPERIENCE_BY_SLUG,
  GET_VIDEO_BIBLE_PASSAGES,
  GET_VIDEO_BY_SLUG,
  RECORD_WATCH_SEARCH_EVENT,
  WATCH_SEARCH,
} = require("../../src/lib/queries")
const { SUBMIT_FEEDBACK } = require("../../src/lib/feedbackQueries")
const { GET_MY_WATCH_PROGRESS } = require("../../src/lib/watchProgressQueries")
const {
  RECOMMENDATION_DOCUMENTS,
} = require("../../src/lib/recommendations/operations")
const {
  videoThumbnailsDocument,
} = require("../../src/hooks/useVideoThumbnails")

const operations = readJson(path.join(CONFIG_DIR, "operations.json"))

function bodyOf(document, variables = {}) {
  return JSON.stringify({
    operationName: getOperationAST(document)?.name?.value ?? null,
    query: print(document),
    variables,
  })
}

function classify(raw) {
  return classifyRequest(raw, operations)
}

describe("reads that the server forwards", () => {
  it("forwards GetVideoBySlug and names videoBySlug", () => {
    const result = classify(bodyOf(GET_VIDEO_BY_SLUG, { slug: "jesus" }))
    expect(result).toMatchObject({
      action: "forward",
      reason: null,
      opType: "query",
      opName: "GetVideoBySlug",
      rootFields: { "Query.videoBySlug": 1 },
    })
  })

  it("reads the field name of the aliased englishExperience under @skip", () => {
    const result = classify(
      bodyOf(GET_EXPERIENCE_BY_SLUG, {
        locale: "fr",
        slug: "watch-home",
        isEnglish: false,
      }),
    )
    expect(result.action).toBe("forward")
    expect(result.rootFields).toEqual({ "Query.experienceBySlug": 2 })
  })

  it("counts each aliased video node of the runtime-built VideoThumbnails", () => {
    const result = classify(bodyOf(videoThumbnailsDocument(30)))
    expect(result.action).toBe("forward")
    expect(result.rootFields).toEqual({ "Query.video": 30 })
  })

  it("forwards GetVideoBiblePassages, which selects bibleCitations { passage }", () => {
    const result = classify(bodyOf(GET_VIDEO_BIBLE_PASSAGES))
    expect(result.action).toBe("forward")
    expect(result.rootFields).toEqual({ "Query.videoBySlug": 1 })
  })

  it("reads root fields through a fragment spread and leaves out __typename", () => {
    const result = classify(
      JSON.stringify({
        query:
          'query Spread { __typename ...Root } fragment Root on Query { video(id: "a") { id } }',
      }),
    )
    expect(result.action).toBe("forward")
    expect(result.rootFields).toEqual({ "Query.video": 1 })
  })
})

describe("the saved-answer and success-reply routes", () => {
  it("sends WatchSearch to the saved answers", () => {
    const result = classify(bodyOf(WATCH_SEARCH, { input: { query: "jesus" } }))
    expect(result).toMatchObject({
      action: "search",
      rootFields: { "Query.watchSearch": 1 },
    })
  })

  it("gives a success reply to SubmitFeedback after a leading # comment", () => {
    const raw = JSON.stringify({
      operationName: "SubmitFeedback",
      query: `# The app's feedback write\n${print(SUBMIT_FEEDBACK)}`,
      variables: {},
    })
    expect(classify(raw)).toMatchObject({
      action: "successReply",
      opType: "mutation",
      opName: "SubmitFeedback",
      rootFields: { "Mutation.submitFeedback": 1 },
    })
  })
})

describe("requests that the server blocks", () => {
  it.each([
    ["RecordWatchSearchEvent", RECORD_WATCH_SEARCH_EVENT],
    ["UserRecommendations", RECOMMENDATION_DOCUMENTS.UserRecommendations],
    ["GetMyWatchProgress", GET_MY_WATCH_PROGRESS],
  ])("blocks %s", (_name, document) => {
    const result = classify(bodyOf(document))
    expect(result.action).toBe("block")
    expect(result.reason).toMatch(/^field-blocked /)
  })

  it("blocks a mutation whose root field has a read-only name", () => {
    const result = classify(
      JSON.stringify({ query: 'mutation Sneaky { video(id: "a") { id } }' }),
    )
    expect(result).toMatchObject({ action: "block", opType: "mutation" })
  })

  it("forwards no mutation, even when a list edit puts its field in readOnly", () => {
    const edited = {
      ...operations,
      readOnly: [...operations.readOnly, "Mutation.submitFeedback"],
      successReply: [],
    }
    const result = classifyRequest(bodyOf(SUBMIT_FEEDBACK), edited)
    expect(result).toMatchObject({
      action: "block",
      reason: "wrong-type mutation",
    })
  })

  it("blocks a read that also asks for a blocked root field", () => {
    const result = classify(
      JSON.stringify({
        query:
          'query Mixed { videoBySlug(slug: "a") { id } myWatchProgress { videoId } }',
      }),
    )
    expect(result.action).toBe("block")
  })

  it("blocks a body with two operation definitions", () => {
    const raw = JSON.stringify({
      operationName: "GetVideoBySlug",
      query: `${print(GET_VIDEO_BY_SLUG)}\n${print(RECORD_WATCH_SEARCH_EVENT)}`,
    })
    expect(classify(raw)).toMatchObject({
      action: "block",
      reason: "multiple-operations",
    })
  })

  it("blocks an operationName that the document does not have", () => {
    const raw = JSON.stringify({
      operationName: "RecordWatchSearchEvent",
      query: print(GET_VIDEO_BY_SLUG),
    })
    expect(classify(raw)).toMatchObject({
      action: "block",
      reason: "unknown-operation-name",
    })
  })

  it.each([
    ["a batch array", JSON.stringify([{ query: print(GET_VIDEO_BY_SLUG) }])],
    ["a body that is not JSON", "{ not json"],
    ["a document that does not parse", JSON.stringify({ query: "query {" })],
    [
      "a spread of a fragment that is not there",
      JSON.stringify({ query: "query Q { ...Missing }" }),
    ],
    ["a body with no query text", JSON.stringify({ variables: {} })],
  ])("blocks %s", (_label, raw) => {
    expect(classify(raw).action).toBe("block")
  })
})
