import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { prodStatusDataSchema } from "./lib/dashboard/types.js"

const SNAPSHOT = path.resolve(
  import.meta.dirname,
  "..",
  "dashboard",
  "prod-status-data.json",
)
const CREDENTIAL_KEY =
  /(password|passwd|token|secret|credential|database_?url|connection_?string)/i
const CREDENTIAL_VALUE =
  /postgres(?:ql)?:\/\/|:\/\/[^\s/:@]+:[^\s/@]+@|(?:password|token|secret|credential)\s*[:=]/i

/** Validate the ignored production snapshot without returning or printing its data. */
export function validateDashboardSnapshot(raw: string): void {
  const data: unknown = JSON.parse(raw)
  prodStatusDataSchema.parse(data)

  const inspect = (value: unknown, trail: string[]): void => {
    if (typeof value === "string" && CREDENTIAL_VALUE.test(value)) {
      throw new Error(`credential-like value at ${trail.join(".")}`)
    }
    if (Array.isArray(value)) {
      value.forEach((entry, index) => inspect(entry, [...trail, String(index)]))
      return
    }
    if (value && typeof value === "object") {
      for (const [key, entry] of Object.entries(value)) {
        if (CREDENTIAL_KEY.test(key))
          throw new Error(
            `credential-like field at ${[...trail, key].join(".")}`,
          )
        inspect(entry, [...trail, key])
      }
    }
  }

  inspect(data, ["snapshot"])
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    validateDashboardSnapshot(readFileSync(SNAPSHOT, "utf8"))
    console.log(
      "✔ production dashboard snapshot schema and credential scan passed",
    )
  } catch {
    console.error(
      "✖ production dashboard snapshot validation failed; contents were not printed",
    )
    process.exitCode = 1
  }
}
