// A translation's own book names (owner, 2026-09-28): the passage picker names
// each book as the shown translation does. The file shape is the real
// `/api/kor_old/books.json` (2026-09-28), cut to three books.
import type { UsfmBookId } from "../../text/books"
import {
  BOOK_NAME_MAX_LENGTH,
  BOOK_NAMES_MAX_BYTES,
  bookNamesFromBooks,
  bookNamesUrl,
  createBookNamesStore,
  fetchBookNames,
  parseBooksFile,
  parseStoredBookNames,
  storedBookNamesText,
  type BookNames,
  type BookNamesStoreOptions,
} from "../bookNames"
import type { FetchLike } from "../fetchChapter"

const KOR = { id: "kor_old", sha256: "a".repeat(64) }

function booksFile(books: unknown[], translationId = "kor_old"): unknown {
  return {
    translation: { id: translationId, name: "한국어 성경", shortName: "OLD" },
    books,
  }
}

const KOREAN_FILE = booksFile([
  {
    id: "GEN",
    name: "창세기",
    commonName: "창세기",
    title: "창세기",
    order: 1,
  },
  { id: "EXO", name: "출애굽기", commonName: "출애굽기", order: 2 },
  { id: "MAT", name: "마태복음", commonName: "마태복음", order: 40 },
])

const names = (entries: [UsfmBookId, string][]): BookNames => new Map(entries)

describe("parseBooksFile", () => {
  it("reads each book's name", () => {
    expect(parseBooksFile(KOREAN_FILE, "kor_old")).toEqual(
      names([
        ["GEN", "창세기"],
        ["EXO", "출애굽기"],
        ["MAT", "마태복음"],
      ]),
    )
  })

  it("prefers the common name, as the passage pill does", () => {
    const file = booksFile([
      { id: "GEN", name: "The First Book of Moses", commonName: " Genesis " },
      { id: "EXO", name: "Exodus", title: "The Second Book of Moses" },
      { id: "LEV", title: "Leviticus" },
    ])
    expect(parseBooksFile(file, "kor_old")).toEqual(
      names([
        ["GEN", "Genesis"],
        ["EXO", "Exodus"],
        ["LEV", "Leviticus"],
      ]),
    )
  })

  it("drops a bad book and keeps the rest", () => {
    const file = booksFile([
      { id: "XYZ", commonName: "Nothing" },
      { id: "GEN", commonName: "" },
      { id: "EXO", commonName: "x".repeat(BOOK_NAME_MAX_LENGTH + 1) },
      { id: "MAT", commonName: "마태복음" },
      { id: "MAT", commonName: "second copy" },
      "not a book",
    ])
    expect(parseBooksFile(file, "kor_old")).toEqual(
      names([["MAT", "마태복음"]]),
    )
  })

  it("refuses another translation's file, or a file with no names", () => {
    expect(parseBooksFile(KOREAN_FILE, "rus_syn")).toBeNull()
    expect(parseBooksFile(booksFile([]), "kor_old")).toBeNull()
    expect(parseBooksFile({ books: [] }, "kor_old")).toBeNull()
    expect(parseBooksFile(null, "kor_old")).toBeNull()
  })
})

describe("the stored file", () => {
  it("reads back what it wrote", () => {
    const korean = parseBooksFile(KOREAN_FILE, "kor_old")!
    const text = storedBookNamesText(KOR, korean)
    expect(parseStoredBookNames(JSON.parse(text), "kor_old")).toEqual({
      sha256: KOR.sha256,
      names: korean,
    })
  })

  it("refuses another translation's file and another format", () => {
    const text = storedBookNamesText(KOR, names([["GEN", "창세기"]]))
    expect(parseStoredBookNames(JSON.parse(text), "rus_syn")).toBeNull()
    const raw = JSON.parse(text) as Record<string, unknown>
    expect(
      parseStoredBookNames({ ...raw, formatVersion: 99 }, "kor_old"),
    ).toBeNull()
  })
})

describe("bookNamesFromBooks", () => {
  it("takes one name per book from a download", () => {
    expect(
      bookNamesFromBooks([
        { bookId: "GEN", bookName: "창세기" },
        { bookId: "EXO", bookName: " " },
      ]),
    ).toEqual(names([["GEN", "창세기"]]))
  })
})

