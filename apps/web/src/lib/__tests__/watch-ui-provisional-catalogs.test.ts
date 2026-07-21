import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
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
const translationPolicyPath = join(
  repoDir,
  "apps/web/scripts/ui-translation-policy.json",
)

type Inventory = {
  languages: Array<{ tag: string }>
}

type ProvisionalManifest = {
  metadata: {
    translation: {
      method: string
      model: string
      localeProvenance: Record<
        string,
        {
          model: string
          sourceDigest: string
          catalogDigest: string
          generatedOn: string
        }
      >
      approvedByUser: boolean
      reviewStatus: string
    }
  }
  summary: {
    inventoryLanguageTags: number
    authoredInventoryCatalogs: number
    machineTranslatedCatalogs: number
    provisionalCatalogs: number
    missingCatalogs: number
  }
  authoredInventoryLocales: string[]
  machineTranslatedLocales: string[]
  provisionalLocales: string[]
  existingNonInventoryLocales: string[]
  missingCatalogs: string[]
}

type MessageTree = { [key: string]: string | MessageTree }
type TranslationPolicy = {
  humanReviewedLocales: string[]
  intentionallyLocaleNeutral: string[]
  pendingTranslationPaths: string[]
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf-8")) as T
}

function catalogPath(locale: string): string {
  return join(messagesDir, `${locale}.json`)
}

function flattenCatalog(
  messages: MessageTree,
  flattened: Record<string, string> = {},
  path: string[] = [],
): Record<string, string> {
  for (const [key, value] of Object.entries(messages)) {
    if (typeof value === "string") {
      flattened[[...path, key].join(".")] = value
    } else {
      flattenCatalog(value, flattened, [...path, key])
    }
  }
  return flattened
}

