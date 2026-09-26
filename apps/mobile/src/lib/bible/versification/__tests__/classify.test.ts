// chapter-lengths.json: the last verse of every chapter of seven real Bibles,
// from each bible.helloao.org complete.json on 2026-09-25. It is the classifier
// input and also the ground truth for the accuracy test.
import chapterLengths from "./fixtures/chapter-lengths.json"
import {
  BSB_SYSTEM_ID,
  BSB_TRANSLATION_ID,
  MAX_LOWERED_CHAPTERS,
  MAX_LOWERED_VERSES,
  bookChapters,
  classifyBook,
  classifyTranslation,
  discriminatingChapters,
  resolveBookSystem,
  type BookChapters,
  type TranslationChapters,
} from "../classify"
import { STANDARD_SYSTEM_IDS, type StandardSystemId } from "../compact"
import { VERSIFICATION_SYSTEMS } from "../systems.generated"

const LENGTHS: Record<
  string,
  Record<string, number[]>
> = chapterLengths.translations
const TRANSLATION_IDS = Object.keys(LENGTHS)
const DISCRIMINATING = discriminatingChapters(VERSIFICATION_SYSTEMS)

function chaptersFrom(lastVerses: readonly number[], keep?: readonly number[]) {
  return bookChapters(
    lastVerses.map((lastVerse, index) => ({ number: index + 1, lastVerse })),
    keep,
  )
}

function translation(id: string, subset = false): TranslationChapters {
  return Object.fromEntries(
    Object.entries(LENGTHS[id] ?? {}).map(([bookId, lastVerses]) => [
      bookId,
      chaptersFrom(
        lastVerses,
        subset ? (DISCRIMINATING[bookId] ?? []) : undefined,
      ),
    ]),
  )
}

function systemLengths(system: StandardSystemId, bookId: string): number[] {
  return VERSIFICATION_SYSTEMS[system][bookId]?.v.split(" ").map(Number) ?? []
}

function systemsThatFit(bookId: string, lengths: number[]): StandardSystemId[] {
  return STANDARD_SYSTEM_IDS.filter((id) => {
    const numbered = systemLengths(id, bookId)
    return (
      numbered.length === lengths.length &&
      numbered.every((last, index) => last === lengths[index])
    )
  })
}

function classify(
  bookId: string,
  lastVerses: readonly number[],
  main: StandardSystemId = "eng",
) {
  return classifyBook(
    bookId,
    chaptersFrom(lastVerses),
    main,
    VERSIFICATION_SYSTEMS,
  )
}

describe("discriminatingChapters", () => {
  it("lists the chapters where the seven systems disagree", () => {
    // eng Joel has 3 chapters (20 32 21); org has 4 (20 27 5 21).
    expect(DISCRIMINATING.JOL).toEqual([2, 3, 4])
    expect(DISCRIMINATING.MAL).toEqual([3, 4])
    expect(DISCRIMINATING.REV).toEqual([12])
    expect(DISCRIMINATING.GAL).toEqual([])
  })

  it("counts bsb, whose 3 John ends at verse 14", () => {
    expect(DISCRIMINATING["3JN"]).toEqual([1])
  })

  it("ignores a system that has no such book", () => {
    // lxx has no DAN, so it cannot make every Daniel chapter disagree.
    expect(DISCRIMINATING.DAN?.[0]).toBe(3)
  })

  it("has 324 chapters in 41 books", () => {
    const lists = Object.values(DISCRIMINATING)
    expect(lists).toHaveLength(66)
    expect(lists.filter((list) => list?.length).length).toBe(41)
    expect(lists.reduce((sum, list) => sum + (list?.length ?? 0), 0)).toBe(324)
  })
})

