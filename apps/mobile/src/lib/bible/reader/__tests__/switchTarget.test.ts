// R31's switch target (feat-551). The catalog is the bundled snapshot; the
// download states are stubs, because a real download needs the network.
import { parseCatalog, type Catalog } from "../../data/catalog"
import type { TranslationDownloadState } from "../../repository/translationDownloads"
import type { UsfmBookId } from "../../text/books"
import { onDeviceSwitchTarget } from "../switchTarget"

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
const NOT_DOWNLOADED: TranslationDownloadState = { kind: "not-downloaded" }

function translation(id: string) {
  const entry = CATALOG.byId.get(id)
  if (!entry) throw new Error(`${id} is not in the catalog`)
  return entry
}

function downloaded(books: UsfmBookId[]): TranslationDownloadState {
  return {
    kind: "downloaded",
    sha256: "0".repeat(64),
    books: new Set(books),
    bytes: 1,
  }
}

/** Two Spanish Bibles and one French Bible, from the real catalog. */
const spanish = CATALOG.translations.filter((item) => item.language === "spa")
const [SPANISH_A, SPANISH_B] = spanish
const FRENCH = translation("fra_ncl")

describe("onDeviceSwitchTarget", () => {
  it("has the catalog entries the cases name", () => {
    expect(SPANISH_A).toBeDefined()
    expect(SPANISH_B).toBeDefined()
  })

  it("offers BSB when nothing is downloaded", () => {
    expect(
      onDeviceSwitchTarget({
        catalog: CATALOG,
        failing: SPANISH_A!,
        bookId: "JHN",
        getState: () => NOT_DOWNLOADED,
      })?.id,
    ).toBe("BSB")
  })

  it("prefers a download in the failing translation's language", () => {
    const states = new Map([
      [FRENCH.id, downloaded(["JHN"])],
      [SPANISH_B!.id, downloaded(["JHN"])],
    ])
    expect(
      onDeviceSwitchTarget({
        catalog: CATALOG,
        failing: SPANISH_A!,
        bookId: "JHN",
        getState: (id) => states.get(id) ?? NOT_DOWNLOADED,
      })?.id,
    ).toBe(SPANISH_B!.id)
  })

  it("takes another language's download before BSB", () => {
    const states = new Map([[FRENCH.id, downloaded(["JHN"])]])
    expect(
      onDeviceSwitchTarget({
        catalog: CATALOG,
        failing: SPANISH_A!,
        bookId: "JHN",
        getState: (id) => states.get(id) ?? NOT_DOWNLOADED,
      })?.id,
    ).toBe(FRENCH.id)
  })

  it("skips a download that lacks the book", () => {
    const states = new Map([[SPANISH_B!.id, downloaded(["MAT"])]])
    expect(
      onDeviceSwitchTarget({
        catalog: CATALOG,
        failing: SPANISH_A!,
        bookId: "JHN",
        getState: (id) => states.get(id) ?? NOT_DOWNLOADED,
      })?.id,
    ).toBe("BSB")
  })

  it("offers nothing when BSB itself failed and nothing else is on the device", () => {
    expect(
      onDeviceSwitchTarget({
        catalog: CATALOG,
        failing: translation("BSB"),
        bookId: "JHN",
        getState: () => NOT_DOWNLOADED,
      }),
    ).toBeNull()
  })
})
