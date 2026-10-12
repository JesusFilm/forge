/**
 * Daily Bible Pause v2 (R16, KTD6): the one-shot store that hands the run's
 * question to the search tab. The tab's wiring is pinned in
 * `app/(tabs)/__tests__/discoverStrings.test.tsx`.
 */

import { act, createElement } from "react"

import {
  TestRenderer,
  type TestInstance,
} from "../../test-utils/rnTestRenderer"
import {
  SEARCH_INTENT_TTL_MS,
  createSearchIntentStore,
  getSearchIntentStore,
  usePendingSearchIntent,
  type SearchIntent,
  type SearchIntentStore,
} from "../searchIntent"

const T0 = 1_700_000_000_000
const QUESTION = "How are we commanded to pray?"

describe("the search intent store", () => {
  it("returns a put intent from peek, and a peek never consumes", () => {
    const store = createSearchIntentStore(() => T0)
    const put = store.put(QUESTION)

    expect(put).toMatchObject({
      query: QUESTION,
      origin: "dailyPause",
      createdAt: T0,
    })
    expect(store.peek()).toBe(put)
    expect(store.peek()).toBe(put)
  })

  it("is one-shot once the tab consumes it", () => {
    const store = createSearchIntentStore(() => T0)
    const put = store.put(QUESTION)

    store.consume(put)

    expect(store.peek()).toBeNull()
  })

  it("keeps a newer intent when the tab consumes an older one", () => {
    const store = createSearchIntentStore(() => T0)
    const older = store.put(QUESTION)
    const newer = store.put(QUESTION)

    store.consume(older)

    expect(store.peek()).toBe(newer)
  })

  it("makes two puts of the same question two different intents", () => {
    const store = createSearchIntentStore(() => T0)
    const first = store.put(QUESTION)
    const second = store.put(QUESTION)

    expect(second.query).toBe(first.query)
    expect(second).not.toBe(first)
  })

  it("reads an intent past its time limit as absent", () => {
    let now = T0
    const store = createSearchIntentStore(() => now)
    const put = store.put(QUESTION)

    now = T0 + SEARCH_INTENT_TTL_MS - 1
    expect(store.peek()).toBe(put)
    now = T0 + SEARCH_INTENT_TTL_MS
    expect(store.peek()).toBeNull()
  })

  it("tells each subscriber when an intent arrives or leaves", () => {
    const store = createSearchIntentStore(() => T0)
    const seen: (SearchIntent | null)[] = []
    const unsubscribe = store.subscribe(() => seen.push(store.peek()))

    const first = store.put(QUESTION)
    const second = store.put(QUESTION)
    // An intent that is no longer pending changes nothing.
    store.consume(first)
    store.consume(second)
    unsubscribe()
    store.put(QUESTION)

    expect(seen).toEqual([first, second, null])
  })

  it("keeps one store for the app, so the run and the tab meet", () => {
    expect(getSearchIntentStore()).toBe(getSearchIntentStore())
  })
})

describe("usePendingSearchIntent", () => {
  it("re-renders a mounted reader on each put and consume", () => {
    const store: SearchIntentStore = createSearchIntentStore(() => T0)
    const seen: (SearchIntent | null)[] = []
    function Probe() {
      seen.push(usePendingSearchIntent(store))
      return null
    }
    let renderer!: TestInstance
    act(() => {
      renderer = TestRenderer.create(createElement(Probe))
    })

    let put!: SearchIntent
    act(() => {
      put = store.put(QUESTION)
    })
    act(() => store.consume(put))

    expect(seen[0]).toBeNull()
    expect(seen).toContain(put)
    expect(seen[seen.length - 1]).toBeNull()
    act(() => renderer.unmount())
  })
})