describe("bookChapters", () => {
  const chapters = [
    { number: 1, lastVerse: 20 },
    { number: 2, lastVerse: 32 },
    { number: 3, lastVerse: 21 },
  ]

  it("records the chapter count and each chapter's last verse", () => {
    expect(bookChapters(chapters)).toEqual({
      chapterCount: 3,
      lastVerses: { 1: 20, 2: 32, 3: 21 },
    })
  })

  it("keeps only the given chapters, and always the count", () => {
    expect(bookChapters(chapters, [2, 4])).toEqual({
      chapterCount: 3,
      lastVerses: { 2: 32 },
    })
    expect(bookChapters(chapters, [])).toEqual({
      chapterCount: 3,
      lastVerses: {},
    })
  })

  it("takes the count from the highest chapter number", () => {
    const withGap = [
      { number: 1, lastVerse: 20 },
      { number: 3, lastVerse: 21 },
    ]
    expect(bookChapters(withGap)).toEqual({
      chapterCount: 3,
      lastVerses: { 1: 20, 3: 21 },
    })
    expect(bookChapters([]).chapterCount).toBe(0)
  })
})

describe("classifyTranslation on seven real Bibles", () => {
  it("gives the same answer from the discriminating chapters alone", () => {
    for (const id of TRANSLATION_IDS) {
      const full = classifyTranslation(translation(id), VERSIFICATION_SYSTEMS)
      const subset = classifyTranslation(
        translation(id, true),
        VERSIFICATION_SYSTEMS,
      )
      expect([id, subset]).toEqual([id, full])
    }
  })

  it("places every book that one system fits chapter by chapter", () => {
    for (const id of TRANSLATION_IDS) {
      const result = classifyTranslation(translation(id), VERSIFICATION_SYSTEMS)
      const misplaced = Object.entries(LENGTHS[id] ?? {}).filter(
        ([bookId, lengths]) => {
          const fits = systemsThatFit(bookId, lengths)
          const chosen = result.books[bookId]
          return (
            fits.length > 0 &&
            (chosen === undefined ||
              chosen === "unknown" ||
              !fits.includes(chosen))
          )
        },
      )
      expect([id, misplaced]).toEqual([id, []])
    }
  })

  it("BSB (never classified by U3): eng, but rsc for Revelation", () => {
    const result = classifyTranslation(
      translation(BSB_TRANSLATION_ID),
      VERSIFICATION_SYSTEMS,
    )
    expect(result.main).toBe("eng")
    const notEng = Object.entries(result.books).filter(([, id]) => id !== "eng")
    // BSB joins eng's Revelation 12:18 to 12:17; rsc also ends 12 at 17.
    expect(notEng).toEqual([["REV", "rsc"]])
    expect(BSB_SYSTEM_ID).toBe("bsb")
  })

  it("Russian Synodal: rsc in every book but Joshua and Proverbs", () => {
    const result = classifyTranslation(
      translation("rus_syn"),
      VERSIFICATION_SYSTEMS,
    )
    expect(result.main).toBe("rsc")
    const notRsc = Object.entries(result.books).filter(([, id]) => id !== "rsc")
    // This Synodal text has the Orthodox verses: Joshua 24 has 36 verses.
    expect(notRsc).toEqual([
      ["JOS", "rso"],
      ["PRO", "rso"],
    ])
    expect(LENGTHS.rus_syn?.JOS?.[23]).toBe(36)
  })

  it.each(["fra_lsg", "dan_det", "ces_bkr", "nld_nbg", "swe_svk"])(
    "%s: org for the Psalms, eng for Joel and Malachi",
    (id) => {
      const result = classifyTranslation(translation(id), VERSIFICATION_SYSTEMS)
      expect(result.main).toBe("eng")
      expect(result.books.PSA).toBe("org")
      expect(result.books.MAL).toBe("eng")
      expect(resolveBookSystem(result, "JOL")).toBe("eng")
    },
  )

  it("finds no system only for Danish Joel, which splits it 20, 27, 26", () => {
    const unknown = TRANSLATION_IDS.flatMap((id) => {
      const { books } = classifyTranslation(
        translation(id),
        VERSIFICATION_SYSTEMS,
      )
      return Object.entries(books)
        .filter(([, system]) => system === "unknown")
        .map(([bookId]) => `${id} ${bookId}`)
    })
    expect(unknown).toEqual(["dan_det JOL"])
    expect(LENGTHS.dan_det?.JOL).toEqual([20, 27, 26])
  })
})

