import { parseArgs } from "node:util"
import { pathToFileURL } from "node:url"
import {
  diagnoseRecommendationCoverage,
  RecommendationCoverageInput,
} from "@/services/recommendations/coverage-diagnostics"

export function parseCoverageArgs(args: string[]) {
  const { values } = parseArgs({
    args,
    options: {
      seed: { type: "string" },
      locale: { type: "string" },
      audio: { type: "string" },
      help: { type: "boolean" },
    },
    strict: true,
    allowPositionals: false,
  })
  if (values.help) return null
  return RecommendationCoverageInput.parse({
    seedMediaId: values.seed,
    locale: values.locale,
    audioLanguageSlug: values.audio,
  })
}

async function main() {
  const input = parseCoverageArgs(process.argv.slice(2))
  if (input === null) {
    console.log(
      "recommendations:coverage --seed <Admin video ID> --locale <exact locale> --audio <exact language slug>\n" +
        "Reads DATABASE_URL. Prints current inventory only; does not write data or issue recommendations.",
    )
    return
  }
  const { env } = await import("@/config/env")
  const report = await diagnoseRecommendationCoverage(env.DATABASE_URL, input)
  console.log(JSON.stringify(report, null, 2))
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch(() => {
    // Database errors may contain connection strings or request parameters.
    console.error(
      "Coverage diagnostic failed. Check arguments, database access, active embedding contract, and the five-second query limit.",
    )
    process.exitCode = 1
  })
}
