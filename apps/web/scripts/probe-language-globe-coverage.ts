import {
  getWatchLanguageIndex,
  languageGlobeCoverage,
} from "../src/lib/language-index"

const MINIMUM_ELIGIBLE_LANGUAGES = 12
const MINIMUM_REGIONS = 4

class LanguageGlobeCoverageError extends Error {
  override name = "LanguageGlobeCoverageError"
}

async function main() {
  const coverage = languageGlobeCoverage(await getWatchLanguageIndex())
  console.log(JSON.stringify(coverage, null, 2))

  if (
    coverage.eligibleLanguages < MINIMUM_ELIGIBLE_LANGUAGES ||
    coverage.regions.length < MINIMUM_REGIONS
  ) {
    throw new LanguageGlobeCoverageError(
      `Language globe coverage requires at least ${MINIMUM_ELIGIBLE_LANGUAGES} eligible languages across ${MINIMUM_REGIONS} regions.`,
    )
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