function contentDigest(value: unknown): string {
  return createHash("sha256")
    .update(`${JSON.stringify(value, null, 2)}\n`)
    .digest("hex")
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
  const translationPolicy = readJson<TranslationPolicy>(translationPolicyPath)

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
      machineTranslatedCatalogs: manifest.machineTranslatedLocales.length,
      provisionalCatalogs: manifest.provisionalLocales.length,
      missingCatalogs: 0,
    })
    expect(
      manifest.authoredInventoryLocales.length +
        manifest.provisionalLocales.length,
    ).toBe(inventoryLocales.length)
  })

  it("keeps unresolved provisional catalogs seeded exactly from English", () => {
    const english = readFileSync(catalogPath("en"), "utf-8")
    expect(manifest.provisionalLocales).toEqual(["crk", "mey-Latn"])
    expect(manifest.summary.provisionalCatalogs).toBe(2)
    for (const locale of manifest.provisionalLocales) {
      expect(readFileSync(catalogPath(locale), "utf-8")).toBe(english)
    }
  })

  it("tracks every machine-translated catalog with current provenance", () => {
    const humanReviewedLocales = new Set(translationPolicy.humanReviewedLocales)
    const expectedMachineLocales = filesystemLocales.filter(
      (locale) =>
        !humanReviewedLocales.has(locale) &&
        !manifest.provisionalLocales.includes(locale),
    )
    expect(manifest.machineTranslatedLocales).toEqual(expectedMachineLocales)
    expect(manifest.metadata.translation).toMatchObject({
      method:
        "OpenAI contextual machine translation with localized phrase reuse",
      approvedByUser: true,
      reviewStatus: "machine-translated; native-speaker review recommended",
    })

    const pendingTranslationPaths = new Set(
      translationPolicy.pendingTranslationPaths,
    )
    const translatedSourceFlat = Object.fromEntries(
      Object.entries(
        flattenCatalog(readJson<MessageTree>(catalogPath("en"))),
      ).filter(([path]) => !pendingTranslationPaths.has(path)),
    )
    const sourceDigest = contentDigest({
      sourceFlat: translatedSourceFlat,
      translationPolicy: {
        humanReviewedLocales: [...translationPolicy.humanReviewedLocales].sort(
          (left, right) => left.localeCompare(right),
        ),
        intentionallyLocaleNeutral: [
          ...translationPolicy.intentionallyLocaleNeutral,
        ].sort(),
      },
    })

    expect(
      Object.keys(manifest.metadata.translation.localeProvenance).sort(
        (left, right) => left.localeCompare(right),
      ),
    ).toEqual(manifest.machineTranslatedLocales)
    for (const locale of manifest.machineTranslatedLocales) {
      const provenance = manifest.metadata.translation.localeProvenance[locale]
      expect(provenance.sourceDigest, locale).toBe(sourceDigest)
      expect(provenance.catalogDigest, locale).toBe(
        contentDigest(
          Object.fromEntries(
            Object.entries(
              flattenCatalog(readJson<MessageTree>(catalogPath(locale))),
            ).filter(([path]) => !pendingTranslationPaths.has(path)),
          ),
        ),
      )
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

  it("guards provisional refreshes, creates missing catalogs, and keeps checks read-only", () => {
    const fixtureDir = mkdtempSync(
      join(tmpdir(), "forge-provisional-catalogs-"),
    )
    const fixtureMessagesDir = join(fixtureDir, "messages")
    const fixtureInventoryPath = join(fixtureDir, "inventory.json")
    const fixtureManifestPath = join(fixtureDir, "manifest.json")
    const generatorPath = join(
      repoDir,
      "apps/web/scripts/generate-provisional-ui-catalogs.mjs",
    )
    const render = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`
    const source = { LanguagePickerModal: { seeAllLanguages: "Source" } }
    const staleProvisional = {
      LanguagePickerModal: { seeAllLanguages: "Stale provisional value" },
    }
    const authored = {
      LanguagePickerModal: { seeAllLanguages: "Valeur rédigée" },
    }
    const nonInventory = {
      LanguagePickerModal: { seeAllLanguages: "Halagang isinulat" },
    }

    try {
      mkdirSync(fixtureMessagesDir)
      writeFileSync(join(fixtureMessagesDir, "en.json"), render(source))
      writeFileSync(
        join(fixtureMessagesDir, "es.json"),
        render(staleProvisional),
      )
      writeFileSync(join(fixtureMessagesDir, "fr.json"), render(authored))
      writeFileSync(join(fixtureMessagesDir, "tl.json"), render(nonInventory))
      writeFileSync(
        fixtureInventoryPath,
        render({
          metadata: { source: "fixture", cldrVersion: "fixture" },
          languages: [
            { tag: "de" },
            { tag: "en" },
            { tag: "es" },
            { tag: "fr" },
          ],
        }),
      )
      writeFileSync(
        fixtureManifestPath,
        render({
          metadata: { generatedOn: "2026-07-16" },
          provisionalLocales: ["es"],
        }),
      )

      const args = [
        generatorPath,
        "--messages-dir",
        fixtureMessagesDir,
        "--inventory",
        fixtureInventoryPath,
        "--manifest",
        fixtureManifestPath,
        "--generated-on",
        "2026-07-16",
      ]
      const guardedWriteResult = spawnSync(process.execPath, args, {
        encoding: "utf-8",
      })
      expect(guardedWriteResult.status).not.toBe(0)
      expect(guardedWriteResult.stderr).toContain("--refresh-provisional")
      expect(readFileSync(join(fixtureMessagesDir, "es.json"), "utf-8")).toBe(
        render(staleProvisional),
      )
      expect(readFileSync(join(fixtureMessagesDir, "fr.json"), "utf-8")).toBe(
        render(authored),
      )
      expect(readFileSync(join(fixtureMessagesDir, "tl.json"), "utf-8")).toBe(
        render(nonInventory),
      )
      expect(readFileSync(fixtureManifestPath, "utf-8")).toContain(
        '"provisionalLocales": [\n    "es"\n  ]',
      )

      const writeResult = spawnSync(
        process.execPath,
        [...args, "--refresh-provisional"],
        { encoding: "utf-8" },
      )
      expect(writeResult.stderr).toBe("")
      expect(writeResult.status).toBe(0)
      expect(readFileSync(join(fixtureMessagesDir, "es.json"), "utf-8")).toBe(
        render(source),
      )
      expect(readFileSync(join(fixtureMessagesDir, "de.json"), "utf-8")).toBe(
        render(source),
      )
      expect(readFileSync(join(fixtureMessagesDir, "fr.json"), "utf-8")).toBe(
        render(authored),
      )
      expect(readFileSync(join(fixtureMessagesDir, "tl.json"), "utf-8")).toBe(
        render(nonInventory),
      )

      const snapshot = () => ({
        missing: readFileSync(join(fixtureMessagesDir, "de.json"), "utf-8"),
        provisional: readFileSync(join(fixtureMessagesDir, "es.json"), "utf-8"),
        authored: readFileSync(join(fixtureMessagesDir, "fr.json"), "utf-8"),
        nonInventory: readFileSync(
          join(fixtureMessagesDir, "tl.json"),
          "utf-8",
        ),
        manifest: readFileSync(fixtureManifestPath, "utf-8"),
      })
      const expectSnapshot = (before: ReturnType<typeof snapshot>) => {
        expect(snapshot()).toEqual(before)
      }

      const beforeValidCheck = snapshot()
      const validCheckResult = spawnSync(
        process.execPath,
        [...args, "--check"],
        { encoding: "utf-8" },
      )
      expect(validCheckResult.stderr).toBe("")
      expect(validCheckResult.status).toBe(0)
      expectSnapshot(beforeValidCheck)

      const validManifest = readFileSync(fixtureManifestPath, "utf-8")
      writeFileSync(
        fixtureManifestPath,
        validManifest.replace(
          "Missing inventory locales are provisional UI catalogs",
          "Stale manifest policy",
        ),
      )
      const beforeStaleManifestCheck = snapshot()
      const staleManifestCheckResult = spawnSync(
        process.execPath,
        [...args, "--check"],
        { encoding: "utf-8" },
      )
      expect(staleManifestCheckResult.status).not.toBe(0)
      expect(staleManifestCheckResult.stderr).toContain("is stale")
      expectSnapshot(beforeStaleManifestCheck)

      writeFileSync(fixtureManifestPath, validManifest)
      writeFileSync(
        join(fixtureMessagesDir, "es.json"),
        render(staleProvisional),
      )
      const beforeStaleCatalogCheck = snapshot()
      const staleCatalogCheckResult = spawnSync(
        process.execPath,
        [...args, "--check"],
        {
          encoding: "utf-8",
        },
      )
      expect(staleCatalogCheckResult.status).not.toBe(0)
      expect(staleCatalogCheckResult.stderr).toContain("does not match")
      expectSnapshot(beforeStaleCatalogCheck)
    } finally {
      rmSync(fixtureDir, { recursive: true, force: true })
    }
  })
})
