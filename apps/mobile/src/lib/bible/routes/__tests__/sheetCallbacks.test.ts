/**
 * The reader controls that open a sheet (feat-553 U10, U11). Both hosts pass
 * `readerSheetCallbacks(router)` to BibleReader, so each control pushes the
 * U10 href for its sheet. The download button is on the translation sheet's
 * Current card (owner, 2026-10-01), and opens U10's prompt.
 */
import { parseCatalog, type Catalog } from "../../data/catalog"
import { readerSheetHref } from "../../sheets/routes"
import type { VerseRef } from "../../versification/convert"
import {
  openTranslationDownload,
  readerSheetCallbacks,
  type ReaderControlContext,
} from "../sheetCallbacks"

declare const __dirname: string
// No @types/node here; jest runs on Node, so the listener API exists.
declare const process: {
  on(event: "unhandledRejection", listener: (reason: unknown) => void): void
  off(event: "unhandledRejection", listener: (reason: unknown) => void): void
}
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

const SYNODAL = loadCatalog().byId.get("rus_syn")!

const CONTEXT: ReaderControlContext = {
  translation: SYNODAL,
  translationRef: { book: "PSA", chapter: 22, verse: 1 } as VerseRef,
  ref: { book: "PSA", chapter: 23, verse: 1 },
  offline: true,
}

function setup() {
  const push = jest.fn()
  const callbacks = readerSheetCallbacks({ push })
  return { push, callbacks }
}

describe("readerSheetCallbacks", () => {
  it.each([
    ["onOpenPassagePicker", "passage"],
    ["onOpenTranslationPicker", "translation"],
    ["onOpenSettings", "settings"],
  ] as const)("%s pushes the %s sheet's href", (name, kind) => {
    const { push, callbacks } = setup()
    callbacks[name](CONTEXT)
    expect(push).toHaveBeenCalledTimes(1)
    expect(push).toHaveBeenCalledWith(readerSheetHref(kind, CONTEXT))
  })

  it("has no download control: the button is on the translation sheet", () => {
    const { callbacks } = setup()
    expect(Object.keys(callbacks).sort()).toEqual([
      "onOpenPassagePicker",
      "onOpenSettings",
      "onOpenTranslationPicker",
    ])
  })
})

describe("openTranslationDownload", () => {
  it("opens the download prompt for the Current card's translation", () => {
    const presentDownload = jest.fn(async () => {})
    openTranslationDownload(SYNODAL, { presentDownload })
    expect(presentDownload).toHaveBeenCalledTimes(1)
    expect(presentDownload).toHaveBeenCalledWith({ translation: SYNODAL })
  })

  it("keeps a rejected prompt from escaping as an unhandled rejection", async () => {
    const presentDownload = jest.fn(() => Promise.reject(new Error("alert")))
    const unhandled = jest.fn()
    process.on("unhandledRejection", unhandled)
    try {
      openTranslationDownload(SYNODAL, { presentDownload })
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(presentDownload).toHaveBeenCalledTimes(1)
      expect(unhandled).not.toHaveBeenCalled()
    } finally {
      process.off("unhandledRejection", unhandled)
    }
  })
})
