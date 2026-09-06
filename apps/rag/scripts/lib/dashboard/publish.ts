import { createHash, randomUUID } from "node:crypto"
import {
  copyFile,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises"
import path from "node:path"
import { assertPublicDashboardSafe } from "./public-safety.js"
import { compiledDataSchema } from "./types.js"
import { assertHtmlContainsData } from "./verify.js"
import {
  withOwnedFileLock,
  type OwnedFileLockOptions,
} from "../owned-file-lock.js"

export interface DashboardPairPaths {
  json: string
  html: string
  marker: string
}
interface PublishOptions {
  afterFirstPublish?: () => void | Promise<void>
  lock?: OwnedFileLockOptions
}
const digest = (value: string): string =>
  createHash("sha256").update(value).digest("hex")

export function dashboardCommitMarker(json: string, html: string): string {
  return `${JSON.stringify({ schema_version: 1, json_sha256: digest(json), html_sha256: digest(html) }, null, 2)}\n`
}

export function assertDashboardPair(
  json: string,
  html: string,
  marker?: string,
): void {
  const parsed = JSON.parse(json)
  assertPublicDashboardSafe(parsed, "compiled-json")
  assertPublicDashboardSafe(html, "compiled-html", { allowDocument: true })
  const data = compiledDataSchema.parse(parsed)
  const misses = assertHtmlContainsData(html, data)
  if (misses.length > 0)
    throw new Error(`dashboard pair is inconsistent: ${misses.join("; ")}`)
  if (marker !== undefined && marker !== dashboardCommitMarker(json, html))
    throw new Error("dashboard commit marker does not match the JSON/HTML pair")
}

/** Publish under a lock; the last-written marker identifies a complete pair. */
export async function publishDashboardPair(
  paths: DashboardPairPaths,
  json: string,
  html: string,
  options: PublishOptions = {},
): Promise<void> {
  assertDashboardPair(json, html)
  const values = [json, html, dashboardCommitMarker(json, html)]
  const targets = [paths.json, paths.html, paths.marker]
  const suffix = randomUUID()
  const lock = `${paths.marker}.lock`
  const temps = targets.map((target) =>
    path.join(path.dirname(target), `.${path.basename(target)}.${suffix}.tmp`),
  )
  const backups = targets.map((target) => `${target}.${suffix}.bak`)
  const existed: boolean[] = []
  await Promise.all(
    targets.map((target) => mkdir(path.dirname(target), { recursive: true })),
  )
  await withOwnedFileLock(
    lock,
    async () => {
      await Promise.all(
        temps.map((temp, index) =>
          writeFile(temp, values[index]!, { encoding: "utf8", flag: "wx" }),
        ),
      )
      const staged = await Promise.all(
        temps.map((temp) => readFile(temp, "utf8")),
      )
      assertDashboardPair(staged[0]!, staged[1]!, staged[2]!)
      for (let index = 0; index < targets.length; index += 1) {
        try {
          await copyFile(targets[index]!, backups[index]!)
          existed[index] = true
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
          existed[index] = false
        }
      }
      try {
        await rename(temps[0]!, targets[0]!)
        await options.afterFirstPublish?.()
        await rename(temps[1]!, targets[1]!)
        await rename(temps[2]!, targets[2]!)
      } catch (error) {
        for (let index = 0; index < targets.length; index += 1)
          if (existed[index]) await copyFile(backups[index]!, targets[index]!)
          else await rm(targets[index]!, { force: true })
        throw error
      }
    },
    options.lock,
  ).finally(async () => {
    await Promise.all(
      [...temps, ...backups].map((file) => rm(file, { force: true })),
    )
  })
}
