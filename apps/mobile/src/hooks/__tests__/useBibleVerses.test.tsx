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
// The card quote module has its own suite (cardQuote.test.ts); here a fake
// answers, so each case controls which card is local and when it settles.
jest.mock("../../lib/bible/quotes/cardQuote", () => ({
  ...jest.requireActual("../../lib/bible/quotes/cardQuote"),
  resolveCardQuotes: jest.fn(),
}))
jest.mock("../../lib/bible/quotes/services", () => ({
  getCardQuoteServices: () => mockQuoteServices,
}))

import { StrictMode, act } from "react"
import type React from "react"

import {
  ENGLISH_ADMIN_FORMS,
  adminFormsFor,
  type AdminLanguageForms,
} from "../../i18n/adminLanguage"
import { REQUEST_TIMEOUT_MS, getApolloClient } from "../../lib/apolloClient"
import {
  cardQuoteKey,
  resolveCardQuotes,
  type CardCitation,
  type CardQuote,
  type CardQuoteInput,
  type CardQuoteResult,
  type CardQuoteServices,
} from "../../lib/bible/quotes/cardQuote"
import { datadogLog } from "../../lib/datadog"
import type { WatchBibleCitation, WatchVariant } from "../../lib/normalizeVideo"
import { resetBiblePassageCooldownsForTests } from "../../lib/biblePassageCooldown"
import {
  ART_HOLD_RELEASE_MS,
  PASSAGE_FETCH_DEADLINE_MS,
  useBibleVerses,
  type BibleCardArtSource,
  type BibleQuotesState,
  type ReaderTranslationInputs,
} from "../useBibleVerses"
import {
  TestRenderer,
  type TestInstance,
} from "../../test-utils/rnTestRenderer"

const mockGetClient = getApolloClient as jest.Mock
const mockInfo = datadogLog.info as jest.Mock
const mockWarn = datadogLog.warn as jest.Mock
const mockResolveCardQuotes = resolveCardQuotes as jest.MockedFunction<
  typeof resolveCardQuotes
>

// The reading position store, as far as the hook reads it: the viewer's pick.
let mockPick = { translationId: null as string | null }
const pickListeners = new Set<() => void>()
const mockQuoteServices = {
  positionStore: {
    subscribe: (listener: () => void) => {
      pickListeners.add(listener)
      return () => {
        pickListeners.delete(listener)
      }
    },
    getSnapshot: () => ({
      ref: null,
      translationId: mockPick.translationId,
      sessionTranslationId: null,
      status: "ready",
    }),
    hydrate: async () => "reached",
  },
} as unknown as CardQuoteServices

/** One result per citation, keyed as the module keys them. */
function quoteResults(
  input: CardQuoteInput,
  resultFor: (citation: CardCitation) => CardQuoteResult,
): ReadonlyMap<string, CardQuoteResult> {
  return new Map(
    input.citations.map((cited) => [cardQuoteKey(cited), resultFor(cited)]),
  )
}

