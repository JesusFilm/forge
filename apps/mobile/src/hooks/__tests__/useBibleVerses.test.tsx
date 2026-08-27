/**
 * State-machine coverage for the passage-backed Bible Quotes hook.
 *
 * The mirror fetch this replaces had no tests at all, so nothing else in the
 * suite goes red if the replacement is wrong — these are the only proof that
 * a slow, failed or empty passage read degrades instead of stranding the
 * carousel, and that the read never fires more than once per video.
 */

jest.mock("../../env", () => ({
  env: {
    EXPO_PUBLIC_ADMIN_GRAPHQL_URL: "http://localhost:3003/api/graphql",
    EXPO_PUBLIC_ADMIN_GRAPHQL_TOKEN: "test-token",
  },
}))
jest.mock("../../lib/viewer-id", () => ({ getViewerId: () => "vid-123" }))
jest.mock("../../lib/authSession", () => ({
  getAuthSession: () => ({ getFreshJwt: async () => null }),
}))
jest.mock("../../lib/datadog", () => ({
  datadogLog: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  reportDatadogError: jest.fn(),
  isDatadogProvisioned: () => false,
  datadogGraphqlHeaders: () => ({}),
  DATADOG_GRAPH_QL_OPERATION_NAME_HEADER: "x-dd-graph-ql-operation-name",
}))
jest.mock("../../lib/apolloClient", () => ({
  ...jest.requireActual("../../lib/apolloClient"),
  getApolloClient: jest.fn(),
}))

import { act } from "react"
import type React from "react"

import { REQUEST_TIMEOUT_MS, getApolloClient } from "../../lib/apolloClient"
import { datadogLog } from "../../lib/datadog"
import type { WatchBibleCitation } from "../../lib/normalizeVideo"
import { resetBiblePassageCooldownsForTests } from "../../lib/biblePassageCooldown"
import {
  PASSAGE_FETCH_DEADLINE_MS,
  useBibleVerses,
  type BibleQuotesState,
} from "../useBibleVerses"
import {
  TestRenderer,
  type TestInstance,
} from "../../test-utils/rnTestRenderer"

const mockGetClient = getApolloClient as jest.Mock
const mockInfo = datadogLog.info as jest.Mock
const mockWarn = datadogLog.warn as jest.Mock

// Every field written out: a helper that derived one from another would let a
// case pass because a sibling field also steered the branch.
function citation(
  documentId: string,
  overrides: Partial<WatchBibleCitation> = {},
): WatchBibleCitation {
  return {
    documentId,
    osisId: "Gen.1.26",
    bookName: "Genesis",
    chapterStart: 1,
    chapterEnd: null,
    verseStart: 26,
    verseEnd: 27,
    order: 0,
    ...overrides,
  }
}

function rawPassage(overrides: Record<string, unknown> = {}) {
  return {
    content: "God said, “Let’s make man in our image.”",
    copyright: "Public Domain",
    humanReference: "Genesis 1:26-27",
    provider: "youversion",
    reference: "GEN.1.26-GEN.1.27",
    versionAbbreviation: "WEBBE",
    versionId: 206,
    versionTitle: "World English Bible British Edition",
    ...overrides,
  }
}

function response(
  entries: ReadonlyArray<{
    documentId: string
    passage: Record<string, unknown> | null
  }>,
) {
  return {
    data: {
      videoBySlug: {
        documentId: "video-1",
        bibleCitations: entries.map((entry) => ({
          documentId: entry.documentId,
          passage: entry.passage,
        })),
      },
    },
  }
}

function renderHook(initial: {
  slug: string
  citations: WatchBibleCitation[]
}) {
  const seen: BibleQuotesState[] = []
  function Harness({
    slug,
    citations,
  }: {
    slug: string
    citations: WatchBibleCitation[]
  }) {
    seen.push(useBibleVerses(slug, citations))
    return null
  }
  let renderer!: TestInstance
  act(() => {
    renderer = TestRenderer.create(
      (<Harness {...initial} />) as unknown as React.ReactElement,
    )
  })
  return {
    latest: () => seen[seen.length - 1]!,
    rerender: (next: { slug: string; citations: WatchBibleCitation[] }) =>
      act(() => {
        renderer.update(
          (<Harness {...next} />) as unknown as React.ReactElement,
        )
      }),
    unmount: () => act(() => renderer.unmount()),
  }
}

