import { spawn } from "node:child_process"
import { parseArgs } from "node:util"

const { values } = parseArgs({
  options: {
    "minified-path-prefix": { type: "string" },
    service: { type: "string" },
  },
})

const service = values.service
const minifiedPathPrefix = values["minified-path-prefix"]

if (!service || !minifiedPathPrefix) {
  console.error(
    "Usage: upload-datadog-sourcemaps --service <service> --minified-path-prefix <prefix>",
  )
  process.exit(1)
}

if (!process.env.DATADOG_API_KEY && !process.env.DD_API_KEY) {
  console.log(
    `Skipping ${service} Datadog sourcemap upload: DATADOG_API_KEY/DD_API_KEY is not set`,
  )
  process.exit(0)
}

const releaseVersion =
  process.env.DATADOG_RELEASE_VERSION ||
  process.env.NEXT_PUBLIC_DATADOG_VERSION ||
  process.env.RAILWAY_GIT_COMMIT_SHA ||
  process.env.VERCEL_GIT_COMMIT_SHA ||
  process.env.GIT_COMMIT_SHA

if (!releaseVersion) {
  console.error(
    `Skipping ${service} Datadog sourcemap upload: release version is not set`,
  )
  process.exit(1)
}

const child = spawn(
  "pnpm",
  [
    "dlx",
    "@datadog/datadog-ci@5.8.0",
    "sourcemaps",
    "upload",
    ".next/static",
    "--service",
    service,
    "--release-version",
    releaseVersion,
    "--minified-path-prefix",
    minifiedPathPrefix,
  ],
  { stdio: "inherit" },
)

child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`${service} Datadog sourcemap upload exited via ${signal}`)
    process.exit(1)
  }
  process.exit(code ?? 1)
})
