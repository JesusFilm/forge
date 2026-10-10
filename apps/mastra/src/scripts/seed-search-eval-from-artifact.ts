import { readFile } from "node:fs/promises"
import { resolve } from "node:path"

import {
  importSearchEvalBaselineArtifact,
  type SearchEvalBaselineExportArtifact,
} from "../services/offline-search-eval/baseline-portability"
import { createSearchEvalArtifactStore } from "../services/offline-search-eval/artifacts"
import {
  searchEvalNativeEnvironmentLabel,
  syncSearchEvalReportToNativeEvaluation,
  withNativeMastraEvaluationProjection,
  type NativeSearchEvalMastra,
} from "../services/offline-search-eval/native-evaluation"

type CliOptions = {
  artifactPath?: string
  environmentLabel: string
  reportIds: string[]
  syncNative: boolean
}

function usage() {
  return [
    "Usage: pnpm --filter @forge/mastra seed:search-eval -- --artifact <export.json> [options]",
    "",
    "Options:",
    "  --artifact <path>             Required portable production export JSON.",
    "  --environment-label <label>   Local native eval label. Defaults to local.",
    "  --report-id <id>              Sync only this report id. Repeatable.",
    "  --no-native-sync              Import artifacts only; skip native DB sync.",
    "  --help                        Print this help text.",
  ].join("\n")
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    environmentLabel: "local",
    reportIds: [],
    syncNative: true,
  }

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (arg === "--") continue
    if (arg === "--help" || arg === "-h") {
      console.log(usage())
      process.exit(0)
    }
    if (arg === "--artifact") {
      options.artifactPath = requireValue(argv, ++index, arg)
      continue
    }
    if (arg === "--environment-label") {
      options.environmentLabel = requireValue(argv, ++index, arg)
      continue
    }
    if (arg === "--report-id") {
      options.reportIds.push(requireValue(argv, ++index, arg))
      continue
    }
    if (arg === "--no-native-sync") {
      options.syncNative = false
      continue
    }
    if (!arg.startsWith("-") && !options.artifactPath) {
      options.artifactPath = arg
      continue
    }
    throw new Error(`unknown argument: ${arg}`)
  }

  if (!options.artifactPath) {
    throw new Error("--artifact is required")
  }
  return options
}

function requireValue(argv: string[], index: number, flag: string) {
  const value = argv[index]
  if (!value || value.startsWith("-")) {
    throw new Error(`${flag} requires a value`)
  }
  return value
}

async function readArtifact(filePath: string) {
  const resolvedPath = resolve(filePath)
  const text = await readFile(resolvedPath, "utf8")
  return {
    path: resolvedPath,
    artifact: JSON.parse(text) as SearchEvalBaselineExportArtifact,
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const { path: artifactPath, artifact } = await readArtifact(
    options.artifactPath!,
  )
  const artifactStore = createSearchEvalArtifactStore()
  const imported = await importSearchEvalBaselineArtifact({
    artifact,
    options: { artifactStore },
  })
  const requestedReportIds =
    options.reportIds.length > 0 ? options.reportIds : imported.reportIds
  const environmentLabel = searchEvalNativeEnvironmentLabel(
    options.environmentLabel,
  )
  const syncedReports = []

  if (options.syncNative) {
    const { mastra } = await import("../mastra")
    for (const reportId of requestedReportIds) {
      const report = await artifactStore.readReport(reportId)
      const reportPath = `${artifactStore.rootDir.replace(/\/$/, "")}/reports/${report.reportId}.json`
      const synced = await syncSearchEvalReportToNativeEvaluation({
        mastra: mastra as unknown as NativeSearchEvalMastra,
        report,
        reportPath,
        environmentLabel,
      })
      const syncedReport = withNativeMastraEvaluationProjection(
        report,
        synced.projection,
      )
      await artifactStore.writeReport(syncedReport)
      syncedReports.push({
        reportId,
        reportPath,
        dataset: {
          datasetId: synced.dataset.datasetId,
          name: synced.dataset.name,
          status: synced.dataset.status,
          itemCount: synced.dataset.itemCount,
          createdItems: synced.dataset.createdItems,
          updatedItems: synced.dataset.updatedItems,
        },
        scorer: {
          scorerId: synced.scorer.scorerId,
          status: synced.scorer.status,
        },
        experiment: synced.experiment,
        totals: report.totals,
      })
    }
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        artifactPath,
        artifactRoot: artifactStore.rootDir,
        sourceEnvironment: artifact.sourceEnvironment,
        baselineName: imported.baselineName,
        importedReportIds: imported.reportIds,
        nativeSync: options.syncNative
          ? {
              environmentLabel,
              reportIds: requestedReportIds,
              syncedReports,
            }
          : null,
        audit: imported.audit,
      },
      null,
      2,
    ),
  )
}

main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(
      JSON.stringify(
        {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        },
        null,
        2,
      ),
    )
    console.error(usage())
    process.exit(1)
  },
)