describe("createBookNamesStore", () => {
  const KOREAN = names([
    ["GEN", "창세기"],
    ["EXO", "출애굽기"],
  ])

  function setup(overrides: Partial<BookNamesStoreOptions> = {}) {
    const fetchNames = jest.fn(async (): Promise<BookNames | null> => KOREAN)
    const readStored = jest.fn(async (): Promise<unknown> => null)
    const writeStored = jest.fn()
    const store = createBookNamesStore({
      fetchNames,
      readStored,
      writeStored,
      ...overrides,
    })
    return { store, fetchNames, readStored, writeStored }
  }

  it("reads the network once, keeps the names, and tells its listeners", async () => {
    const { store, fetchNames, writeStored } = setup()
    const listener = jest.fn()
    store.subscribe(listener)
    expect(store.peek("kor_old")).toBeNull()

    await expect(store.load(KOR)).resolves.toBe(KOREAN)
    expect(store.peek("kor_old")).toBe(KOREAN)
    expect(listener).toHaveBeenCalled()
    expect(writeStored).toHaveBeenCalledWith(
      "kor_old",
      storedBookNamesText(KOR, KOREAN),
    )

    await store.load(KOR)
    expect(fetchNames).toHaveBeenCalledTimes(1)
  })

  it("uses the names on the device, with no network, when the hash matches", async () => {
    const stored = JSON.parse(storedBookNamesText(KOR, KOREAN)) as unknown
    const { store, fetchNames } = setup({ readStored: async () => stored })
    await expect(store.load(KOR)).resolves.toEqual(KOREAN)
    expect(fetchNames).not.toHaveBeenCalled()
  })

  it("reads again for a new hash, and keeps the old names when that fails", async () => {
    const old = JSON.parse(
      storedBookNamesText({ ...KOR, sha256: "b".repeat(64) }, KOREAN),
    ) as unknown
    const fetchNames = jest.fn(async () => null)
    const { store } = setup({ readStored: async () => old, fetchNames })
    await expect(store.load(KOR)).resolves.toEqual(KOREAN)
    expect(fetchNames).toHaveBeenCalledTimes(1)
  })

  it("answers null when nothing has the names, and tries again next time", async () => {
    const fetchNames = jest
      .fn<Promise<BookNames | null>, [string]>()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(KOREAN)
    const { store } = setup({ fetchNames })
    await expect(store.load(KOR)).resolves.toBeNull()
    await expect(store.load(KOR)).resolves.toBe(KOREAN)
  })

  it("shares one read between two calls", async () => {
    const { store, fetchNames } = setup()
    const [first, second] = await Promise.all([
      store.load(KOR),
      store.load(KOR),
    ])
    expect(first).toBe(KOREAN)
    expect(second).toBe(KOREAN)
    expect(fetchNames).toHaveBeenCalledTimes(1)
  })

  it("never rejects, even when the device read throws", async () => {
    const { store } = setup({
      readStored: jest.fn(async () => {
        throw new Error("disk")
      }),
    })
    await expect(store.load(KOR)).resolves.toBeNull()
  })

  it("reads nothing for BSB, whose names are the app's own", async () => {
    const { store, fetchNames, readStored } = setup()
    await expect(
      store.load({ id: "BSB", sha256: "c".repeat(64) }),
    ).resolves.toBeNull()
    expect(fetchNames).not.toHaveBeenCalled()
    expect(readStored).not.toHaveBeenCalled()
  })

  it("keeps a download's names, so a later load needs no network", async () => {
    const { store, fetchNames, writeStored } = setup()
    store.keep(KOR, KOREAN)
    expect(store.peek("kor_old")).toBe(KOREAN)
    expect(writeStored).toHaveBeenCalledTimes(1)
    await store.load(KOR)
    expect(fetchNames).not.toHaveBeenCalled()
  })
})

describe("fetchBookNames", () => {
  const respond =
    (response: Response): FetchLike =>
    async () =>
      response

  it("asks for the translation's books.json", async () => {
    const fetchImpl = jest.fn(
      async () => new Response(JSON.stringify(KOREAN_FILE), { status: 200 }),
    )
    await expect(fetchBookNames("kor_old", fetchImpl)).resolves.toEqual(
      names([
        ["GEN", "창세기"],
        ["EXO", "출애굽기"],
        ["MAT", "마태복음"],
      ]),
    )
    expect(fetchImpl.mock.calls[0]).toEqual([
      bookNamesUrl("kor_old"),
      expect.anything(),
    ])
    expect(bookNamesUrl("kor_old")).toBe(
      "https://bible.helloao.org/api/kor_old/books.json",
    )
  })

  it("answers null for an error status, bad JSON, or a body over the cap", async () => {
    await expect(
      fetchBookNames("kor_old", respond(new Response("busy", { status: 503 }))),
    ).resolves.toBeNull()
    await expect(
      fetchBookNames("kor_old", respond(new Response("{", { status: 200 }))),
    ).resolves.toBeNull()
    const huge = "x".repeat(BOOK_NAMES_MAX_BYTES + 1)
    await expect(
      fetchBookNames("kor_old", respond(new Response(huge, { status: 200 }))),
    ).resolves.toBeNull()
  })
})