const flush = async () => {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

/** Citation cards only — the always-on promo card is not passage-backed. */
function verseCards(state: BibleQuotesState) {
  return state.cards.slice(0, -1)
}

beforeEach(() => {
  jest.clearAllMocks()
  resetBiblePassageCooldownsForTests()
})

afterEach(() => {
  jest.useRealTimers()
})

describe("useBibleVerses", () => {
  // Covers R12.
  it("issues exactly one passage request for a five-citation video", async () => {
    const query = jest.fn().mockResolvedValue(
      response(
        ["c1", "c2", "c3", "c4", "c5"].map((id) => ({
          documentId: id,
          passage: rawPassage(),
        })),
      ),
    )
    mockGetClient.mockReturnValue({ query })

    renderHook({
      slug: "the-beginning",
      citations: ["c1", "c2", "c3", "c4", "c5"].map((id) => citation(id)),
    })
    await flush()

    expect(query).toHaveBeenCalledTimes(1)
    expect(query.mock.calls[0][0]).toMatchObject({
      variables: { slug: "the-beginning" },
      fetchPolicy: "cache-first",
    })
  })

  // Covers AE11.
  it("issues no request for a video with no citations", async () => {
    const query = jest.fn()
    mockGetClient.mockReturnValue({ query })

    const hook = renderHook({ slug: "no-citations", citations: [] })
    await flush()

    expect(query).not.toHaveBeenCalled()
    expect(hook.latest().loading).toBe(false)
    expect(verseCards(hook.latest())).toHaveLength(0)
  })

  it("does not re-fire when the citations array identity changes", async () => {
    const query = jest
      .fn()
      .mockResolvedValue(
        response([{ documentId: "c1", passage: rawPassage() }]),
      )
    mockGetClient.mockReturnValue({ query })

    const hook = renderHook({
      slug: "the-beginning",
      citations: [citation("c1")],
    })
    await flush()
    expect(query).toHaveBeenCalledTimes(1)

    // The watch session republishes its citations at least twice per open.
    hook.rerender({ slug: "the-beginning", citations: [citation("c1")] })
    await flush()
    hook.rerender({ slug: "the-beginning", citations: [citation("c1")] })
    await flush()

    expect(query).toHaveBeenCalledTimes(1)
  })

  // Covers R16.
  it("reports the loading state with real references before the read settles", () => {
    mockGetClient.mockReturnValue({
      query: jest.fn(() => new Promise(() => {})),
    })

    const hook = renderHook({
      slug: "the-beginning",
      citations: [citation("c1"), citation("c2")],
    })

    const state = hook.latest()
    expect(state.loading).toBe(true)
    expect(verseCards(state)).toHaveLength(2)
    expect(verseCards(state)[0]).toMatchObject({
      reference: "Genesis 1:26-27",
      text: "",
      loading: true,
    })

    // Leaves the read pending on purpose; unmounting disarms its deadline.
    hook.unmount()
  })

  // Covers R11, R13.
  it("settles into reference-only cards when the read rejects", async () => {
    mockGetClient.mockReturnValue({
      query: jest.fn().mockRejectedValue(new Error("network down")),
    })

    const hook = renderHook({
      slug: "the-beginning",
      citations: [citation("c1")],
    })
    await flush()

    const state = hook.latest()
    expect(state.loading).toBe(false)
    expect(verseCards(state)[0]).toMatchObject({
      reference: "Genesis 1:26-27",
      text: "",
      passageUrl: null,
      loading: false,
    })
    expect(mockWarn).toHaveBeenCalledWith(
      "bible_passages.degraded",
      expect.objectContaining({ reason: "read_failed" }),
    )
  })

  it("settles the same way when the read exceeds the deadline", async () => {
    jest.useFakeTimers()
    mockGetClient.mockReturnValue({
      query: jest.fn(() => new Promise(() => {})),
    })

    const hook = renderHook({
      slug: "the-beginning",
      citations: [citation("c1")],
    })
    expect(hook.latest().loading).toBe(true)

    await act(async () => {
      jest.advanceTimersByTime(PASSAGE_FETCH_DEADLINE_MS)
      await Promise.resolve()
      await Promise.resolve()
    })

    const state = hook.latest()
    expect(state.loading).toBe(false)
    expect(verseCards(state)[0]).toMatchObject({ text: "", loading: false })
  })

  // Reads both values rather than restating either: a budget at or above the
  // client's own request ceiling is inert.
  it("keeps the deadline strictly below the client request ceiling", () => {
    expect(PASSAGE_FETCH_DEADLINE_MS).toBeLessThan(REQUEST_TIMEOUT_MS)
  })

  // Covers R10.
  it("renders a reference and no verse when admin resolved no passage", async () => {
    mockGetClient.mockReturnValue({
      query: jest
        .fn()
        .mockResolvedValue(response([{ documentId: "c1", passage: null }])),
    })

    const hook = renderHook({
      slug: "the-beginning",
      citations: [citation("c1")],
    })
    await flush()

    expect(verseCards(hook.latest())[0]).toMatchObject({
      reference: "Genesis 1:26-27",
      text: "",
      translation: null,
      copyright: null,
      passageUrl: null,
    })
    expect(mockInfo).toHaveBeenCalledWith(
      "bible_passages.degraded",
      expect.objectContaining({ reason: "no_passage" }),
    )
  })

  // An upstream change that starts suppressing verses must not look like
  // admin's designed no-passage outcome.
  it("warns with the missing field when a passage fails the gate", async () => {
    mockGetClient.mockReturnValue({
      query: jest
        .fn()
        .mockResolvedValue(
          response([
            { documentId: "c1", passage: rawPassage({ versionTitle: null }) },
          ]),
        ),
    })

    const hook = renderHook({
      slug: "the-beginning",
      citations: [citation("c1")],
    })
    await flush()

    expect(verseCards(hook.latest())[0]).toMatchObject({ text: "" })
    expect(mockWarn).toHaveBeenCalledWith(
      "bible_passages.degraded",
      expect.objectContaining({
        reason: "gate_rejected",
        missing_field: "versionTitle",
      }),
    )
  })

  it("joins passages to citations by documentId, not by order", async () => {
    mockGetClient.mockReturnValue({
      query: jest.fn().mockResolvedValue(
        response([
          {
            documentId: "c2",
            passage: rawPassage({
              content: "second verse",
              humanReference: "Genesis 3:22-24",
            }),
          },
          {
            documentId: "c1",
            passage: rawPassage({
              content: "first verse",
              humanReference: "Genesis 1:26-27",
            }),
          },
        ]),
      ),
    })

    const hook = renderHook({
      slug: "the-beginning",
      citations: [citation("c1"), citation("c2")],
    })
    await flush()

    const cards = verseCards(hook.latest())
    expect(cards[0]).toMatchObject({
      reference: "Genesis 1:26-27",
      text: "first verse",
    })
    expect(cards[1]).toMatchObject({
      reference: "Genesis 3:22-24",
      text: "second verse",
    })
  })

  it("discards a response for a superseded video", async () => {
    let resolveFirst!: (value: unknown) => void
    const query = jest
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve
          }),
      )
      .mockResolvedValue(response([{ documentId: "c9", passage: null }]))
    mockGetClient.mockReturnValue({ query })

    const hook = renderHook({
      slug: "the-beginning",
      citations: [citation("c1")],
    })
    hook.rerender({ slug: "other-video", citations: [citation("c9")] })
    await flush()

    // The first video's passage lands after the route already moved on.
    await act(async () => {
      resolveFirst(
        response([
          {
            documentId: "c1",
            passage: rawPassage({ content: "stale verse" }),
          },
        ]),
      )
      await Promise.resolve()
      await Promise.resolve()
    })

    const cards = verseCards(hook.latest())
    expect(cards).toHaveLength(1)
    expect(cards[0]?.text).toBe("")
    expect(JSON.stringify(cards)).not.toContain("stale verse")
  })

  it("clears prior passage state before the next video's read", async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce(
        response([
          {
            documentId: "c1",
            passage: rawPassage({ content: "first video verse" }),
          },
        ]),
      )
      .mockImplementation(() => new Promise(() => {}))
    mockGetClient.mockReturnValue({ query })

    const hook = renderHook({
      slug: "the-beginning",
      citations: [citation("c1")],
    })
    await flush()
    expect(verseCards(hook.latest())[0]?.text).toBe("first video verse")

    hook.rerender({ slug: "other-video", citations: [citation("c1")] })

    const state = hook.latest()
    expect(state.loading).toBe(true)
    expect(verseCards(state)[0]?.text).toBe("")

    // The second video's read stays pending; unmounting disarms its deadline.
    hook.unmount()
  })

  // A failed read is not cached, so without a cooldown every re-entry and every
  // next video repeats the request under the same stall that caused it.
  it("skips the network inside a failed video's cooldown window", async () => {
    const query = jest.fn().mockRejectedValue(new Error("network down"))
    mockGetClient.mockReturnValue({ query })

    const first = renderHook({
      slug: "the-beginning",
      citations: [citation("c1")],
    })
    await flush()
    expect(query).toHaveBeenCalledTimes(1)
    first.unmount()

    const second = renderHook({
      slug: "the-beginning",
      citations: [citation("c1")],
    })
    await flush()

    expect(query).toHaveBeenCalledTimes(1)
    expect(second.latest().loading).toBe(false)
    expect(verseCards(second.latest())[0]?.text).toBe("")
  })

  it("keeps the always-on promotional card on every path", async () => {
    mockGetClient.mockReturnValue({
      query: jest.fn().mockRejectedValue(new Error("network down")),
    })

    const hook = renderHook({
      slug: "the-beginning",
      citations: [citation("c1")],
    })
    await flush()

    const promo = hook.latest().cards.at(-1)
    expect(promo).toMatchObject({
      reference: "FREE RESOURCES",
      ctaLabel: "Join Our Bible Study",
      loading: false,
    })
  })
})
