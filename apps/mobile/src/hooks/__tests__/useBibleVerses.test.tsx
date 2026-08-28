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

import { StrictMode, act } from "react"
import type React from "react"

import { REQUEST_TIMEOUT_MS, getApolloClient } from "../../lib/apolloClient"
import { datadogLog } from "../../lib/datadog"
import type { WatchBibleCitation, WatchVariant } from "../../lib/normalizeVideo"
import { resetBiblePassageCooldownsForTests } from "../../lib/biblePassageCooldown"
import {
  ART_HOLD_RELEASE_MS,
  PASSAGE_FETCH_DEADLINE_MS,
  useBibleVerses,
  type BibleCardArtSource,
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

/**
 * Artwork inputs a passage-focused case does not care about. Deliberately the
 * bare-fallback shape — no dubs, no authored image, payload settled — so those
 * cases exercise the stock rung and nothing about them depends on a still.
 */
const NO_ART: BibleCardArtSource = {
  variants: [],
  authoredImageUrl: null,
  payloadSettled: true,
}

type HarnessProps = {
  slug: string
  citations: WatchBibleCitation[]
  art?: BibleCardArtSource
}

/**
 * `strict` defaults to true so remount safety is the suite's normal posture.
 *
 * Pass `strict: false` for a case that counts `client.query` CALLS. StrictMode
 * deliberately runs setup -> cleanup -> setup, so it doubles them; production
 * runs the effect once, and that single call is what R12's "exactly one
 * passage request" is about.
 */
function renderHook(initial: HarnessProps, options: { strict?: boolean } = {}) {
  const strict = options.strict ?? true
  const wrap = (element: React.ReactElement) =>
    strict
      ? ((<StrictMode>{element}</StrictMode>) as React.ReactElement)
      : element
  const seen: BibleQuotesState[] = []
  function Harness({ slug, citations, art }: HarnessProps) {
    seen.push(useBibleVerses(slug, citations, art ?? NO_ART))
    return null
  }
  let renderer!: TestInstance
  act(() => {
    renderer = TestRenderer.create(
      wrap(
        (<Harness {...initial} />) as React.ReactElement,
      ) as unknown as React.ReactElement,
    )
  })
  return {
    latest: () => seen[seen.length - 1]!,
    rerender: (next: HarnessProps) =>
      act(() => {
        renderer.update(
          wrap(
            (<Harness {...next} />) as React.ReactElement,
          ) as unknown as React.ReactElement,
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

    renderHook(
      {
        slug: "the-beginning",
        citations: ["c1", "c2", "c3", "c4", "c5"].map((id) => citation(id)),
      },
      { strict: false },
    )
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

    const hook = renderHook(
      { slug: "the-beginning", citations: [citation("c1")] },
      { strict: false },
    )
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

    const hook = renderHook(
      { slug: "the-beginning", citations: [citation("c1")] },
      { strict: false },
    )
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

    const first = renderHook(
      { slug: "the-beginning", citations: [citation("c1")] },
      { strict: false },
    )
    await flush()
    expect(query).toHaveBeenCalledTimes(1)
    first.unmount()

    const second = renderHook(
      { slug: "the-beginning", citations: [citation("c1")] },
      { strict: false },
    )
    await flush()

    expect(query).toHaveBeenCalledTimes(1)
    expect(second.latest().loading).toBe(false)
    expect(verseCards(second.latest())[0]?.text).toBe("")
  })

  // Suppress the NETWORK, not the cache: `withTimeout` abandons the wait but
  // cannot cancel the request, so a read that overran the deadline can still
  // land in the cache. The cooldown must not withhold what is already there.
  it("serves a cached passage while the cooldown window is open", async () => {
    const query = jest.fn().mockRejectedValue(new Error("network down"))
    const readQuery = jest.fn().mockReturnValue(
      response([
        {
          documentId: "c1",
          passage: rawPassage({ content: "cached verse" }),
        },
      ]).data,
    )
    mockGetClient.mockReturnValue({ query, readQuery })

    const first = renderHook(
      { slug: "the-beginning", citations: [citation("c1")] },
      { strict: false },
    )
    await flush()
    first.unmount()

    const second = renderHook(
      { slug: "the-beginning", citations: [citation("c1")] },
      { strict: false },
    )
    await flush()

    expect(query).toHaveBeenCalledTimes(1)
    expect(readQuery).toHaveBeenCalled()
    expect(verseCards(second.latest())[0]?.text).toBe("cached verse")
  })

  // A synchronous throw out of `query()` would skip withTimeout entirely and
  // leave the carousel shimmering with nothing left to settle it.
  it("degrades when the query throws synchronously", async () => {
    const query = jest.fn(() => {
      throw new Error("client not ready")
    })
    mockGetClient.mockReturnValue({ query })

    const hook = renderHook(
      { slug: "the-beginning", citations: [citation("c1")] },
      { strict: false },
    )
    await flush()

    expect(hook.latest().loading).toBe(false)
    expect(verseCards(hook.latest())[0]?.text).toBe("")
    expect(mockWarn).toHaveBeenCalledWith(
      "bible_passages.degraded",
      expect.objectContaining({ reason: "read_failed" }),
    )
  })

  // StrictMode's setup -> cleanup -> setup cycle must leave the hook armed: the
  // cleanup bumps the request id and aborts the controller, so a setup that did
  // not mint fresh ones would discard its own response forever.
  it("re-arms after a StrictMode remount and still settles", async () => {
    mockGetClient.mockReturnValue({
      query: jest
        .fn()
        .mockResolvedValue(
          response([{ documentId: "c1", passage: rawPassage() }]),
        ),
    })

    const hook = renderHook({
      slug: "the-beginning",
      citations: [citation("c1")],
    })
    await flush()

    expect(hook.latest().loading).toBe(false)
    expect(verseCards(hook.latest())[0]?.text).toContain("Let’s make man")
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

// ── Card artwork ────────────────────────────────────────────────────────────

/** Every gated field written out, for the same reason `citation` writes its own. */
function variant(overrides: Partial<WatchVariant> = {}): WatchVariant {
  return {
    documentId: "dub-a",
    slug: "en",
    published: true,
    hls: null,
    duration: 1000,
    languageCoreId: null,
    languageBcp47: null,
    languageSlug: null,
    languageName: null,
    languageNameNative: null,
    muxPlaybackId: "playbackA",
    ...overrides,
  }
}

const WITH_STILLS: BibleCardArtSource = {
  variants: [variant()],
  authoredImageUrl: null,
  payloadSettled: true,
}

/** The lean series fragment's shape: a dub with neither runtime nor playback id. */
const PARTIAL_PAYLOAD: BibleCardArtSource = {
  variants: [variant({ duration: null, muxPlaybackId: null, hls: null })],
  authoredImageUrl: null,
  payloadSettled: false,
}

const artLogs = () =>
  mockInfo.mock.calls.filter(
    (call) => call[0] === "bible_card_art.resolved",
  ) as unknown[][]

function quietPassageRead() {
  mockGetClient.mockReturnValue({
    query: jest.fn().mockResolvedValue(response([])),
  })
}

describe("useBibleVerses card artwork", () => {
  beforeEach(quietPassageRead)

  it("gives each citation its own still from the video (AE1)", async () => {
    const hook = renderHook({
      slug: "pilgrims-progress",
      citations: ["c1", "c2", "c3"].map((id, i) => citation(id, { order: i })),
      art: WITH_STILLS,
    })
    await flush()

    const images = verseCards(hook.latest()).map((card) => card.imageUrl)
    expect(images).toHaveLength(3)
    expect(
      images.every((url) => url?.startsWith("https://image.mux.com/")),
    ).toBe(true)
    expect(new Set(images).size).toBe(3)
  })

  it("leaves the promotional card's image byte-identical and out of the ladder", async () => {
    const hook = renderHook({
      slug: "pilgrims-progress",
      citations: [citation("c1")],
      art: WITH_STILLS,
    })
    await flush()

    const promo = hook.latest().cards.at(-1)!
    expect(promo.imageUrl).toBe(
      "https://images.unsplash.com/photo-1650658720644-e1588bd66de3?w=900&auto=format&fit=crop&q=60",
    )
    // Nothing to advance to: the ladder cannot reach this card at all.
    expect(promo.artCandidates).toEqual([])
  })

  it("keeps every card's artwork when the passage read settles (AE12)", async () => {
    const query = jest
      .fn()
      .mockResolvedValue(
        response([{ documentId: "c1", passage: rawPassage() }]),
      )
    mockGetClient.mockReturnValue({ query })

    const hook = renderHook({
      slug: "pilgrims-progress",
      citations: [citation("c1")],
      art: WITH_STILLS,
    })
    const beforeSettle = verseCards(hook.latest())[0]?.imageUrl
    expect(beforeSettle).toBeTruthy()

    await flush()

    // The reference label changed — the passage supplies its own — and the
    // artwork did not.
    expect(verseCards(hook.latest())[0]?.reference).toBe("Genesis 1:26-27")
    expect(verseCards(hook.latest())[0]?.imageUrl).toBe(beforeSettle)
  })

  it("requests no still for a video with no citations", async () => {
    const hook = renderHook({
      slug: "pilgrims-progress",
      citations: [],
      art: WITH_STILLS,
    })
    await flush()

    expect(hook.latest().cards).toHaveLength(1)
    expect(hook.latest().cards[0]?.reference).toBe("FREE RESOURCES")
  })

  it("does not move a card's artwork when the viewer switches dub (AE3)", async () => {
    // The pin reads neither the active dub nor the array's order, so adding
    // the German dub the viewer just selected changes nothing.
    const english = variant({ documentId: "dub-a", muxPlaybackId: "playbackA" })
    const german = variant({ documentId: "dub-b", muxPlaybackId: "playbackB" })

    const hook = renderHook({
      slug: "pilgrims-progress",
      citations: [citation("c1")],
      art: { ...WITH_STILLS, variants: [english] },
    })
    await flush()
    const before = verseCards(hook.latest())[0]?.imageUrl

    hook.rerender({
      slug: "pilgrims-progress",
      citations: [citation("c1")],
      art: { ...WITH_STILLS, variants: [german, english] },
    })
    await flush()

    expect(verseCards(hook.latest())[0]?.imageUrl).toBe(before)
  })

  it("still reaches the stock set as the ladder's last rung", async () => {
    const hook = renderHook({
      slug: "pilgrims-progress",
      citations: [citation("c1")],
      art: NO_ART,
    })
    await flush()

    expect(verseCards(hook.latest())[0]?.imageUrl).toBe(
      "https://images.unsplash.com/photo-1480869799327-03916a613b29?q=80&w=800&auto=format&fit=crop",
    )
  })

  it("paints nothing while the payload is partial, then fills in (AE12)", async () => {
    const hook = renderHook({
      slug: "pilgrims-progress",
      citations: [citation("c1")],
      art: PARTIAL_PAYLOAD,
    })
    await flush()

    // Held at the card's own background colour rather than painting stock and
    // flipping when the real dub arrives.
    expect(verseCards(hook.latest())[0]?.imageUrl).toBeNull()
    expect(verseCards(hook.latest())[0]?.artCandidates).toEqual([])

    hook.rerender({
      slug: "pilgrims-progress",
      citations: [citation("c1")],
      art: WITH_STILLS,
    })
    await flush()

    expect(verseCards(hook.latest())[0]?.imageUrl).toContain(
      "https://image.mux.com/playbackA/",
    )
  })

  it("releases the hold on its own when the payload never settles", async () => {
    jest.useFakeTimers()
    const hook = renderHook(
      {
        slug: "pilgrims-progress",
        citations: [citation("c1")],
        art: PARTIAL_PAYLOAD,
      },
      { strict: false },
    )
    expect(verseCards(hook.latest())[0]?.imageUrl).toBeNull()

    act(() => {
      jest.advanceTimersByTime(ART_HOLD_RELEASE_MS)
    })

    // A payload that never settles must not strand every card at its
    // background colour for the whole session.
    expect(verseCards(hook.latest())[0]?.imageUrl).toContain("unsplash.com")
  })

  it("keeps a failed card advanced across a re-render (KTD13)", async () => {
    const hook = renderHook({
      slug: "pilgrims-progress",
      citations: [citation("c1")],
      art: { ...WITH_STILLS, authoredImageUrl: null },
    })
    await flush()

    const card = verseCards(hook.latest())[0]!
    expect(card.imageUrl).toContain("image.mux.com")

    act(() => hook.latest().reportArtworkFailure(0, card.artIndex))

    const advanced = verseCards(hook.latest())[0]!
    expect(advanced.imageUrl).toContain("unsplash.com")

    // The index lives in the hook, not the cell, so a card that unmounts and
    // remounts does not re-request the URL that just failed.
    hook.rerender({
      slug: "pilgrims-progress",
      citations: [citation("c1")],
      art: { ...WITH_STILLS, authoredImageUrl: null },
    })
    expect(verseCards(hook.latest())[0]?.imageUrl).toContain("unsplash.com")
  })

  it("ignores a failure reported against a candidate no longer on screen", async () => {
    const hook = renderHook({
      slug: "pilgrims-progress",
      citations: [citation("c1")],
      art: { ...WITH_STILLS, authoredImageUrl: null },
    })
    await flush()

    // expo-image can report the same source twice; a duplicate must not skip
    // a whole rung.
    act(() => hook.latest().reportArtworkFailure(0, 0))
    act(() => hook.latest().reportArtworkFailure(0, 0))

    expect(verseCards(hook.latest())[0]?.imageUrl).toContain("unsplash.com")
  })

  it("leaves the card bare once every rung has failed", async () => {
    const hook = renderHook({
      slug: "pilgrims-progress",
      citations: [citation("c1")],
      art: NO_ART,
    })
    await flush()

    act(() => hook.latest().reportArtworkFailure(0, 0))
    expect(verseCards(hook.latest())[0]?.imageUrl).toBeNull()

    // Exhausted, not looping: another report cannot wrap back to rung zero.
    act(() => hook.latest().reportArtworkFailure(0, 1))
    expect(verseCards(hook.latest())[0]?.imageUrl).toBeNull()
  })

  it("emits exactly one ladder-outcome log per video per screen open", async () => {
    const hook = renderHook({
      slug: "pilgrims-progress",
      citations: [citation("c1")],
      art: WITH_STILLS,
    })
    await flush()
    hook.rerender({
      slug: "pilgrims-progress",
      citations: [citation("c1")],
      art: WITH_STILLS,
    })
    await flush()

    expect(artLogs()).toHaveLength(1)
    expect(artLogs()[0]?.[1]).toMatchObject({
      tier: "still",
      slug: "pilgrims-progress",
      citation_count: 1,
      has_playback_id: true,
    })
  })

  it("emits no ladder-outcome log while the payload is unsettled", async () => {
    renderHook({
      slug: "pilgrims-progress",
      citations: [citation("c1")],
      art: PARTIAL_PAYLOAD,
    })
    await flush()

    // A held card has not resolved a tier yet, so logging one would report an
    // outcome that never happened.
    expect(artLogs()).toHaveLength(0)
  })

  it("reports the stock outcome on a video that carries a playback id", async () => {
    // The alertable population: a video that CAN serve a still but did not.
    renderHook({
      slug: "pilgrims-progress",
      citations: [citation("c1")],
      art: {
        variants: [variant({ duration: null })],
        authoredImageUrl: null,
        payloadSettled: true,
      },
    })
    await flush()

    expect(artLogs()[0]?.[1]).toMatchObject({
      tier: "stock",
      has_playback_id: true,
    })
  })
})