/** Today's default: the reader translation is BSB, so admin's card stays. */
function englishReader(input: CardQuoteInput) {
  return quoteResults(input, (cited) =>
    cited.bookUsfm == null
      ? { status: "pending" }
      : { status: "admin", translationId: "BSB" },
  )
}

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
    bookUsfm: "GEN",
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
    englishPassage?: Record<string, unknown> | null
  }>,
) {
  return {
    data: {
      videoBySlug: {
        documentId: "video-1",
        bibleCitations: entries.map((entry) => ({
          documentId: entry.documentId,
          passage: entry.passage,
          ...(entry.englishPassage === undefined
            ? {}
            : { englishPassage: entry.englishPassage }),
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
  primaryLanguageCoreId: null,
  payloadSettled: true,
}

/** A focused screen whose dub preference is read and names no language. */
const READER_DEFAULTS: ReaderTranslationInputs = {
  audioLanguage: null,
  audioReady: true,
  focused: true,
}

type HarnessProps = {
  slug: string
  citations: WatchBibleCitation[]
  art?: BibleCardArtSource
  /** The route's captured forms (KTD16). English when a case omits them. */
  forms?: AdminLanguageForms
  /** The reader translation's inputs (KTD3, KTD11). */
  reader?: ReaderTranslationInputs
}

/**
 * `strict` defaults to true so remount safety is the suite's normal posture.
 *
 * Pass `strict: false` for a case that counts `client.query` CALLS. StrictMode
 * deliberately runs setup -> cleanup -> setup, so it doubles them; production
 * runs the effect once, and that single call is what R12's "exactly one
 * passage request" is about.
 */
const mounted: TestInstance[] = []

function renderHook(initial: HarnessProps, options: { strict?: boolean } = {}) {
  const strict = options.strict ?? true
  const wrap = (element: React.ReactElement) =>
    strict
      ? ((<StrictMode>{element}</StrictMode>) as React.ReactElement)
      : element
  const seen: BibleQuotesState[] = []
  function Harness({ slug, citations, art, forms, reader }: HarnessProps) {
    seen.push(
      useBibleVerses(
        slug,
        citations,
        art ?? NO_ART,
        forms ?? ENGLISH_ADMIN_FORMS,
        reader ?? READER_DEFAULTS,
      ),
    )
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
  // The hook arms the artwork hold's release timer on mount. A renderer left
  // standing keeps that timer alive past the test that created it.
  mounted.push(renderer)
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

// Enough turns for the passage read AND the card quote run, which waits on it.
const flush = async () => {
  await act(async () => {
    for (let turn = 0; turn < 12; turn += 1) await Promise.resolve()
  })
}

/** Citation cards only — the always-on promo card is not passage-backed. */
function verseCards(state: BibleQuotesState) {
  return state.cards.slice(0, -1)
}

beforeEach(() => {
  jest.clearAllMocks()
  resetBiblePassageCooldownsForTests()
  mockPick = { translationId: null }
  mockResolveCardQuotes.mockImplementation(async (_services, input) =>
    englishReader(input),
  )
})

afterEach(() => {
  act(() => {
    mounted.splice(0).forEach((renderer) => renderer.unmount())
  })
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
      variables: {
        slug: "the-beginning",
        textSlug: "english",
        isEnglish: true,
      },
      fetchPolicy: "cache-first",
    })
  })

  // ── U7: the passage in the route's language (R9, R10, KTD16) ────────────

  describe("the passage language", () => {
    const RU = adminFormsFor("ru")
    const ES = adminFormsFor("es")
    type PassageEntry = {
      passage: Record<string, unknown> | null
      englishPassage?: Record<string, unknown> | null
    }

    it("asks by the route's captured slug, not the store's", async () => {
      const query = jest.fn().mockResolvedValue(response([]))
      mockGetClient.mockReturnValue({ query })
      renderHook(
        { slug: "the-beginning", citations: [citation("c1")], forms: ES },
        { strict: false },
      )
      await flush()
      expect(query.mock.calls[0][0].variables).toEqual({
        slug: "the-beginning",
        textSlug: "spanish-latin-american",
        isEnglish: false,
      })
    })

    it.each<
      [string, AdminLanguageForms, PassageEntry, Record<string, unknown>]
    >([
      [
        "shows the UI slug's passage, marked in the UI language",
        ES,
        {
          passage: rawPassage({ content: "Y dijo Dios", versionId: 147 }),
          englishPassage: rawPassage({ versionId: 3034 }),
        },
        { text: "Y dijo Dios", textLang: "es" },
      ],
      [
        "keeps the English passage, marked en, when Admin has none for the slug",
        RU,
        { passage: null, englishPassage: rawPassage({ content: "God said" }) },
        { text: "God said", textLang: "en" },
      ],
      [
        // Admin answers an unmapped slug with its English launch version, so
        // the same version id as the English passage means the text is English.
        "marks a passage en when Admin answered the slug with the English version",
        RU,
        {
          passage: rawPassage({ content: "God said", versionId: 3034 }),
          englishPassage: rawPassage({ content: "God said", versionId: 3034 }),
        },
        { textLang: "en" },
      ],
      [
        "marks an English UI's passage en",
        ENGLISH_ADMIN_FORMS,
        { passage: rawPassage() },
        { textLang: "en" },
      ],
      [
        "gives no language to a card with no passage",
        RU,
        { passage: null, englishPassage: null },
        { text: "", textLang: null },
      ],
    ])("%s", async (_name, forms, entry, card) => {
      const query = jest
        .fn()
        .mockResolvedValue(response([{ documentId: "c1", ...entry }]))
      mockGetClient.mockReturnValue({ query })
      const hook = renderHook({
        slug: "the-beginning",
        citations: [citation("c1")],
        forms,
      })
      await flush()
      expect(verseCards(hook.latest())[0]).toMatchObject(card)
    })

    it("asks again when the route's slug changes to another language", async () => {
      const query = jest.fn().mockResolvedValue(response([]))
      mockGetClient.mockReturnValue({ query })
      const hook = renderHook(
        { slug: "the-beginning", citations: [citation("c1")] },
        { strict: false },
      )
      await flush()
      hook.rerender({
        slug: "the-beginning",
        citations: [citation("c1")],
        forms: RU,
      })
      await flush()
      expect(
        query.mock.calls.map(
          ([options]: [{ variables: { textSlug: string } }]) =>
            options.variables.textSlug,
        ),
      ).toEqual(["english", "russian"])
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
    })
    expect(mockInfo).toHaveBeenCalledWith(
      "bible_passages.degraded",
      expect.objectContaining({ reason: "no_passage" }),
    )
  })

  // An upstream change that starts suppressing verses must not look like
  // admin's designed no-passage outcome.
  it.each<[string, AdminLanguageForms, Record<string, unknown>, string]>([
    [
      "a passage",
      ENGLISH_ADMIN_FORMS,
      { passage: rawPassage({ versionTitle: null }) },
      "versionTitle",
    ],
    [
      "the English fallback passage",
      adminFormsFor("ru"),
      { passage: null, englishPassage: rawPassage({ copyright: null }) },
      "copyright",
    ],
  ])(
    "warns with the missing field when %s fails the gate",
    async (_, forms, entry, field) => {
      mockGetClient.mockReturnValue({
        query: jest
          .fn()
          .mockResolvedValue(
            response([{ documentId: "c1", passage: null, ...entry }]),
          ),
      })

      const hook = renderHook({
        slug: "the-beginning",
        citations: [citation("c1")],
        forms,
      })
      await flush()

      expect(verseCards(hook.latest())[0]).toMatchObject({ text: "" })
      expect(mockWarn).toHaveBeenCalledWith(
        "bible_passages.degraded",
        expect.objectContaining({
          reason: "gate_rejected",
          missing_field: field,
        }),
      )
    },
  )

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
    languageIso3: null,
    muxPlaybackId: "playbackA",
    ...overrides,
  }
}

const WITH_STILLS: BibleCardArtSource = {
  variants: [variant()],
  authoredImageUrl: null,
  primaryLanguageCoreId: null,
  payloadSettled: true,
}

/** The lean series fragment's shape: a dub with neither runtime nor playback id. */
const PARTIAL_PAYLOAD: BibleCardArtSource = {
  variants: [variant({ duration: null, muxPlaybackId: null, hls: null })],
  authoredImageUrl: null,
  primaryLanguageCoreId: null,
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
    await flush()
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

    act(() => hook.latest().reportArtworkFailure(0, card.imageUrl!))

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

  it("still tries a still that only arrives after a stock failure", async () => {
    // The cascade: hold releases onto stock, stock fails, and only THEN does
    // the payload land. A failure recorded by POSITION would make the newly
    // prepended still look already tried, skipping the one image this is for.
    jest.useFakeTimers()
    const hook = renderHook(
      {
        slug: "pilgrims-progress",
        citations: [citation("c1")],
        art: PARTIAL_PAYLOAD,
      },
      { strict: false },
    )
    await flush()
    expect(verseCards(hook.latest())[0]?.imageUrl).toBeNull()

    act(() => {
      jest.advanceTimersByTime(ART_HOLD_RELEASE_MS)
    })
    const stock = verseCards(hook.latest())[0]!.imageUrl!
    expect(stock).toContain("unsplash.com")

    act(() => hook.latest().reportArtworkFailure(0, stock))

    hook.rerender({
      slug: "pilgrims-progress",
      citations: [citation("c1")],
      art: WITH_STILLS,
    })

    expect(verseCards(hook.latest())[0]?.imageUrl).toContain("image.mux.com")
  })

  it("scopes a recorded failure to its own video, not the next one", async () => {
    // Up Next reuses the screen, so this hook outlives the video whose failures
    // it recorded; the slug in each key keeps them apart. Does NOT observe the
    // slug effect's reset — that is hygiene, and removing it leaves this green.
    const hook = renderHook({
      slug: "pilgrims-progress",
      citations: [citation("c1")],
      art: { ...WITH_STILLS, authoredImageUrl: null },
    })
    await flush()
    const still = verseCards(hook.latest())[0]!.imageUrl!
    act(() => hook.latest().reportArtworkFailure(0, still))
    expect(verseCards(hook.latest())[0]?.imageUrl).toContain("unsplash.com")

    hook.rerender({
      slug: "the-beginning",
      citations: [citation("c1")],
      art: { ...WITH_STILLS, authoredImageUrl: null },
    })
    await flush()

    // The new video starts at the top of the ladder, not one rung down.
    expect(verseCards(hook.latest())[0]?.imageUrl).toContain("image.mux.com")
  })

  it("scopes a recorded failure to the card that reported it", async () => {
    // With no still, KTD8 gives EVERY card the same authored URL, so the key's
    // cardIndex is the only thing keeping one card's failure off its siblings.
    // Drop cardIndex from the key and card 1 skips a rung it never tried.
    const authored = "https://images.example.com/authored.jpg"
    const hook = renderHook({
      slug: "pilgrims-progress",
      citations: [citation("c1"), citation("c2")],
      art: {
        ...PARTIAL_PAYLOAD,
        authoredImageUrl: authored,
        payloadSettled: true,
      },
    })
    await flush()

    const cards = verseCards(hook.latest())
    expect(cards[0]?.imageUrl).toBe(authored)
    expect(cards[1]?.imageUrl).toBe(authored)

    act(() => hook.latest().reportArtworkFailure(0, authored))

    const after = verseCards(hook.latest())
    expect(after[0]?.imageUrl).toContain("unsplash.com")
    expect(after[1]?.imageUrl).toBe(authored)
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
    const still = verseCards(hook.latest())[0]!.imageUrl!
    act(() => hook.latest().reportArtworkFailure(0, still))
    act(() => hook.latest().reportArtworkFailure(0, still))

    expect(verseCards(hook.latest())[0]?.imageUrl).toContain("unsplash.com")
  })

  it("leaves the card bare once every rung has failed", async () => {
    const hook = renderHook({
      slug: "pilgrims-progress",
      citations: [citation("c1")],
      art: NO_ART,
    })
    await flush()

    const stock = verseCards(hook.latest())[0]!.imageUrl!
    act(() => hook.latest().reportArtworkFailure(0, stock))
    expect(verseCards(hook.latest())[0]?.imageUrl).toBeNull()

    // Exhausted, not looping: another report cannot wrap back to rung zero.
    act(() => hook.latest().reportArtworkFailure(0, stock))
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

  it("does not log a stock outcome for a video the payload later serves", async () => {
    // The hold's timed release resolves the ladder to stock so the card is not
    // stranded. Logging THAT would report a stock outcome for a video that
    // ends on a still — a false positive for the one alert this metric feeds.
    jest.useFakeTimers()
    const hook = renderHook(
      {
        slug: "pilgrims-progress",
        citations: [citation("c1")],
        art: PARTIAL_PAYLOAD,
      },
      { strict: false },
    )
    await flush()

    act(() => {
      jest.advanceTimersByTime(ART_HOLD_RELEASE_MS)
    })
    expect(verseCards(hook.latest())[0]?.imageUrl).toContain("unsplash.com")
    expect(artLogs()).toHaveLength(0)

    hook.rerender({
      slug: "pilgrims-progress",
      citations: [citation("c1")],
      art: WITH_STILLS,
    })

    expect(artLogs()).toHaveLength(1)
    expect(artLogs()[0]?.[1]).toMatchObject({ tier: "still" })
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
        primaryLanguageCoreId: null,
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

// ── Reader start (feat-553 U12, KTD17) ───────────────────────────────────────

describe("useBibleVerses reader start", () => {
  beforeEach(quietPassageRead)

  /** Every field written out, so no sibling field can steer the branch. */
  function johnCitation(
    overrides: Partial<WatchBibleCitation> = {},
  ): WatchBibleCitation {
    return {
      documentId: "c1",
      osisId: "John.3.16-John.3.17",
      bookName: "John",
      bookUsfm: "JHN",
      chapterStart: 3,
      chapterEnd: null,
      verseStart: 16,
      verseEnd: 17,
      order: 0,
      ...overrides,
    }
  }

  async function startFor(citationRow: WatchBibleCitation) {
    const hook = renderHook({ slug: "jesus", citations: [citationRow] })
    await flush()
    return verseCards(hook.latest())[0]?.citationStart
  }

  // Covers AE1 (the card half): the reader opens at the FIRST cited verse.
  it("opens John 3:16-17 at John 3:16", async () => {
    expect(await startFor(johnCitation())).toEqual({
      book: "JHN",
      chapter: 3,
      verse: 16,
    })
  })

  // Covers AE11 (the card half). The card passes BSB numbering; the reader
  // converts it to the translation's own numbering (Synodal Psalm 22:1).
  it("passes Psalm 23:1 in BSB numbering", async () => {
    expect(
      await startFor(
        johnCitation({
          osisId: "Ps.23.1",
          bookName: "Psalms",
          bookUsfm: "PSA",
          chapterStart: 23,
          verseStart: 1,
          verseEnd: null,
        }),
      ),
    ).toEqual({ book: "PSA", chapter: 23, verse: 1 })
  })

  // R1: a citation with no verse opens verse 1.
  it("opens verse 1 for a whole-chapter citation", async () => {
    expect(
      await startFor(johnCitation({ verseStart: null, verseEnd: null })),
    ).toEqual({ book: "JHN", chapter: 3, verse: 1 })
  })

  // A verse BSB does not have would make the reader open the saved position.
  it("opens verse 1 of the chapter for a verse BSB does not have", async () => {
    expect(await startFor(johnCitation({ verseStart: 99 }))).toEqual({
      book: "JHN",
      chapter: 3,
      verse: 1,
    })
  })

  it("gives no start for a citation with no book", async () => {
    expect(await startFor(johnCitation({ bookUsfm: null }))).toBeNull()
  })

  it("gives no start for a citation with no chapter", async () => {
    expect(await startFor(johnCitation({ chapterStart: null }))).toBeNull()
  })

  // John has 21 chapters.
  it("gives no start for a chapter BSB does not have", async () => {
    expect(await startFor(johnCitation({ chapterStart: 22 }))).toBeNull()
  })

  // R1: the button does not depend on admin's text.
  it("keeps the start when admin resolved no passage", async () => {
    mockGetClient.mockReturnValue({
      query: jest
        .fn()
        .mockResolvedValue(response([{ documentId: "c1", passage: null }])),
    })
    const hook = renderHook({ slug: "jesus", citations: [johnCitation()] })
    await flush()

    const card = verseCards(hook.latest())[0]
    expect(card?.text).toBe("")
    expect(card?.citationStart).toEqual({ book: "JHN", chapter: 3, verse: 16 })
  })

  // The scope boundary: the card keeps admin's own resolved text.
  it("leaves the card's admin-resolved text unchanged", async () => {
    mockGetClient.mockReturnValue({
      query: jest.fn().mockResolvedValue(
        response([
          {
            documentId: "c1",
            passage: rawPassage({
              content: "For God so loved the world…",
              humanReference: "John 3:16-17",
              versionTitle: "Berean Standard Bible",
            }),
          },
        ]),
      ),
    })
    const hook = renderHook({ slug: "jesus", citations: [johnCitation()] })
    await flush()

    expect(verseCards(hook.latest())[0]).toMatchObject({
      reference: "John 3:16-17",
      text: "For God so loved the world…",
      translation: "Berean Standard Bible",
      citationStart: { book: "JHN", chapter: 3, verse: 16 },
    })
  })

  it("gives the promotional card no start", async () => {
    const hook = renderHook({ slug: "jesus", citations: [johnCitation()] })
    await flush()
    expect(hook.latest().cards.at(-1)?.citationStart).toBeNull()
  })
})

// ── Plan 2026-10-08 U4: cards from the reader's translation ───────────────

describe("useBibleVerses reader-translation cards", () => {
  const KO = adminFormsFor("ko")
  const ES = adminFormsFor("es")

  /** Every field written out, so no sibling field can steer the branch. */
  function cited(
    documentId: string,
    overrides: Partial<WatchBibleCitation> = {},
  ): WatchBibleCitation {
    return {
      documentId,
      osisId: "John.3.16",
      bookName: "John",
      bookUsfm: "JHN",
      chapterStart: 3,
      chapterEnd: null,
      verseStart: 16,
      verseEnd: null,
      order: 0,
      ...overrides,
    }
  }

  const GENESIS = {
    osisId: "Gen.1.1",
    bookUsfm: "GEN",
    chapterStart: 1,
    verseStart: 1,
  } as const

  const KOREAN_JOHN: CardQuote = {
    text: "하나님이 세상을 이처럼 사랑하사 독생자를 주셨으니",
    reference: {
      bookName: "요한복음",
      chapterStart: 3,
      chapterEnd: null,
      verseStart: 16,
      verseEnd: null,
    },
    translationName: "한국어 성경",
    credit: "public domain",
    textDirection: "ltr",
    languageTag: "ko",
  }
  const KOREAN_GENESIS: CardQuote = {
    ...KOREAN_JOHN,
    text: "태초에 하나님이 천지를 창조하시니라",
    reference: {
      ...KOREAN_JOHN.reference,
      bookName: "창세기",
      chapterStart: 1,
    },
  }
  const RUSSIAN_JOHN: CardQuote = {
    ...KOREAN_JOHN,
    text: "Ибо так возлюбил Бог мир",
    reference: { ...KOREAN_JOHN.reference, bookName: "От Иоанна" },
    translationName: "Синодальный перевод",
    languageTag: "ru",
  }

  /** Admin answers every citation with its English fallback (version 3034). */
  function englishGaps(ids: readonly string[]) {
    return jest.fn().mockResolvedValue(
      response(
        ids.map((documentId) => ({
          documentId,
          passage: rawPassage({ content: "English text", versionId: 3034 }),
          englishPassage: rawPassage({
            content: "English text",
            versionId: 3034,
          }),
        })),
      ),
    )
  }

  function local(translationId: string, quote: CardQuote): CardQuoteResult {
    return { status: "local", translationId, quote }
  }

  function deferred<T>() {
    let resolve: (value: T) => void = () => {}
    const promise = new Promise<T>((settle) => {
      resolve = settle
    })
    return { promise, resolve }
  }

  const networkCalls = () =>
    mockResolveCardQuotes.mock.calls.filter(
      ([, input]) => input.reach === "network",
    )

  // Covers AE1.
  it("shows the reader's Korean verse where admin would show English", async () => {
    mockGetClient.mockReturnValue({ query: englishGaps(["c1"]) })
    mockResolveCardQuotes.mockImplementation(async (_services, input) =>
      quoteResults(input, () =>
        input.reach === "network"
          ? local("kor_old", KOREAN_JOHN)
          : { status: "network", translationId: "kor_old" },
      ),
    )

    const hook = renderHook({
      slug: "jesus",
      citations: [cited("c1")],
      forms: KO,
    })
    await flush()

    expect(verseCards(hook.latest())[0]).toEqual(
      expect.objectContaining({
        reference: "요한복음 3:16",
        text: KOREAN_JOHN.text,
        translation: "한국어 성경",
        copyright: "public domain",
        textLang: "ko",
        verseDirection: "ltr",
        verseLang: "ko",
        citationStart: { book: "JHN", chapter: 3, verse: 16 },
        loading: false,
      }),
    )
    expect(hook.latest().loading).toBe(false)
  })

  it("logs one settle with the count of local cards (KTD10)", async () => {
    mockGetClient.mockReturnValue({ query: englishGaps(["c1", "c2"]) })
    mockResolveCardQuotes.mockImplementation(async (_services, input) =>
      quoteResults(input, (citation) =>
        citation.documentId === "c1"
          ? local("kor_old", KOREAN_JOHN)
          : {
              status: "fallback",
              translationId: "kor_old",
              reason: "no-verse",
            },
      ),
    )

    renderHook(
      {
        slug: "jesus",
        citations: [cited("c1"), cited("c2", { verseStart: 17 })],
        forms: KO,
      },
      { strict: false },
    )
    await flush()

    const settles = mockInfo.mock.calls.filter(
      ([event]) => event === "bible_quotes.reader_translation",
    )
    expect(settles).toEqual([
      [
        "bible_quotes.reader_translation",
        expect.objectContaining({
          slug: "jesus",
          card_count: 2,
          local_count: 1,
          admin_count: 0,
          fallback_no_verse: 1,
          fallback_timeout: 0,
        }),
      ],
    ])
  })

  // Covers AE2.
  it("keeps admin's Spanish passage and starts no network read", async () => {
    mockGetClient.mockReturnValue({
      query: jest.fn().mockResolvedValue(
        response([
          {
            documentId: "c1",
            passage: rawPassage({ content: "Y dijo Dios", versionId: 147 }),
            englishPassage: rawPassage({ versionId: 3034 }),
          },
        ]),
      ),
    })
    mockResolveCardQuotes.mockImplementation(async (_services, input) =>
      quoteResults(input, () => ({
        status: "network",
        translationId: "spa_bes",
      })),
    )

    const hook = renderHook({
      slug: "jesus",
      citations: [cited("c1")],
      forms: ES,
    })
    await flush()

    expect(verseCards(hook.latest())[0]).toMatchObject({
      text: "Y dijo Dios",
      textLang: "es",
      verseDirection: null,
      loading: false,
    })
    expect(networkCalls()).toHaveLength(0)
  })

  // Covers AE3.
  it("keeps admin's English card for an English reader translation", async () => {
    mockGetClient.mockReturnValue({
      query: jest
        .fn()
        .mockResolvedValue(
          response([{ documentId: "c1", passage: rawPassage() }]),
        ),
    })

    const hook = renderHook({ slug: "jesus", citations: [cited("c1")] })
    await flush()

    expect(verseCards(hook.latest())[0]).toMatchObject({
      text: rawPassage().content,
      textLang: "en",
      verseDirection: null,
      loading: false,
    })
    expect(networkCalls()).toHaveLength(0)
  })

  // Covers AE5, AE6 (KTD5).
  it("uses only the device inside the cooldown window", async () => {
    const query = jest.fn().mockRejectedValue(new Error("network down"))
    mockGetClient.mockReturnValue({ query, readQuery: () => null })
    mockResolveCardQuotes.mockImplementation(async (_services, input) =>
      quoteResults(input, (citation) =>
        citation.documentId === "c1"
          ? local("kor_old", KOREAN_JOHN)
          : { status: "network", translationId: "kor_old" },
      ),
    )
    const citations = [cited("c1"), cited("c2", { verseStart: 17 })]
    const first = renderHook(
      { slug: "jesus", citations, forms: KO },
      { strict: false },
    )
    await flush()
    first.unmount()
    mockResolveCardQuotes.mockClear()

    const second = renderHook(
      { slug: "jesus", citations, forms: KO },
      { strict: false },
    )
    await flush()

    expect(query).toHaveBeenCalledTimes(1)
    const [downloaded, missing] = verseCards(second.latest())
    expect(downloaded).toMatchObject({ text: KOREAN_JOHN.text, loading: false })
    expect(missing).toMatchObject({ text: "", verseLang: null, loading: false })
    expect(networkCalls()).toHaveLength(0)
  })

  // Covers R12.
  it("keeps every card loading until the single settle", async () => {
    mockGetClient.mockReturnValue({ query: englishGaps(["c1", "c2"]) })
    const network = deferred<ReadonlyMap<string, CardQuoteResult>>()
    mockResolveCardQuotes.mockImplementation(async (_services, input) => {
      if (input.reach === "network") return network.promise
      return quoteResults(input, (citation) =>
        citation.documentId === "c1"
          ? local("kor_old", KOREAN_JOHN)
          : { status: "network", translationId: "kor_old" },
      )
    })
    const citations = [cited("c1"), cited("c2", GENESIS)]

    const hook = renderHook({ slug: "jesus", citations, forms: KO })
    await flush()

    // Admin answered in English and c1 is ready, yet nothing shows yet.
    for (const card of verseCards(hook.latest())) {
      expect(card).toMatchObject({ loading: true })
    }
    expect(verseCards(hook.latest())[0]?.reference).not.toBe("요한복음 3:16")

    await act(async () => {
      network.resolve(
        quoteResults(
          { citations: [citations[1]!], audioLanguage: null, reach: "network" },
          () => local("kor_old", KOREAN_GENESIS),
        ),
      )
    })
    await flush()

    expect(verseCards(hook.latest()).map((card) => card.text)).toEqual([
      KOREAN_JOHN.text,
      KOREAN_GENESIS.text,
    ])
    expect(hook.latest().loading).toBe(false)
  })

  // Covers R10 (the time limit).
  it("settles a card still reading at the deadline as admin's card", async () => {
    jest.useFakeTimers()
    mockGetClient.mockReturnValue({ query: englishGaps(["c1"]) })
    const network = deferred<ReadonlyMap<string, CardQuoteResult>>()
    mockResolveCardQuotes.mockImplementation(async (_services, input) =>
      input.reach === "network"
        ? network.promise
        : quoteResults(input, () => ({
            status: "network",
            translationId: "kor_old",
          })),
    )

    const hook = renderHook({
      slug: "jesus",
      citations: [cited("c1")],
      forms: KO,
    })
    await flush()
    expect(verseCards(hook.latest())[0]?.loading).toBe(true)

    await act(async () => {
      jest.advanceTimersByTime(PASSAGE_FETCH_DEADLINE_MS)
    })
    await flush()
    expect(verseCards(hook.latest())[0]).toMatchObject({
      text: "English text",
      verseLang: null,
      loading: false,
    })

    await act(async () => {
      network.resolve(
        quoteResults(
          { citations: [cited("c1")], audioLanguage: null, reach: "network" },
          () => local("kor_old", KOREAN_JOHN),
        ),
      )
    })
    await flush()
    expect(verseCards(hook.latest())[0]?.text).toBe("English text")
  })

  // Covers AE11, R14 (KTD11).
  it("reloads only the card whose translation changed on a return", async () => {
    mockGetClient.mockReturnValue({ query: englishGaps(["c1", "c2"]) })
    const citations = [cited("c1"), cited("c2", GENESIS)]
    mockResolveCardQuotes.mockImplementation(async (_services, input) =>
      quoteResults(input, (citation) =>
        citation.documentId === "c1"
          ? local("kor_old", KOREAN_JOHN)
          : local("kor_old", KOREAN_GENESIS),
      ),
    )
    const hook = renderHook({ slug: "jesus", citations, forms: KO })
    await flush()
    expect(verseCards(hook.latest())[0]?.text).toBe(KOREAN_JOHN.text)

    // The viewer picks the Synodal Bible for John in the reader, then returns.
    // Genesis's kept chapter is gone, so only the unchanged id keeps its text.
    const network = deferred<ReadonlyMap<string, CardQuoteResult>>()
    mockResolveCardQuotes.mockImplementation(async (_services, input) => {
      if (input.reach === "network") return network.promise
      return quoteResults(input, (citation) => ({
        status: "network",
        translationId: citation.documentId === "c1" ? "rus_syn" : "kor_old",
      }))
    })
    hook.rerender({
      slug: "jesus",
      citations,
      forms: KO,
      reader: { ...READER_DEFAULTS, focused: false },
    })
    hook.rerender({ slug: "jesus", citations, forms: KO })
    await flush()

    expect(verseCards(hook.latest())[0]?.loading).toBe(true)
    expect(verseCards(hook.latest())[1]).toMatchObject({
      text: KOREAN_GENESIS.text,
      loading: false,
    })

    await act(async () => {
      network.resolve(
        quoteResults(
          { citations: [citations[0]!], audioLanguage: null, reach: "network" },
          () => local("rus_syn", RUSSIAN_JOHN),
        ),
      )
    })
    await flush()
    expect(verseCards(hook.latest())[0]).toMatchObject({
      text: RUSSIAN_JOHN.text,
      verseLang: "ru",
      loading: false,
    })
  })

  it("gives a reload on a return its own time limit", async () => {
    jest.useFakeTimers()
    mockGetClient.mockReturnValue({ query: englishGaps(["c1"]) })
    const hook = renderHook({
      slug: "jesus",
      citations: [cited("c1")],
      forms: KO,
    })
    await flush()
    expect(verseCards(hook.latest())[0]?.text).toBe("English text")

    await act(async () => {
      jest.advanceTimersByTime(PASSAGE_FETCH_DEADLINE_MS * 3)
    })
    const network = deferred<ReadonlyMap<string, CardQuoteResult>>()
    mockResolveCardQuotes.mockImplementation(async (_services, input) =>
      input.reach === "network"
        ? network.promise
        : quoteResults(input, () => ({
            status: "network",
            translationId: "kor_old",
          })),
    )
    hook.rerender({
      slug: "jesus",
      citations: [cited("c1")],
      forms: KO,
      reader: { ...READER_DEFAULTS, focused: false },
    })
    hook.rerender({ slug: "jesus", citations: [cited("c1")], forms: KO })
    await flush()
    await act(async () => {
      jest.advanceTimersByTime(PASSAGE_FETCH_DEADLINE_MS - 1000)
    })
    expect(verseCards(hook.latest())[0]?.loading).toBe(true)

    await act(async () => {
      network.resolve(
        quoteResults(
          { citations: [cited("c1")], audioLanguage: null, reach: "network" },
          () => local("kor_old", KOREAN_JOHN),
        ),
      )
    })
    await flush()
    expect(verseCards(hook.latest())[0]).toMatchObject({
      text: KOREAN_JOHN.text,
      loading: false,
    })
  })

  it("reloads a card when the viewer's pick changes", async () => {
    mockGetClient.mockReturnValue({ query: englishGaps(["c1"]) })
    mockResolveCardQuotes.mockImplementation(async (_services, input) =>
      quoteResults(input, () => local("kor_old", KOREAN_JOHN)),
    )
    const hook = renderHook({
      slug: "jesus",
      citations: [cited("c1")],
      forms: KO,
    })
    await flush()
    expect(verseCards(hook.latest())[0]?.text).toBe(KOREAN_JOHN.text)

    mockResolveCardQuotes.mockImplementation(async (_services, input) =>
      englishReader(input),
    )
    mockPick = { translationId: "BSB" }
    act(() => {
      for (const listener of pickListeners) listener()
    })
    await flush()

    expect(verseCards(hook.latest())[0]).toMatchObject({
      text: "English text",
      verseLang: null,
      loading: false,
    })
  })

  it("discards a video's reader results when the route moves on", async () => {
    mockGetClient.mockReturnValue({ query: englishGaps(["c1"]) })
    mockResolveCardQuotes.mockImplementation(async (_services, input) =>
      quoteResults(input, () => local("kor_old", KOREAN_JOHN)),
    )
    const hook = renderHook({
      slug: "jesus",
      citations: [cited("c1")],
      forms: KO,
    })
    await flush()
    expect(verseCards(hook.latest())[0]?.text).toBe(KOREAN_JOHN.text)

    mockGetClient.mockReturnValue({
      query: jest.fn(() => new Promise(() => {})),
    })
    hook.rerender({
      slug: "the-beginning",
      citations: [cited("c1")],
      forms: KO,
    })
    await flush()

    expect(verseCards(hook.latest())[0]).toMatchObject({
      text: "",
      loading: true,
    })
    hook.unmount()
  })

  // Covers KTD9.
  it("keeps a card with no book yet loading until the payload settles", async () => {
    mockGetClient.mockReturnValue({ query: englishGaps(["c1"]) })
    const partial = [cited("c1", { bookUsfm: null })]
    const hook = renderHook({
      slug: "jesus",
      citations: partial,
      art: { ...NO_ART, payloadSettled: false },
      forms: KO,
    })
    await flush()
    expect(verseCards(hook.latest())[0]?.loading).toBe(true)

    hook.rerender({ slug: "jesus", citations: partial, forms: KO })
    await flush()
    expect(verseCards(hook.latest())[0]).toMatchObject({
      text: "English text",
      loading: false,
    })
  })

  it("waits for the dub preference before it settles", async () => {
    mockGetClient.mockReturnValue({ query: englishGaps(["c1"]) })
    const hook = renderHook({
      slug: "jesus",
      citations: [cited("c1")],
      forms: KO,
      reader: { ...READER_DEFAULTS, audioReady: false },
    })
    await flush()
    expect(verseCards(hook.latest())[0]?.loading).toBe(true)

    hook.rerender({
      slug: "jesus",
      citations: [cited("c1")],
      forms: KO,
      reader: { ...READER_DEFAULTS, audioLanguage: "spa" },
    })
    await flush()
    expect(verseCards(hook.latest())[0]?.loading).toBe(false)
    expect(mockResolveCardQuotes).toHaveBeenLastCalledWith(
      mockQuoteServices,
      expect.objectContaining({ audioLanguage: "spa" }),
    )
  })
})
