/* global require, jest, beforeEach, afterEach, test, expect */
/* eslint-disable @typescript-eslint/no-require-imports */
const mockListeners = new Set()
const mockAppState = {
  currentState: "active",
  addEventListener: jest.fn((_event, listener) => {
    mockListeners.add(listener)
    return { remove: () => mockListeners.delete(listener) }
  }),
}
const mockGetItem = jest.fn()
const mockSetItem = jest.fn(async () => {})
const mockRemoveItem = jest.fn(async () => {})
const mockQuery = jest.fn()
jest.mock("react-native", () => ({
  Platform: { OS: "ios", isTV: true },
  AppState: mockAppState,
}))
jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: (...args) => mockGetItem(...args),
    setItem: (...args) => mockSetItem(...args),
    removeItem: (...args) => mockRemoveItem(...args),
  },
}))
jest.mock("../lib/apolloClient", () => ({
  getApolloClient: () => ({ query: (...args) => mockQuery(...args) }),
}))
jest.mock("../lib/watchHome/logWatchHomeFallback", () => ({
  logWatchHomeFallback: jest.fn(),
}))

const React = require("react")
// Use the renderer already owned by jest-expo; no extra app dependency.
const { act, create } = require(
  require.resolve("react-test-renderer", {
    paths: [require.resolve("jest-expo/package.json")],
  }),
)
const { useWatchHome } = require("./useWatchHome")
const {
  GET_WATCH_HOME_VIDEOS,
  GET_WATCH_SETTING,
} = require("../lib/watchHome/homeQueries")
const { serializeHomeSnapshot } = require("../lib/watchHome/homeSnapshot")

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const video = {
  documentId: "qa-film-id",
  coreId: "qa-core",
  slug: "qa-film",
  label: "FEATURE_FILM",
  durationSeconds: 120,
  locales: [{ title: "QA film" }],
  images: [{ mobileCinematicHigh: "https://example.test/film.jpg" }],
}
function blocks(title = "Journey original") {
  return [
    {
      __typename: "MediaCollectionBlock",
      sectionKey: "qa-journey",
      title,
      mediaCollectionVariant: "carousel",
      items: [{ coreId: video.coreId }],
    },
  ]
}
function setting(body = blocks()) {
  return {
    data: {
      watchSetting: {
        homepageExperience: body === null ? null : { blocks: body },
      },
    },
  }
}
function primary() {
  return { data: { watchHomeVideos: [video] } }
}
function deferred() {
  let resolve
  let reject
  const promise = new Promise((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

let root
let current
let renders
let videoResponses
let settingResponses
let consoleError
function Probe({ options }) {
  current = useWatchHome(options)
  renders.push(current)
  return null
}
async function mount(options) {
  await act(async () => {
    root = create(React.createElement(Probe, { options }))
  })
}
async function update(options) {
  await act(async () => {
    root.update(React.createElement(Probe, { options }))
  })
}
async function state(next) {
  await act(async () => {
    mockAppState.currentState = next
    mockListeners.forEach((listener) => listener(next))
  })
}
function titles() {
  return current.model?.sections.map((section) => section.title) ?? []
}
function calls(document) {
  return mockQuery.mock.calls
    .map(([options]) => options)
    .filter((options) => options.query === document)
}

beforeEach(() => {
  jest.clearAllMocks()
  root = null
  current = null
  renders = []
  videoResponses = []
  settingResponses = []
  mockListeners.clear()
  mockAppState.currentState = "active"
  mockGetItem.mockResolvedValue(null)
  mockQuery.mockImplementation(({ query }) => {
    if (query === GET_WATCH_HOME_VIDEOS)
      return videoResponses.length
        ? videoResponses.shift()
        : Promise.resolve(primary())
    if (query === GET_WATCH_SETTING)
      return settingResponses.length
        ? settingResponses.shift()
        : Promise.resolve(setting())
    throw new Error("Unexpected query in Home lifecycle test")
  })
  const original = console.error
  consoleError = jest
    .spyOn(console, "error")
    .mockImplementation((message, ...args) => {
      // React 19 emits this deprecation for its own renderer. Keep other warnings.
      if (String(message).startsWith("react-test-renderer is deprecated"))
        return
      original(message, ...args)
    })
})
afterEach(async () => {
  if (root) await act(async () => root.unmount())
  consoleError.mockRestore()
})

test("default Home keeps cache-first initial fetching and does not refresh on lifecycle events", async () => {
  await mount()
  expect(calls(GET_WATCH_SETTING)).toHaveLength(1)
  expect(calls(GET_WATCH_SETTING)[0].fetchPolicy).toBe("cache-first")
  expect(calls(GET_WATCH_SETTING)[0]).not.toHaveProperty("context")
  expect(calls(GET_WATCH_HOME_VIDEOS)[0]).not.toHaveProperty("context")
  await state("background")
  await state("active")
  expect(calls(GET_WATCH_SETTING)).toHaveLength(1)
  expect(current.refreshing).toBe(false)
})

test("foreground opt-in issues one initial load and one network refresh per real return", async () => {
  await mount({ refreshOnForeground: true })
  expect(calls(GET_WATCH_SETTING)).toHaveLength(1)
  await state("active")
  expect(calls(GET_WATCH_SETTING)).toHaveLength(1)
  await state("background")
  await state("active")
  await state("active")
  expect(calls(GET_WATCH_SETTING)).toHaveLength(2)
  expect(calls(GET_WATCH_SETTING)[1].fetchPolicy).toBe("network-only")
  expect(calls(GET_WATCH_HOME_VIDEOS)).toHaveLength(2)
})

test("initial AppState discovery is not mistaken for a foreground return", async () => {
  mockAppState.currentState = null
  await mount({ refreshOnForeground: true })
  await state("active")
  expect(calls(GET_WATCH_SETTING)).toHaveLength(1)
})

test("a beta key gets one fresh initial load; reselect fences the first render before its effect", async () => {
  await mount({ refreshKey: 0 })
  expect(calls(GET_WATCH_SETTING)).toHaveLength(1)
  expect(calls(GET_WATCH_SETTING)[0].fetchPolicy).toBe("network-only")
  const oldModel = current.model
  const pending = deferred()
  settingResponses.push(pending.promise)
  const firstNewRender = renders.length
  await update({ refreshKey: 1 })
  expect(renders[firstNewRender].refreshing).toBe(true)
  expect(renders[firstNewRender].model).toBe(oldModel)
  expect(current.refreshing).toBe(true)
  expect(calls(GET_WATCH_SETTING)).toHaveLength(2)
  await act(async () => pending.resolve(setting(blocks("Journey changed"))))
  expect(titles()).toEqual(["Journey changed"])
  expect(current.refreshing).toBe(false)
  await update({ refreshKey: 1 })
  expect(calls(GET_WATCH_SETTING)).toHaveLength(2)
})

test("a snapshot paints immediately but cannot mark the pending live refresh as complete", async () => {
  mockGetItem.mockResolvedValue(
    serializeHomeSnapshot([video], new Date(), blocks("Snapshot Journey")),
  )
  const pending = deferred()
  settingResponses.push(pending.promise)
  await mount({ refreshKey: 0 })
  expect(titles()).toEqual(["Snapshot Journey"])
  expect(current.loading).toBe(false)
  expect(current.refreshing).toBe(true)
  await act(async () => pending.resolve(setting(blocks("Fresh Journey"))))
  expect(titles()).toEqual(["Fresh Journey"])
  expect(current.refreshing).toBe(false)
})

test("unchanged fresh responses preserve the painted model across repeated revalidation", async () => {
  await mount({ refreshKey: 0, refreshOnForeground: true })
  const initialModel = current.model
  await update({ refreshKey: 1, refreshOnForeground: true })
  expect(current.model).toBe(initialModel)
  await state("background")
  await state("active")
  expect(current.model).toBe(initialModel)
  expect(calls(GET_WATCH_SETTING)).toHaveLength(3)
  settingResponses.push(Promise.resolve(setting(blocks("Changed Journey"))))
  await update({ refreshKey: 2, refreshOnForeground: true })
  const changedModel = current.model
  expect(changedModel).not.toBe(initialModel)
  settingResponses.push(Promise.resolve(setting(blocks("Changed Journey"))))
  await update({ refreshKey: 3, refreshOnForeground: true })
  expect(current.model).toBe(changedModel)
})

test("a primary transport error keeps the rendered model and reports a settled retryable refresh", async () => {
  await mount({ refreshKey: 0 })
  const oldModel = current.model
  const failed = deferred()
  videoResponses.push(failed.promise)
  await update({ refreshKey: 1 })
  await act(async () => failed.reject(new Error("offline")))
  expect(current.model).toBe(oldModel)
  expect(current.refreshing).toBe(false)
  expect(current.error).toBe("Couldn't load videos. Please try again.")
})

test("a settings transport error retains last-good Journey and exposes freshness failure", async () => {
  await mount({ refreshKey: 0 })
  const failed = deferred()
  settingResponses.push(failed.promise)
  await update({ refreshKey: 1 })
  await act(async () => failed.reject(new Error("offline")))
  expect(titles()).toEqual(["Journey original"])
  expect(current.refreshing).toBe(false)
  expect(current.error).toBe("Couldn't load videos. Please try again.")
})

test.each([[], null])(
  "an authoritative %p removal is not resurrected by a later settings failure",
  async (removed) => {
    await mount({ refreshKey: 0 })
    settingResponses.push(Promise.resolve(setting(removed)))
    await update({ refreshKey: 1 })
    expect(titles()).not.toContain("Journey original")
    const failed = deferred()
    settingResponses.push(failed.promise)
    await update({ refreshKey: 2 })
    await act(async () => failed.reject(new Error("offline")))
    expect(titles()).not.toContain("Journey original")
  },
)

test("a confirmed empty Journey is retired even when its parallel primary request fails", async () => {
  await mount({ refreshKey: 0 })
  const failedPrimary = deferred()
  videoResponses.push(failedPrimary.promise)
  settingResponses.push(Promise.resolve(setting([])))
  await update({ refreshKey: 1 })
  await act(async () => failedPrimary.reject(new Error("offline")))
  expect(current.error).not.toBeNull()
  const failedSetting = deferred()
  settingResponses.push(failedSetting.promise)
  await update({ refreshKey: 2 })
  await act(async () => failedSetting.reject(new Error("offline")))
  expect(titles()).not.toContain("Journey original")
})

test("a late disk snapshot cannot restore a Journey after a confirmed removal", async () => {
  const stored = deferred()
  mockGetItem.mockReturnValue(stored.promise)
  const failedPrimary = deferred()
  videoResponses.push(failedPrimary.promise)
  settingResponses.push(Promise.resolve(setting([])))
  await mount({ refreshKey: 0 })
  await act(async () => failedPrimary.reject(new Error("offline")))
  await act(async () =>
    stored.resolve(
      serializeHomeSnapshot([video], new Date(), blocks("Retired Journey")),
    ),
  )
  expect(titles()).not.toContain("Retired Journey")
  const failedSetting = deferred()
  settingResponses.push(failedSetting.promise)
  await update({ refreshKey: 1 })
  await act(async () => failedSetting.reject(new Error("offline")))
  expect(titles()).not.toContain("Retired Journey")
})

test("superseded requests abort and late responses cannot replace or persist the new model", async () => {
  const oldSetting = deferred()
  settingResponses.push(oldSetting.promise)
  await mount({ refreshKey: 0 })
  const oldSignal = calls(GET_WATCH_SETTING)[0].context.fetchOptions.signal
  settingResponses.push(Promise.resolve(setting(blocks("Newest Journey"))))
  await update({ refreshKey: 1 })
  expect(oldSignal.aborted).toBe(true)
  expect(titles()).toEqual(["Newest Journey"])
  expect(mockSetItem).toHaveBeenCalledTimes(1)
  await act(async () => oldSetting.resolve(setting(blocks("Obsolete Journey"))))
  expect(titles()).toEqual(["Newest Journey"])
  expect(mockSetItem).toHaveBeenCalledTimes(1)
})

test("overlapping top-ups have independent abort ownership and never reuse an obsolete query", async () => {
  const topUps = []
  const shared = new Map()
  let version = 0
  mockQuery.mockImplementation((options) => {
    if (options.query === GET_WATCH_SETTING) {
      version++
      return Promise.resolve(
        setting([
          {
            ...blocks(`Journey ${version}`)[0],
            items: [{ coreId: "qa-extra" }],
          },
        ]),
      )
    }
    if (!options.variables.coreIds.includes("qa-extra"))
      return Promise.resolve(primary())
    // Model Apollo's document/variables-only in-flight sharing. An owned
    // context must opt out, or the second refresh receives the old flight.
    const key = JSON.stringify(options.variables)
    if (options.context?.queryDeduplication !== false && shared.has(key))
      return shared.get(key)
    const flight = deferred()
    topUps.push({ ...flight, options })
    shared.set(key, flight.promise)
    return flight.promise
  })
  await mount({ refreshKey: 0 })
  expect(topUps).toHaveLength(1)
  const oldContext = topUps[0].options.context
  expect(oldContext).toBe(calls(GET_WATCH_SETTING)[0].context)
  await update({ refreshKey: 1 })
  expect(topUps).toHaveLength(2)
  expect(oldContext.fetchOptions.signal.aborted).toBe(true)
  expect(topUps[1].options.context).toBe(calls(GET_WATCH_SETTING)[1].context)
  expect(topUps[1].options.context).not.toBe(oldContext)
  const result = {
    data: { watchHomeVideos: [{ ...video, coreId: "qa-extra" }] },
  }
  await act(async () => topUps[1].resolve(result))
  expect(titles()).toEqual(["Journey 2"])
  expect(mockSetItem).toHaveBeenCalledTimes(1)
  await act(async () => topUps[0].resolve(result))
  expect(titles()).toEqual(["Journey 2"])
  expect(mockSetItem).toHaveBeenCalledTimes(1)
})

test("background aborts work; returning starts a fresh owner and ignores an old late response", async () => {
  const oldSetting = deferred()
  settingResponses.push(oldSetting.promise)
  await mount({ refreshKey: 0, refreshOnForeground: true })
  const oldSignal = calls(GET_WATCH_SETTING)[0].context.fetchOptions.signal
  await state("background")
  expect(oldSignal.aborted).toBe(true)
  settingResponses.push(Promise.resolve(setting(blocks("Foreground Journey"))))
  await state("active")
  await act(async () =>
    oldSetting.resolve(setting(blocks("Background Journey"))),
  )
  expect(titles()).toEqual(["Foreground Journey"])
  expect(mockSetItem).toHaveBeenCalledTimes(1)
})

test("disabling foreground ownership cancels hidden Home and removes its listener", async () => {
  const pending = deferred()
  settingResponses.push(pending.promise)
  await mount({ refreshKey: 0, refreshOnForeground: true })
  const oldSignal = calls(GET_WATCH_SETTING)[0].context.fetchOptions.signal
  await update({ refreshKey: 0, refreshOnForeground: false })
  expect(oldSignal.aborted).toBe(true)
  expect(mockListeners.size).toBe(0)
  await state("background")
  await state("active")
  await act(async () => pending.resolve(setting()))
  expect(mockSetItem).not.toHaveBeenCalled()
  expect(calls(GET_WATCH_SETTING)).toHaveLength(1)
})

test("unmount aborts live work and late results cannot persist Home data", async () => {
  const pending = deferred()
  settingResponses.push(pending.promise)
  await mount({ refreshKey: 0 })
  const oldSignal = calls(GET_WATCH_SETTING)[0].context.fetchOptions.signal
  await act(async () => root.unmount())
  root = null
  expect(oldSignal.aborted).toBe(true)
  await act(async () => pending.resolve(setting()))
  expect(mockSetItem).not.toHaveBeenCalled()
})
