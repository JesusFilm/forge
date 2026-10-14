// A quote card's verse from the reader's translation (plan 2026-10-08, U2).
// The catalog, the translation rules, and the chapter files are real; the
// device and network reads are fakes, so each case sees which read answered.

/* eslint-disable @typescript-eslint/no-require-imports */

jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
)

import arabicJohn3 from "../../text/__tests__/fixtures/arb_vdv-jhn-3.json"
import t4tJohn4 from "../../text/__tests__/fixtures/eng_t4t-jhn-4.json"
import japaneseMatthew5 from "../../text/__tests__/fixtures/jpn_loc-mat-5.json"
import koreanJohn3 from "../../text/__tests__/fixtures/kor_old-jhn-3.json"
import koreanJohn4 from "../../text/__tests__/fixtures/kor_old-jhn-4.json"
import synodalPsalm9 from "../../text/__tests__/fixtures/rus_syn-psa-9.json"
import synodalPsalm50 from "../../text/__tests__/fixtures/rus_syn-psa-50.json"
import { parseCatalog, type Catalog } from "../../data/catalog"
import { createReadingPositionStore } from "../../position/store"
import type {
  ChapterRequest,
  ChapterResolution,
  ResolvedChapter,
} from "../../repository/resolveChapter"
import type { UsfmBookId } from "../../text/books"
import { normalizeChapterFile } from "../../text/normalize"
import type { ChapterText } from "../../text/types"
import {
  cardQuoteKey,
  resolveCardQuotes,
  type CardCitation,
  type CardQuoteResult,
  type CardQuoteServices,
} from "../cardQuote"

declare const __dirname: string
const fs = jest.requireActual<{
  readFileSync(path: string, encoding: "utf8"): string
}>("fs")

function loadCatalog(): Catalog {
  const raw: unknown = JSON.parse(
    fs.readFileSync(
      `${__dirname}/../../../../../assets/bible/catalog.bible`,
      "utf8",
    ),
  )
  const catalog = parseCatalog(raw)
  if (!catalog) throw new Error("the bundled catalog did not parse")
  return catalog
}

const CATALOG = loadCatalog()

function chapterOf(raw: unknown): ChapterText {
  const result = normalizeChapterFile(raw)
  if (result.status !== "ok") throw new Error(result.reason)
  return result.value
}

const KOREAN_JOHN_3 = chapterOf(koreanJohn3)
const KOREAN_JOHN_4 = chapterOf(koreanJohn4)
const SYNODAL_PSALM_9 = chapterOf(synodalPsalm9)
const JAPANESE_MATTHEW_5 = chapterOf(japaneseMatthew5)
const SYNODAL_PSALM_50 = chapterOf(synodalPsalm50)
const ARABIC_JOHN_3 = chapterOf(arabicJohn3)
/** SYNTHETIC: T4T's John 4 (verses 1-2 and 6-8 merged) under a Spanish id,
 *  because the English rule sends every English translation to admin. */
const MERGED_JOHN_4: ChapterText = {
  ...chapterOf(t4tJohn4),
  translationId: "spa_bes",
}
/** SYNTHETIC: Korean John 3 without verse 17, so 3:17 is a gap. */
const KOREAN_JOHN_3_GAP: ChapterText = {
  ...KOREAN_JOHN_3,
  chapter: {
    ...KOREAN_JOHN_3.chapter,
    verses: KOREAN_JOHN_3.chapter.verses.filter((verse) => verse.number !== 17),
  },
}

const KOREAN_JOHN_3_16 =
  "하나님이 세상을 이처럼 사랑하사 독생자를 주셨으니 이는 저를 믿는 자마다 멸망치 않고 영생을 얻게 하려 하심이니라"

type Options = {
  phone?: string | null
  /** Chapters on the device (a download or a kept chapter). */
  device?: ChapterText[]
  /** Chapters that bible.helloao.org answers with. */
  network?: ChapterText[]
  positionStore?: CardQuoteServices["positionStore"]
}

function findChapter(
  list: readonly ChapterText[],
  request: ChapterRequest,
): ChapterText | undefined {
  return list.find(
    (text) =>
      text.translationId === request.translationId &&
      text.bookId === request.bookId &&
      text.chapter.number === request.chapter,
  )
}

