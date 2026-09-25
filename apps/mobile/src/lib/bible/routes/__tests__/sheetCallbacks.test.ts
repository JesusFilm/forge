/**
 * The reader controls that open a sheet (feat-551 U10, U11). Both hosts pass
 * `readerSheetCallbacks(router)` to BibleReader, so each control pushes the
 * U10 href for its sheet, and the download button opens U10's prompt.
 */
import { parseCatalog, type Catalog } from "../../data/catalog"
import { readerSheetHref } from "../../sheets/routes"
import type { VerseRef } from "../../versification/convert"
import {
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
  const presentDownload = jest.fn(async () => {})
  const callbacks = readerSheetCallbacks({ push }, { presentDownload })
  return { push, presentDownload, callbacks }
}

describe("readerSheetCallbacks", () => {
  it.each([
    ["onOpenPassagePicker", "passage"],
    ["onOpenTranslationPicker", "translation"],
    ["onOpenSettings", "settings"],
  ] as const)("%s pushes the %s sheet's href", (name, kind) => {
    const { push, presentDownload, callbacks } = setup()
    callbacks[name](CONTEXT)
    expect(push).toHaveBeenCalledTimes(1)
    expect(push).toHaveBeenCalledWith(readerSheetHref(kind, CONTEXT))
    expect(presentDownload).not.toHaveBeenCalled()
  })

  it("opens the download prompt for the shown translation, with no push", () => {
    const { push, presentDownload, callbacks } = setup()
    callbacks.onOpenDownload(CONTEXT)
    expect(presentDownload).toHaveBeenCalledTimes(1)
    expect(presentDownload).toHaveBeenCalledWith(CONTEXT)
    expect(push).not.toHaveBeenCalled()
  })

  it("keeps a rejected prompt from escaping as an unhandled rejection", async () => {
    const push = jest.fn()
    const presentDownload = jest.fn(() => Promise.reject(new Error("alert")))
    const unhandled = jest.fn()
    process.on("unhandledRejection", unhandled)
    try {
      readerSheetCallbacks({ push }, { presentDownload }).onOpenDownload(
        CONTEXT,
      )
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(presentDownload).toHaveBeenCalledTimes(1)
      expect(unhandled).not.toHaveBeenCalled()
    } finally {
      process.off("unhandledRejection", unhandled)
    }
  })
})
