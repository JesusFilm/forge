import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { AVAILABLE_UI_LOCALES } from "@/i18n/generated-ui-locales"

const repoDir = join(__dirname, "../../../../..")
const messagesDir = join(repoDir, "apps/web/messages")
const inventoryPath = join(
  repoDir,
  "docs/i18n/watch-ui-official-language-inventory.json",
)
const provisionalManifestPath = join(
  repoDir,
  "docs/i18n/watch-ui-provisional-catalogs.json",
)

type Inventory = {
  languages: Array<{ tag: string }>
}

type ProvisionalManifest = {
  summary: {
    inventoryLanguageTags: number
    authoredInventoryCatalogs: number
    provisionalCatalogs: number
    missingCatalogs: number
  }
  authoredInventoryLocales: string[]
  provisionalLocales: string[]
  missingCatalogs: string[]
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf-8")) as T
}

function catalogPath(locale: string): string {
  return join(messagesDir, `${locale}.json`)
}

describe("watch UI provisional official-language catalogs", () => {
  const inventoryLocales = readJson<Inventory>(inventoryPath)
    .languages.map((language) => language.tag)
    .sort((a, b) => a.localeCompare(b))
  const filesystemLocales = readdirSync(messagesDir)
    .filter((file) => file.endsWith(".json"))
    .map((file) => file.slice(0, -5))
    .sort((a, b) => a.localeCompare(b))
  const manifest = readJson<ProvisionalManifest>(provisionalManifestPath)

  it("has a message catalog for every inventory language", () => {
    expect(filesystemLocales).toEqual(expect.arrayContaining(inventoryLocales))
    expect(manifest.missingCatalogs).toEqual([])
  })

  it("admits every inventory language into generated UI locale membership", () => {
    expect([...AVAILABLE_UI_LOCALES]).toEqual(
      expect.arrayContaining(inventoryLocales),
    )
  })

  it("keeps the provisional manifest counts aligned with the inventory", () => {
    expect(manifest.summary).toMatchObject({
      inventoryLanguageTags: inventoryLocales.length,
      authoredInventoryCatalogs: manifest.authoredInventoryLocales.length,
      provisionalCatalogs: manifest.provisionalLocales.length,
      missingCatalogs: 0,
    })
    expect(
      manifest.authoredInventoryLocales.length +
        manifest.provisionalLocales.length,
    ).toBe(inventoryLocales.length)
  })

  it("keeps provisional catalogs seeded exactly from English", () => {
    const english = readFileSync(catalogPath("en"), "utf-8")
    for (const locale of manifest.provisionalLocales) {
      expect(readFileSync(catalogPath(locale), "utf-8")).toBe(english)
    }
  })

  it("does not mark existing authored catalogs as provisional", () => {
    expect(manifest.authoredInventoryLocales).toEqual(
      expect.arrayContaining([
        "ar",
        "bn",
        "de",
        "en",
        "es",
        "fr",
        "it",
        "nl",
        "pl",
        "ro",
      ]),
    )
    expect(manifest.provisionalLocales).not.toContain("bn")
    expect(manifest.provisionalLocales).not.toContain("ro")
  })
})