function found(
  text: ChapterText,
  source: ResolvedChapter["source"],
): ResolvedChapter {
  return { status: "ok", text, source, stale: false }
}

async function storeWith(
  pick: { translationId?: string; session?: string } = {},
) {
  const items = new Map<string, string>()
  const store = createReadingPositionStore({
    getItem: async (key) => items.get(key) ?? null,
    setItem: async (key, value) => {
      items.set(key, value)
    },
  })
  await store.hydrate()
  if (pick.translationId) store.pickTranslation(pick.translationId)
  if (pick.session) store.switchTranslationForSession(pick.session)
  return store
}

async function servicesOf(options: Options = {}) {
  const device = options.device ?? []
  const network = options.network ?? []
  const repository = {
    readOnDevice: jest.fn(async (request: ChapterRequest) => {
      const text = findChapter(device, request)
      return text ? found(text, "downloaded") : null
    }),
    resolve: jest.fn(
      async (
        request: ChapterRequest,
        _options?: { source?: "quote" },
      ): Promise<ChapterResolution> => {
        const onDevice = findChapter(device, request)
        if (onDevice) return found(onDevice, "downloaded")
        const fetched = findChapter(network, request)
        return fetched
          ? found(fetched, "network")
          : { status: "failed", reason: "not-found", httpStatus: 404 }
      },
    ),
    isOnDevice: jest.fn(async () => false),
    translationHasBook: (
      translation: { books: ReadonlySet<UsfmBookId> },
      bookId: UsfmBookId,
    ) => translation.books.has(bookId),
  }
  const services = {
    repository,
    downloads: { check: jest.fn(async () => {}) },
    loadCatalog: jest.fn(async () => ({
      status: "ok" as const,
      value: CATALOG,
    })),
    positionStore: options.positionStore ?? (await storeWith()),
    readPhoneLanguage: () => options.phone ?? null,
  } satisfies CardQuoteServices
  return services
}

// Every field written out: a helper that derived one from another would let a
// case pass because a sibling field also steered the branch.
function citation(
  book: UsfmBookId | null,
  chapterStart: number | null,
  verseStart: number | null,
  more: Partial<CardCitation> = {},
): CardCitation {
  return {
    documentId: `${book}-${chapterStart}-${verseStart}`,
    bookUsfm: book,
    chapterStart,
    chapterEnd: null,
    verseStart,
    verseEnd: null,
    ...more,
  }
}

async function resultFor(
  services: CardQuoteServices,
  cited: CardCitation,
  options: { audioLanguage?: string | null; reach?: "device" | "network" } = {},
): Promise<CardQuoteResult | undefined> {
  const results = await resolveCardQuotes(services, {
    citations: [cited],
    audioLanguage: options.audioLanguage ?? null,
    reach: options.reach ?? "network",
  })
  return results.get(cardQuoteKey(cited))
}

