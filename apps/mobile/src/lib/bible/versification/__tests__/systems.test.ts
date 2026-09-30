// The app imports only systems.generated.ts. These tests prove that it is the
// 66-book subset of the vendored Copenhagen Alliance files, plus the two
// hand-written layers (the eng erratum and bsb), with no drift.
import eng from "../systems/eng.json"
import lxx from "../systems/lxx.json"
import org from "../systems/org.json"
import rsc from "../systems/rsc.json"
import rso from "../systems/rso.json"
import vul from "../systems/vul.json"
import { BIBLE_BOOKS } from "../../text/books"
import {
  STANDARD_SYSTEM_IDS,
  VersificationDataError,
  buildVersificationSystems,
  compactSystem,
  type StandardSystemId,
} from "../compact"
import { VERSIFICATION_SYSTEMS } from "../systems.generated"

const RAW: Record<StandardSystemId, unknown> = { org, eng, lxx, vul, rsc, rso }
const BOOK_IDS = BIBLE_BOOKS.map((book) => book.usfm)

describe("systems.generated.ts", () => {
  it("equals the build of the vendored files", () => {
    expect(VERSIFICATION_SYSTEMS).toEqual(
      buildVersificationSystems(RAW, BOOK_IDS),
    )
    expect(Object.keys(VERSIFICATION_SYSTEMS)).toEqual([
      "org",
      "eng",
      "lxx",
      "vul",
      "rsc",
      "rso",
      "bsb",
    ])
  })

  it.each(STANDARD_SYSTEM_IDS.filter((id) => id !== "eng"))(
    "%s is the vendored file with no change",
    (id) => {
      expect(VERSIFICATION_SYSTEMS[id]).toEqual(
        compactSystem(RAW[id], BOOK_IDS),
      )
    },
  )

  it("eng differs from its file only by the Isaiah 64:1 erratum", () => {
    const vendored = compactSystem(RAW.eng, BOOK_IDS)
    expect({ ...VERSIFICATION_SYSTEMS.eng, ISA: undefined }).toEqual({
      ...vendored,
      ISA: undefined,
    })
    expect(Object.keys(eng.mappedVerses)).not.toContain("ISA 64:1")
    expect(VERSIFICATION_SYSTEMS.eng.ISA).toEqual({
      v: vendored.ISA?.v,
      m: `${vendored.ISA?.m} 63:19=63:19 64:1=63:19`,
    })
  })

  it("bsb is eng with BSB's joins in 3 John 1 and Revelation 12", () => {
    const {
      "3JN": threeJohn,
      REV: revelation,
      ...rest
    } = VERSIFICATION_SYSTEMS.bsb
    const {
      "3JN": engThreeJohn,
      REV: engRevelation,
      ...engRest
    } = VERSIFICATION_SYSTEMS.eng
    expect(rest).toEqual(engRest)
    expect(threeJohn).toEqual({ v: "14", m: "1:14=1:14-15" })
    expect(engThreeJohn).toEqual({ v: "15" })
    expect(revelation?.v.split(" ")[11]).toBe("17")
    expect(revelation?.m).toBe("12:17=12:17-18")
    expect(engRevelation?.v.split(" ")[11]).toBe("18")
  })

  it("keeps only the 66 reader books", () => {
    const allowed = new Set<string>(BOOK_IDS)
    for (const system of Object.values(VERSIFICATION_SYSTEMS)) {
      for (const book of Object.keys(system)) {
        expect(allowed.has(book)).toBe(true)
      }
    }
    expect(Object.keys(VERSIFICATION_SYSTEMS.org)).toEqual(BOOK_IDS)
    expect(Object.keys(VERSIFICATION_SYSTEMS.bsb)).toEqual(BOOK_IDS)
  })

  it("leaves out a book that a system does not number", () => {
    expect(VERSIFICATION_SYSTEMS.lxx.DAN).toBeUndefined()
    expect(VERSIFICATION_SYSTEMS.lxx.NEH).toBeUndefined()
    expect(VERSIFICATION_SYSTEMS.vul.EST).toBeUndefined()
  })
})

describe("compactSystem", () => {
  it("lists the last verse of each chapter", () => {
    const rscDaniel = VERSIFICATION_SYSTEMS.rsc.DAN?.v.split(" ").map(Number)
    const rsoDaniel = VERSIFICATION_SYSTEMS.rso.DAN?.v.split(" ").map(Number)
    expect(rscDaniel?.[2]).toBe(33)
    expect(rsoDaniel?.[2]).toBe(100)
    expect(VERSIFICATION_SYSTEMS.eng.MAL?.v).toBe("14 17 18 6")
  })

  it("keeps each mapping of a book without the book id", () => {
    expect(VERSIFICATION_SYSTEMS.rsc.ROM?.m).toBe("14:24-26=16:25-27")
    expect(VERSIFICATION_SYSTEMS.eng.MAL?.m).toBe("4:1-6=3:19-24")
    expect(VERSIFICATION_SYSTEMS.org.GEN?.m).toBeUndefined()
  })

  it("keeps a range whose two sides differ in length", () => {
    expect(VERSIFICATION_SYSTEMS.rso.PSA?.m).toContain("89:2-6=90:1-6")
    expect(VERSIFICATION_SYSTEMS.rsc.PSA?.m).toContain("141:0=142:0-1")
  })

  it("marks a verse that maps to another book as excluded", () => {
    expect(VERSIFICATION_SYSTEMS.rso.DAN?.x).toBe("3:24-90 13:1-64 14:1-42")
    expect(VERSIFICATION_SYSTEMS.lxx.EZR?.x).toContain("11:1-11")
  })

  it("rejects a malformed mapping in one of the 66 books", () => {
    const raw = {
      maxVerses: { GEN: ["31"] },
      mappedVerses: { "GEN 1:x": "GEN 1:1" },
    }
    expect(() => compactSystem(raw, ["GEN"])).toThrow(VersificationDataError)
  })

  it("ignores a malformed mapping in a book outside the 66", () => {
    const raw = {
      maxVerses: { GEN: ["31"] },
      mappedVerses: { "DAG 3:52-23": "S3Y 1:30-31" },
    }
    expect(compactSystem(raw, ["GEN"])).toEqual({ GEN: { v: "31" } })
  })

  it("rejects a file with no maxVerses", () => {
    expect(() => compactSystem({}, ["GEN"])).toThrow(VersificationDataError)
  })
})
