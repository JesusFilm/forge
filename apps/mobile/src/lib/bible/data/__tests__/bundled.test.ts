// The asset is mocked, the file is jest-expo's in-memory expo-file-system, and
// the bytes are the committed generated assets. bundled.ts keeps its real
// .bible requires, so importing it proves the jest transform handles them.
import { File } from "expo-file-system"

import { BIBLE_BOOKS } from "../../text/books"
import {
  BUNDLED_BSB_BOOKS,
  loadBundledBook,
  loadBundledCatalog,
} from "../bundled"

declare const __dirname: string
const fs = jest.requireActual<{
  readFileSync(path: string, encoding: "utf8"): string
}>("fs")

const ASSETS = `${__dirname}/../../../../../assets/bible`

type MockAsset = { downloadAsync: () => Promise<{ localUri: string | null }> }
const mockFromModule = jest.fn<MockAsset, [number]>()

jest.mock("expo-asset", () => ({
  Asset: { fromModule: (id: number) => mockFromModule(id) },
}))

function assetAt(localUri: string | null): MockAsset {
  return { downloadAsync: async () => ({ localUri }) }
}

function putFile(uri: string, text: string) {
  const file = new File(uri)
  file.create({ intermediates: true, overwrite: true })
  file.write(text)
}

beforeEach(() => {
  mockFromModule.mockReset()
})

describe("bundled BSB assets", () => {
  it("holds one real asset module per book, in canon order", () => {
    expect(Object.keys(BUNDLED_BSB_BOOKS)).toEqual(
      BIBLE_BOOKS.map((book) => book.usfm),
    )
    // jest-expo's asset transform turns each .bible require into a number.
    for (const moduleId of Object.values(BUNDLED_BSB_BOOKS)) {
      expect(typeof moduleId).toBe("number")
    }
  })

  it("loads John from its asset and returns 3:16", async () => {
    const uri = "file:///mock/bundle/assets/JHN.bible"
    putFile(uri, fs.readFileSync(`${ASSETS}/bsb/JHN.bible`, "utf8"))
    mockFromModule.mockReturnValue(assetAt(uri))

    const result = await loadBundledBook("JHN")

    expect(mockFromModule).toHaveBeenCalledWith(BUNDLED_BSB_BOOKS.JHN)
    if (result.status !== "ok") throw new Error(result.reason)
    expect(result.value.translationId).toBe("BSB")
    const verse = result.value.chapters
      .find((chapter) => chapter.number === 3)
      ?.verses.find((item) => item.number === 16)
    expect(verse?.lines.map((line) => line.text).join(" ")).toMatch(
      /^For God so loved the world/,
    )
  })

  it("returns a typed failure when the asset has no local file", async () => {
    mockFromModule.mockReturnValue(assetAt(null))
    await expect(loadBundledBook("JHN")).resolves.toEqual({
      status: "failed",
      reason: "asset-unavailable",
    })
  })

  it("returns a typed failure when the asset cannot download", async () => {
    mockFromModule.mockReturnValue({
      downloadAsync: () => Promise.reject(new Error("no update server")),
    })
    await expect(loadBundledBook("GEN")).resolves.toEqual({
      status: "failed",
      reason: "asset-unavailable",
    })
  })

  it("returns a typed failure when the file is missing", async () => {
    mockFromModule.mockReturnValue(assetAt("file:///mock/bundle/gone.bible"))
    await expect(loadBundledBook("GEN")).resolves.toEqual({
      status: "failed",
      reason: "read-failed",
    })
  })

  it("refuses a file that holds another book or bad text", async () => {
    const uri = "file:///mock/bundle/assets/wrong.bible"
    putFile(uri, fs.readFileSync(`${ASSETS}/bsb/JUD.bible`, "utf8"))
    mockFromModule.mockReturnValue(assetAt(uri))
    await expect(loadBundledBook("JHN")).resolves.toEqual({
      status: "failed",
      reason: "invalid-data",
    })

    putFile(uri, "{not json")
    await expect(loadBundledBook("JUD")).resolves.toEqual({
      status: "failed",
      reason: "invalid-data",
    })
  })
})

describe("bundled catalog", () => {
  it("loads the snapshot with BSB and the Russian Synodal Bible", async () => {
    const uri = "file:///mock/bundle/assets/catalog.bible"
    putFile(uri, fs.readFileSync(`${ASSETS}/catalog.bible`, "utf8"))
    mockFromModule.mockReturnValue(assetAt(uri))

    const result = await loadBundledCatalog()

    if (result.status !== "ok") throw new Error(result.reason)
    expect(result.value.byId.get("BSB")?.complete).toBe(true)
    expect(result.value.byId.get("rus_syn")?.books.has("PSA")).toBe(true)
  })

  it("returns a typed failure for a malformed snapshot", async () => {
    const uri = "file:///mock/bundle/assets/catalog.bible"
    putFile(uri, JSON.stringify({ formatVersion: 99, translations: [] }))
    mockFromModule.mockReturnValue(assetAt(uri))
    await expect(loadBundledCatalog()).resolves.toEqual({
      status: "failed",
      reason: "invalid-data",
    })
  })
})