describe("which translation a card uses (R1, R3)", () => {
  it("covers AE1: a Korean phone shows John 3:16 from 한국어 성경", async () => {
    const services = await servicesOf({
      phone: "ko",
      network: [KOREAN_JOHN_3],
    })

    const result = await resultFor(services, citation("JHN", 3, 16))

    expect(result).toEqual({
      status: "local",
      translationId: "kor_old",
      quote: {
        text: KOREAN_JOHN_3_16,
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
      },
    })
    expect(services.repository.resolve).toHaveBeenCalledWith(
      expect.objectContaining({
        translationId: "kor_old",
        bookId: "JHN",
        chapter: 3,
      }),
      { source: "quote" },
    )
  })

  it("covers AE7: a Korean phone with a saved BSB pick keeps admin's card", async () => {
    const services = await servicesOf({
      phone: "ko",
      network: [KOREAN_JOHN_3],
      positionStore: await storeWith({ translationId: "BSB" }),
    })

    await expect(resultFor(services, citation("JHN", 3, 16))).resolves.toEqual({
      status: "admin",
      translationId: "BSB",
    })
    expect(services.repository.resolve).not.toHaveBeenCalled()
  })

  it("covers AE9: an English phone with a Spanish dub uses the Spanish default", async () => {
    const services = await servicesOf({ phone: "en" })

    await expect(
      resultFor(services, citation("JHN", 3, 16), {
        audioLanguage: "spa",
        reach: "device",
      }),
    ).resolves.toEqual({ status: "network", translationId: "spa_bes" })
  })

  it("covers AE4: a New Testament default sends Genesis to admin and shows Matthew", async () => {
    const services = await servicesOf({
      phone: "ja",
      network: [JAPANESE_MATTHEW_5],
    })
    const genesis = citation("GEN", 1, 1)
    const matthew = citation("MAT", 5, 3)

    const results = await resolveCardQuotes(services, {
      citations: [genesis, matthew],
      audioLanguage: null,
      reach: "network",
    })

    expect(results.get(cardQuoteKey(genesis))).toEqual({
      status: "admin",
      translationId: "BSB",
    })
    expect(results.get(cardQuoteKey(matthew))).toMatchObject({
      status: "local",
      translationId: "jpn_loc",
      quote: {
        text: "「心の貧しい者は幸いです。天の御国はその人のものだからです。",
        reference: {
          bookName: "マタイの福音書",
          chapterStart: 5,
          verseStart: 3,
        },
      },
    })
  })

  it("uses the phone's default for a book that the viewer's pick lacks", async () => {
    const services = await servicesOf({
      phone: "ko",
      positionStore: await storeWith({ translationId: "jpn_loc" }),
    })

    await expect(
      resultFor(services, citation("GEN", 1, 1), { reach: "device" }),
    ).resolves.toEqual({ status: "network", translationId: "kor_old" })
  })

  it("follows the session switch first, as the reader does", async () => {
    const services = await servicesOf({
      phone: "ko",
      positionStore: await storeWith({
        translationId: "BSB",
        session: "rus_syn",
      }),
    })

    await expect(
      resultFor(services, citation("JHN", 3, 16), { reach: "device" }),
    ).resolves.toEqual({ status: "network", translationId: "rus_syn" })
  })
})

describe("the device and network phases (KTD4, KTD5)", () => {
  it("reads a chapter on the device with no network read", async () => {
    const services = await servicesOf({
      phone: "ko",
      device: [KOREAN_JOHN_3],
    })

    await expect(
      resultFor(services, citation("JHN", 3, 16), { reach: "device" }),
    ).resolves.toMatchObject({ status: "local", translationId: "kor_old" })
    expect(services.repository.resolve).not.toHaveBeenCalled()
  })

  it("asks for the network phase when the device lacks the chapter", async () => {
    const services = await servicesOf({
      phone: "ko",
      network: [KOREAN_JOHN_3],
    })

    await expect(
      resultFor(services, citation("JHN", 3, 16), { reach: "device" }),
    ).resolves.toEqual({ status: "network", translationId: "kor_old" })
    expect(services.repository.resolve).not.toHaveBeenCalled()
  })

  it("falls back when the network read fails", async () => {
    const services = await servicesOf({ phone: "ko" })

    await expect(resultFor(services, citation("JHN", 3, 16))).resolves.toEqual({
      status: "fallback",
      translationId: "kor_old",
      reason: "read-failed",
    })
  })
})

