import { readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const appDir = resolve(scriptDir, "..")
const repoDir = resolve(appDir, "../..")

export const OFFICIAL_LANGUAGE_STATUSES = Object.freeze([
  "de_facto_official",
  "official",
  "official_minority",
  "official_regional",
])

const COUNTRY_CODE_ALIASES = Object.freeze({
  "Hong Kong": "HK",
  Macao: "MO",
  Palestine: "PS",
})

function argValue(name, fallback) {
  const index = process.argv.indexOf(name)
  if (index === -1) return fallback
  const value = process.argv[index + 1]
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${name}`)
  }
  return value
}

export function normalizeLanguageTag(tag) {
  return tag
    .replaceAll("_", "-")
    .split("-")
    .map((part, index) => {
      if (index === 0) return part.toLowerCase()
      if (/^[a-z]{4}$/i.test(part)) {
        return part[0].toUpperCase() + part.slice(1).toLowerCase()
      }
      if (/^[a-z]{2}$/i.test(part)) return part.toUpperCase()
      return part.toLowerCase()
    })
    .join("-")
}

export function parseCountryCsv(text) {
  const [header, ...rows] = text
    .split(/\r?\n/)
    .map((row) => row.trim())
    .filter(Boolean)

  if (header !== "Country") {
    throw new Error(`Expected country CSV header "Country", got "${header}"`)
  }

  return [...new Set(rows)]
}

function regionNameMap(territoryInfo) {
  const displayNames = new Intl.DisplayNames(["en"], { type: "region" })
  const map = new Map()

  for (const code of Object.keys(territoryInfo).sort()) {
    if (!/^[A-Z]{2}$/.test(code)) continue
    const name = displayNames.of(code)
    if (name) map.set(name, code)
  }

  return map
}

export function resolveCountryCode(countryName, territoryInfo) {
  if (Object.hasOwn(COUNTRY_CODE_ALIASES, countryName)) {
    return COUNTRY_CODE_ALIASES[countryName]
  }

  return regionNameMap(territoryInfo).get(countryName) ?? null
}

export function officialLanguagesForTerritory(territory) {
  const languagePopulation = territory.languagePopulation ?? {}

  return Object.entries(languagePopulation)
    .flatMap(([rawTag, details]) => {
      const officialStatus = details._officialStatus
      if (!OFFICIAL_LANGUAGE_STATUSES.includes(officialStatus)) return []

      return [
        {
          tag: normalizeLanguageTag(rawTag),
          cldrTag: rawTag,
          officialStatus,
          populationPercent: details._populationPercent ?? null,
          writingPercent: details._writingPercent ?? null,
        },
      ]
    })
    .sort((a, b) => a.tag.localeCompare(b.tag))
}

export function generateInventory({
  countries,
  cldrData,
  countryInput = "docs/i18n/watch-ui-ga4-countries.csv",
  generatedOn,
}) {
  const territoryInfo = cldrData.supplemental?.territoryInfo
  if (!territoryInfo || typeof territoryInfo !== "object") {
    throw new Error("CLDR data is missing supplemental.territoryInfo")
  }

  const countryRows = []
  const unmappedCountries = []
  const languages = new Map()

  for (const country of countries) {
    const territoryCode = resolveCountryCode(country, territoryInfo)
    if (!territoryCode || !territoryInfo[territoryCode]) {
      unmappedCountries.push({
        name: country,
        reason: "No CLDR territory code mapping",
      })
      continue
    }

    const officialLanguages = officialLanguagesForTerritory(
      territoryInfo[territoryCode],
    )

    countryRows.push({
      name: country,
      territoryCode,
      officialLanguages,
    })

    for (const language of officialLanguages) {
      const existing = languages.get(language.tag) ?? {
        tag: language.tag,
        cldrTags: new Set(),
        officialStatuses: new Set(),
        countries: [],
      }
      existing.cldrTags.add(language.cldrTag)
      existing.officialStatuses.add(language.officialStatus)
      existing.countries.push({
        name: country,
        territoryCode,
        officialStatus: language.officialStatus,
      })
      languages.set(language.tag, existing)
    }
  }

  const languageRows = [...languages.values()]
    .map((language) => ({
      tag: language.tag,
      cldrTags: [...language.cldrTags].sort(),
      officialStatuses: [...language.officialStatuses].sort(),
      countryCount: language.countries.length,
      countries: language.countries.sort((a, b) =>
        a.name.localeCompare(b.name),
      ),
    }))
    .sort((a, b) => a.tag.localeCompare(b.tag))

  countryRows.sort((a, b) => a.name.localeCompare(b.name))

  return {
    metadata: {
      source: "Unicode CLDR supplemental territoryInfo",
      sourceUrl:
        "https://github.com/unicode-org/cldr-json/blob/main/cldr-json/cldr-core/supplemental/territoryInfo.json",
      cldrVersion: cldrData.supplemental.version?._cldrVersion ?? null,
      unicodeVersion: cldrData.supplemental.version?._unicodeVersion ?? null,
      countryInput,
      generatedOn,
      officialStatuses: OFFICIAL_LANGUAGE_STATUSES,
    },
    summary: {
      countriesInput: countries.length,
      countriesMapped: countryRows.length,
      countriesUnmapped: unmappedCountries.length,
      uniqueOfficialLanguageTags: languageRows.length,
    },
    countries: countryRows,
    languages: languageRows,
    unmappedCountries,
  }
}

function main() {
  const countriesPath = resolve(
    repoDir,
    argValue("--countries", "docs/i18n/watch-ui-ga4-countries.csv"),
  )
  const cldrPath = resolve(
    repoDir,
    argValue("--cldr", "apps/web/data/watch-ui/cldr-territory-info-v48.json"),
  )
  const outPath = resolve(
    repoDir,
    argValue("--out", "docs/i18n/watch-ui-official-language-inventory.json"),
  )
  const generatedOn = argValue(
    "--generated-on",
    new Date().toISOString().slice(0, 10),
  )

  const countries = parseCountryCsv(readFileSync(countriesPath, "utf-8"))
  const cldrData = JSON.parse(readFileSync(cldrPath, "utf-8"))
  const inventory = generateInventory({
    countries,
    cldrData,
    countryInput: "docs/i18n/watch-ui-ga4-countries.csv",
    generatedOn,
  })

  writeFileSync(outPath, `${JSON.stringify(inventory, null, 2)}\n`)
  console.log(
    `Wrote ${outPath} with ${inventory.summary.uniqueOfficialLanguageTags} official language tags across ${inventory.summary.countriesMapped} mapped countries.`,
  )
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
}