describe("classifyBook", () => {
  it("picks the system that matches the most chapters", () => {
    for (const system of ["eng", "org", "rsc"] as const) {
      expect(classify("PSA", systemLengths(system, "PSA"))).toBe(system)
    }
  })

  it("an exact match beats the main system", () => {
    const revelation = systemLengths("eng", "REV")
    revelation[11] = 17
    expect(classify("REV", revelation, "eng")).toBe("rsc")
  })

  it(`tolerates ${MAX_LOWERED_CHAPTERS} chapters lowered by up to ${MAX_LOWERED_VERSES} verses`, () => {
    expect(classify("JOL", [20, 31, 20])).toBe("eng")
    expect(classify("JOL", [20, 30, 19])).toBe("eng")
    expect(classify("JOL", [20, 29, 18])).toBe("unknown")
  })

  it("counts a lowered chapter past the limit as a conflict", () => {
    const lowered = systemLengths("eng", "PSA").map((last) => last - 1)
    expect(classify("PSA", lowered)).toBe("unknown")
  })

  it("returns unknown when more than half the compared chapters conflict", () => {
    expect(classify("JOL", [20, 27, 26])).toBe("unknown")
  })

  it("returns unknown when no system has the chapter count", () => {
    expect(classify("GEN", systemLengths("eng", "GEN").slice(1))).toBe(
      "unknown",
    )
    expect(classify("TOB", [22, 14])).toBe("unknown")
  })

  it("breaks a tie by the main system, then eng, rsc, org, rso, vul, lxx", () => {
    const galatians = systemLengths("eng", "GAL")
    expect(classify("GAL", galatians, "org")).toBe("org")
    expect(classify("GAL", galatians, "lxx")).toBe("lxx")
    // org has four chapters of Joel, so it cannot be the answer here.
    expect(classify("JOL", [20, 32, 21], "org")).toBe("eng")
  })

  it("reads only the discriminating chapters", () => {
    const facts: BookChapters = { chapterCount: 6, lastVerses: { 1: 99 } }
    expect(classifyBook("GAL", facts, "rsc", VERSIFICATION_SYSTEMS)).toBe("rsc")
  })
})

describe("the main system", () => {
  it("is the Psalms' system when the Psalms have Greek numbers", () => {
    const vulgate = classifyTranslation(
      { PSA: chaptersFrom(systemLengths("vul", "PSA")) },
      VERSIFICATION_SYSTEMS,
    )
    expect(vulgate).toEqual({ main: "vul", books: { PSA: "vul" } })
  })

  it("is eng for Hebrew-numbered Psalms and without the Psalms", () => {
    const hebrew = classifyTranslation(
      { PSA: chaptersFrom(systemLengths("org", "PSA")) },
      VERSIFICATION_SYSTEMS,
    )
    expect(hebrew.main).toBe("eng")
    expect(classifyTranslation({}, VERSIFICATION_SYSTEMS).main).toBe("eng")
  })

  it("is the system that resolveBookSystem gives an unknown book", () => {
    const result = classifyTranslation(
      {
        PSA: chaptersFrom(systemLengths("rsc", "PSA")),
        JOL: chaptersFrom([20, 27, 26]),
        TOB: chaptersFrom([22, 14]),
      },
      VERSIFICATION_SYSTEMS,
    )
    expect(result.books).toEqual({ PSA: "rsc", JOL: "unknown" })
    expect(resolveBookSystem(result, "JOL")).toBe("rsc")
    expect(resolveBookSystem(result, "PSA")).toBe("rsc")
    expect(resolveBookSystem(result, "GAL")).toBe("rsc")
  })
})