describe("the verses a card shows (KTD6)", () => {
  it("covers AE10: Synodal numbering moves BSB Psalm 51:1 to 50:3", async () => {
    const services = await servicesOf({
      phone: "ru",
      network: [SYNODAL_PSALM_50],
    })

    await expect(resultFor(services, citation("PSA", 51, 1))).resolves.toEqual({
      status: "local",
      translationId: "rus_syn",
      quote: {
        text: "Помилуй меня, Боже, по великой милости Твоей, и по множеству щедрот Твоих изгладь беззакония мои.",
        reference: {
          bookName: "Псалтырь",
          chapterStart: 50,
          chapterEnd: null,
          verseStart: 3,
          verseEnd: null,
        },
        translationName: "Синодальный перевод",
        credit: "public domain",
        textDirection: "ltr",
        languageTag: "ru",
      },
    })
  })

  it("starts a whole-chapter citation at the chapter's first verse stop", async () => {
    const services = await servicesOf({
      phone: "ru",
      network: [SYNODAL_PSALM_50],
    })

    const result = await resultFor(services, citation("PSA", 51, null))

    if (result?.status !== "local") throw new Error(String(result?.status))
    expect(result.quote.reference).toEqual({
      bookName: "Псалтырь",
      chapterStart: 50,
      chapterEnd: null,
      verseStart: null,
      verseEnd: null,
    })
    expect(
      result.quote.text.startsWith("Начальнику хора. Псалом Давида,"),
    ).toBe(true)
    expect(
      result.quote.text.endsWith("тогда возложат на алтарь Твой тельцов."),
    ).toBe(true)
  })

  it("reads a quote across two chapters", async () => {
    const services = await servicesOf({
      phone: "ko",
      network: [KOREAN_JOHN_3, KOREAN_JOHN_4],
    })

    const result = await resultFor(
      services,
      citation("JHN", 3, 35, { chapterEnd: 4, verseEnd: 2 }),
    )

    if (result?.status !== "local") throw new Error(String(result?.status))
    expect(result.quote.reference).toEqual({
      bookName: "요한복음",
      chapterStart: 3,
      chapterEnd: 4,
      verseStart: 35,
      verseEnd: 2,
    })
    expect(result.quote.text).toBe(
      [
        "아버지께서 아들을 사랑하사 만물을 다 그 손에 주셨으니",
        "아들을 믿는 자는 영생이 있고 아들을 순종치 아니하는 자는 영생을 보지 못하고 도리어 하나님의 진노가 그 위에 머물러 있느니라'",
        "예수의 제자를 삼고 세례를 주는 것이 요한보다 많다 하는 말을 바리새인들이 들은 줄을 주께서 아신지라",
        "(예수께서 친히 세례를 주신 것이 아니요 제자들이 준 것이라)",
      ].join(" "),
    )
  })

  it("asks for the network when one of two chapters is not on the device", async () => {
    const services = await servicesOf({
      phone: "ko",
      device: [KOREAN_JOHN_3],
      network: [KOREAN_JOHN_4],
    })

    await expect(
      resultFor(
        services,
        citation("JHN", 3, 35, { chapterEnd: 4, verseEnd: 2 }),
        {
          reach: "device",
        },
      ),
    ).resolves.toEqual({ status: "network", translationId: "kor_old" })
  })

  it("labels a whole BSB chapter that is part of a translation chapter by its verses", async () => {
    const services = await servicesOf({
      phone: "ru",
      network: [SYNODAL_PSALM_9],
    })

    const result = await resultFor(services, citation("PSA", 10, null))

    if (result?.status !== "local") throw new Error(String(result?.status))
    // BSB Psalm 10 is Synodal Psalm 9:22-39, not the whole of Psalm 9.
    expect(result.quote.reference).toEqual({
      bookName: "Псалтырь",
      chapterStart: 9,
      chapterEnd: null,
      verseStart: 22,
      verseEnd: 39,
    })
    expect(
      result.quote.text.startsWith("Для чего, Господи, стоишь вдали,"),
    ).toBe(true)
  })

  it("shows every verse stop in a range, and labels a merged verse by its numbers", async () => {
    const services = await servicesOf({
      phone: "es",
      network: [MERGED_JOHN_4],
    })

    const result = await resultFor(
      services,
      citation("JHN", 4, 5, { verseEnd: 9 }),
    )

    if (result?.status !== "local") throw new Error(String(result?.status))
    expect(result.quote.reference).toEqual({
      bookName: "John",
      chapterStart: 4,
      chapterEnd: null,
      verseStart: 5,
      verseEnd: 9,
    })
    expect(result.quote.text).toBe(
      [
        "So we arrived at a town named Sychar in Samaria district. That was near the plot of ground that our ancestor Jacob had given to his son Joseph long ago.",
        "The well that used to belong to Jacob was on that plot of ground. Jesus was tired from walking. So while we disciples went into the town to buy some food, he sat down alongside the well. It was about noontime. A woman who lived there in Samaria came to get some water from the well. Jesus said to her, “Will you give me from the well some water to drink?” The woman knew that Jews did not like ◄to touch things that belong to Samaritans/to come near Samaritans►, (OR, Jews did not like to associate with Samaritans,)",
        "so the woman said to him, “You are a Jew, and I am from Samaria. Furthermore, I am a woman. So ◄I am surprised that you are asking me for a drink of water!/how is it that you are asking me for a drink of water?► [RHQ]”",
      ].join(" "),
    )
  })

  it("labels a citation inside a merged verse by the merged numbers", async () => {
    const services = await servicesOf({
      phone: "es",
      network: [MERGED_JOHN_4],
    })

    const result = await resultFor(services, citation("JHN", 4, 7))

    if (result?.status !== "local") throw new Error(String(result?.status))
    expect(result.quote.reference).toMatchObject({
      chapterStart: 4,
      verseStart: 6,
      verseEnd: 8,
    })
  })

  it("falls back when a range's end has no verse in the translation", async () => {
    const services = await servicesOf({
      phone: "ko",
      network: [KOREAN_JOHN_3_GAP],
    })

    await expect(
      resultFor(services, citation("JHN", 3, 16, { verseEnd: 17 })),
    ).resolves.toEqual({
      status: "fallback",
      translationId: "kor_old",
      reason: "no-verse",
    })
  })

  it("falls back, with no read, for a quote over more than 2 chapters", async () => {
    const services = await servicesOf({
      phone: "ko",
      network: [KOREAN_JOHN_3],
    })

    await expect(
      resultFor(
        services,
        citation("JHN", 3, 16, { chapterEnd: 5, verseEnd: 1 }),
      ),
    ).resolves.toEqual({
      status: "fallback",
      translationId: "kor_old",
      reason: "too-long",
    })
    expect(services.repository.resolve).not.toHaveBeenCalled()
  })

  it("falls back when the reader would open at another verse (BSB lacks it)", async () => {
    const services = await servicesOf({
      phone: "ko",
      network: [KOREAN_JOHN_3],
    })

    await expect(resultFor(services, citation("JHN", 3, 40))).resolves.toEqual({
      status: "fallback",
      translationId: "kor_old",
      reason: "no-verse",
    })
  })
})

