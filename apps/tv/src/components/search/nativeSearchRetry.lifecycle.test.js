/* global require, jest, test, expect, beforeEach, afterEach */
/* eslint-disable @typescript-eslint/no-require-imports */
const mockQuery = jest.fn()
jest.mock("../../lib/apolloClient", () => ({
  getApolloClient: () => ({ query: (...args) => mockQuery(...args) }),
}))
jest.mock("../../lib/datadog", () => ({ datadogLog: { info: jest.fn() } }))
jest.mock("../../lib/queries", () => ({ WATCH_SEARCH: "WatchSearch" }))
const React = require("react")
const { act, create } = require(
  require.resolve("react-test-renderer", {
    paths: [require.resolve("jest-expo/package.json")],
  }),
)
const { useSemanticSearch } = require("../../lib/search")
globalThis.IS_REACT_ACT_ENVIRONMENT = true
let latest
let renderer
function SearchHarness({ query }) {
  latest = useSemanticSearch(query)
  return null
}
beforeEach(() => {
  jest.useFakeTimers()
  mockQuery.mockReset()
  jest.spyOn(console, "error").mockImplementation(() => {})
  jest.spyOn(console, "log").mockImplementation(() => {})
})
afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount())
  renderer = null
  jest.useRealTimers()
  jest.restoreAllMocks()
})

test("native Retry searches edited B once after failed A and cancels B's debounce", async () => {
  mockQuery.mockRejectedValueOnce(new Error("synthetic search failure"))
  mockQuery.mockResolvedValue({ data: { watchSearch: { results: [] } } })
  await act(async () => {
    renderer = create(React.createElement(SearchHarness, { query: "jesus" }))
  })
  await act(async () => {
    jest.advanceTimersByTime(900)
  })
  expect(latest.state).toBe("error")
  await act(async () => {
    renderer.update(React.createElement(SearchHarness, { query: "bible" }))
  })
  expect(latest.state).toBe("error")
  // Native Retry uses the latest current-field submit closure. It cancels
  // debounce without the same-value runQuery skip flag swallowing the next edit.
  await act(async () => {
    latest.submit()
  })
  await act(async () => {
    jest.advanceTimersByTime(2000)
  })
  expect(
    mockQuery.mock.calls.map(([request]) => request.variables.input.query),
  ).toEqual(["jesus", "bible"])
  expect(latest.lastSubmittedQuery).toBe("bible")
  await act(async () => {
    renderer.update(React.createElement(SearchHarness, { query: "moses" }))
  })
  await act(async () => {
    jest.advanceTimersByTime(900)
  })
  expect(
    mockQuery.mock.calls.map(([request]) => request.variables.input.query),
  ).toEqual(["jesus", "bible", "moses"])
})
