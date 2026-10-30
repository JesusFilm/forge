/* eslint-disable @typescript-eslint/no-require-imports */
/* global jest, test, expect, beforeEach, afterEach, Response, AbortController, require */
jest.mock("./config", () => ({
  getGraphQLUrl: () => "https://tv-recovery.invalid/graphql",
  getApiToken: () => undefined,
}))
jest.mock("./viewer-id", () => ({ getViewerId: () => "recovery-viewer" }))
jest.mock("./datadog", () => ({
  datadogGraphqlHeaders: () => ({}),
  isDatadogProvisioned: () => false,
}))
const { gql } = require("@apollo/client")
const { fetchWithTimeout, getApolloClient } = require("./apolloClient")
const query = gql`
  query TransportRecovery {
    __typename
  }
`
const originalFetch = globalThis.fetch
let fetchMock
let client

const jsonResponse = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  })
const abortError = () =>
  Object.assign(new Error("Request aborted"), { name: "AbortError" })
const request = (context) =>
  client.query({ query, context, fetchPolicy: "no-cache" })
// Attach rejection immediately so an expected error cannot become an unhandled rejection.
const outcome = (promise) =>
  promise.then(
    (result) => ({ result }),
    (error) => ({ error }),
  )

beforeEach(() => {
  jest.useFakeTimers()
  jest.spyOn(Math, "random").mockReturnValue(0.5)
  fetchMock = jest.fn()
  globalThis.fetch = fetchMock
  client = getApolloClient()
})
afterEach(() => {
  client.stop()
  globalThis.fetch = originalFetch
  jest.restoreAllMocks()
  jest.useRealTimers()
})

test("actual HTTP transport recovers after a network failure", async () => {
  fetchMock
    .mockRejectedValueOnce(new TypeError("Network request failed"))
    .mockResolvedValueOnce(jsonResponse({ data: { __typename: "Query" } }))
  const pending = outcome(request())
  await jest.runAllTimersAsync()
  expect((await pending).result.data.__typename).toBe("Query")
  expect(fetchMock).toHaveBeenCalledTimes(2)
})

test("network retries stop at three total attempts", async () => {
  fetchMock.mockRejectedValue(new TypeError("Network request failed"))
  const pending = outcome(request())
  await jest.runAllTimersAsync()
  expect((await pending).error).toBeDefined()
  expect(fetchMock).toHaveBeenCalledTimes(3)
})

test("HTTP 503 can recover without changing the three-attempt policy", async () => {
  fetchMock
    .mockResolvedValueOnce(jsonResponse({ error: "Unavailable" }, 503))
    .mockResolvedValueOnce(jsonResponse({ data: { __typename: "Query" } }))
  const pending = outcome(request())
  await jest.runAllTimersAsync()
  expect((await pending).result.data.__typename).toBe("Query")
  expect(fetchMock).toHaveBeenCalledTimes(2)
})

test.each([400, 401, 403, 429])("HTTP %s is not retried", async (status) => {
  fetchMock.mockImplementation(async () =>
    jsonResponse({ error: "Rejected" }, status),
  )
  const pending = outcome(request())
  await jest.runAllTimersAsync()
  expect((await pending).error).toBeDefined()
  expect(fetchMock).toHaveBeenCalledTimes(1)
})

test("a malformed JSON response is not retried", async () => {
  fetchMock.mockResolvedValue(
    new Response("invalid JSON", {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  )
  const pending = outcome(request())
  await jest.runAllTimersAsync()
  expect((await pending).error).toBeDefined()
  expect(fetchMock).toHaveBeenCalledTimes(1)
})

test("a GraphQL response error is not retried", async () => {
  fetchMock.mockResolvedValue(
    jsonResponse({ errors: [{ message: "Query rejected" }] }),
  )
  const pending = outcome(request())
  await jest.runAllTimersAsync()
  expect((await pending).error).toBeDefined()
  expect(fetchMock).toHaveBeenCalledTimes(1)
})

test("a mutation is never replayed after network failure", async () => {
  fetchMock.mockRejectedValue(new TypeError("Network request failed"))
  const pending = outcome(
    client.mutate({
      mutation: gql`
        mutation NoReplay {
          __typename
        }
      `,
    }),
  )
  await jest.runAllTimersAsync()
  expect((await pending).error).toBeDefined()
  expect(fetchMock).toHaveBeenCalledTimes(1)
})

test("an AbortError transport rejection is not retried", async () => {
  fetchMock.mockRejectedValue(abortError())
  const pending = outcome(request())
  await jest.runAllTimersAsync()
  expect((await pending).error.name).toBe("AbortError")
  expect(fetchMock).toHaveBeenCalledTimes(1)
})

test("an already-aborted caller starts no HTTP request", async () => {
  const controller = new AbortController()
  controller.abort()
  const settled = await outcome(
    request({ fetchOptions: { signal: controller.signal } }),
  )
  expect(settled.error.name).toBe("AbortError")
  expect(fetchMock).not.toHaveBeenCalled()
  // The fetch wrapper independently protects direct/late transport invocation too.
  await expect(
    fetchWithTimeout("https://tv-recovery.invalid/graphql", {
      signal: controller.signal,
    }),
  ).rejects.toMatchObject({ name: "AbortError" })
  expect(fetchMock).not.toHaveBeenCalled()
})

test("cancellation during backoff rejects immediately and cancels later attempts", async () => {
  const controller = new AbortController()
  fetchMock.mockRejectedValue(new TypeError("Network request failed"))
  const pending = outcome(
    request({ fetchOptions: { signal: controller.signal } }),
  )
  await jest.advanceTimersByTimeAsync(0)
  expect(fetchMock).toHaveBeenCalledTimes(1)
  controller.abort()
  expect((await pending).error.name).toBe("AbortError")
  await jest.advanceTimersByTimeAsync(10000)
  expect(fetchMock).toHaveBeenCalledTimes(1)
})

test("the actual fetch deadline aborts once without retrying", async () => {
  fetchMock.mockImplementation(
    (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(abortError()), {
          once: true,
        })
      }),
  )
  const pending = outcome(request())
  await jest.advanceTimersByTimeAsync(15001)
  expect((await pending).error.name).toBe("AbortError")
  await jest.runAllTimersAsync()
  expect(fetchMock).toHaveBeenCalledTimes(1)
})

test("cancelling an active fetch aborts its actual signal and never replays", async () => {
  const controller = new AbortController()
  fetchMock.mockImplementation(
    (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(abortError()), {
          once: true,
        })
      }),
  )
  const pending = outcome(
    request({ fetchOptions: { signal: controller.signal } }),
  )
  await jest.advanceTimersByTimeAsync(0)
  const transportSignal = fetchMock.mock.calls[0][1].signal
  controller.abort()
  expect((await pending).error.name).toBe("AbortError")
  expect(transportSignal.aborted).toBe(true)
  await jest.runAllTimersAsync()
  expect(fetchMock).toHaveBeenCalledTimes(1)
})

test("fetch cleanup removes the caller abort listener after success", async () => {
  const controller = new AbortController()
  const remove = jest.spyOn(controller.signal, "removeEventListener")
  fetchMock.mockResolvedValue(jsonResponse({ data: { __typename: "Query" } }))
  await fetchWithTimeout("https://tv-recovery.invalid/graphql", {
    signal: controller.signal,
  })
  expect(remove).toHaveBeenCalledWith("abort", expect.any(Function))
})