describe("the card's language marks (KTD7)", () => {
  it("gives an Arabic verse rtl and the screen-reader tag ar", async () => {
    const services = await servicesOf({
      phone: "en",
      network: [ARABIC_JOHN_3],
      positionStore: await storeWith({ translationId: "arb_vdv" }),
    })

    await expect(
      resultFor(services, citation("JHN", 3, 16)),
    ).resolves.toMatchObject({
      status: "local",
      quote: {
        reference: { bookName: "يُوحَنّا" },
        textDirection: "rtl",
        languageTag: "ar",
      },
    })
  })
})

describe("what a card cannot know yet (KTD8, KTD9)", () => {
  it("falls back when the saved pick did not load in time", async () => {
    const services = await servicesOf({
      phone: "ko",
      network: [KOREAN_JOHN_3],
      positionStore: {
        hydrate: async () => "missed",
        getSnapshot: () => ({
          ref: null,
          translationId: null,
          sessionTranslationId: null,
          status: "ready",
        }),
      },
    })

    await expect(resultFor(services, citation("JHN", 3, 16))).resolves.toEqual({
      status: "fallback",
      translationId: null,
      reason: "unknown-translation",
    })
    expect(services.repository.resolve).not.toHaveBeenCalled()
  })

  it("waits on a citation whose book is not known yet", async () => {
    const services = await servicesOf({ phone: "ko" })

    await expect(resultFor(services, citation(null, 3, 16))).resolves.toEqual({
      status: "pending",
    })
  })

  it("keys a result on the citation's content, not its id alone", () => {
    const partial = citation(null, 3, 16, { documentId: "c1" })
    const filled = citation("JHN", 3, 16, { documentId: "c1" })
    expect(cardQuoteKey(partial)).not.toBe(cardQuoteKey(filled))
  })
})

describe("a service that throws (KTD1)", () => {
  it("never rejects when the catalog read rejects", async () => {
    const services = await servicesOf({ phone: "ko" })
    services.loadCatalog.mockRejectedValue(new Error("asset"))

    await expect(resultFor(services, citation("JHN", 3, 16))).resolves.toEqual({
      status: "fallback",
      translationId: null,
      reason: "error",
    })
  })

  it("never rejects when a chapter read throws", async () => {
    const services = await servicesOf({ phone: "ko" })
    services.repository.resolve.mockImplementation(() => {
      throw new Error("disk")
    })

    await expect(resultFor(services, citation("JHN", 3, 16))).resolves.toEqual({
      status: "fallback",
      translationId: "kor_old",
      reason: "error",
    })
  })
})
