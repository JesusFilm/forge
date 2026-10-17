import { pathToFileURL } from "node:url"
import { constants } from "node:fs"
import { open } from "node:fs/promises"
import { z } from "zod"
import {
  RecommendationConflictError,
  RecommendationInputError,
} from "../services/recommendations/errors"
import {
  assertCowatchSourceWindow,
  COWATCH_SOURCE_WINDOW_VERSION,
  type CowatchSourceWindow,
} from "../services/recommendations/cowatch/source-window"
import {
  parseCowatchPublicationAdmission,
  type CowatchPublicationAdmission,
} from "../services/recommendations/cowatch/projection.service"

const VALUE_OPTIONS = new Set([
  "--window-start",
  "--window-end",
  "--evaluation-as-of",
  "--admission-file",
])
const MAX_ADMISSION_FILE_BYTES = 16_384

const FAILURE_CODES: Readonly<Record<string, string>> = {
  "57014": "database_timeout",
  "55P03": "database_lock_timeout",
  "53300": "database_capacity",
  "53200": "database_capacity",
  "53400": "database_capacity",
  "28P01": "database_authentication",
  "28000": "database_authentication",
  "42501": "database_permission",
  "42P01": "database_schema",
  "42703": "database_schema",
  "40001": "database_concurrency",
  "40P01": "database_concurrency",
  ECONNREFUSED: "database_connection",
  ECONNRESET: "database_connection",
  ENOTFOUND: "database_connection",
  EHOSTUNREACH: "database_connection",
  ETIMEDOUT: "database_timeout",
  SELF_SIGNED_CERT_IN_CHAIN: "database_tls",
  DEPTH_ZERO_SELF_SIGNED_CERT: "database_tls",
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: "database_tls",
  CERT_HAS_EXPIRED: "database_tls",
  ERR_TLS_CERT_ALTNAME_INVALID: "database_tls",
}

/** Fixed classifications only: errors can contain SQL, identities or credentials. */
export function cowatchRebuildFailureReceipt(error: unknown) {
  let category = "unknown"
  try {
    if (error instanceof RecommendationInputError) category = "invalid_input"
    else if (error instanceof RecommendationConflictError) category = "conflict"
  } catch {
    // Even a hostile error proxy must not replace the original CLI failure.
  }
  let code: string | null = null
  const pending: unknown[] = [error]
  const visited = new Set<unknown>()
  function field(value: object, key: string): unknown {
    try {
      return Object.getOwnPropertyDescriptor(value, key)?.value
    } catch {
      return undefined
    }
  }
  for (let inspected = 0; pending.length && inspected < 12; inspected++) {
    const current = pending.shift()
    if (!current || typeof current !== "object" || visited.has(current))
      continue
    visited.add(current)
    for (const key of ["code", "originalCode"]) {
      const candidate = field(current, key)
      if (typeof candidate !== "string") continue
      if (Object.hasOwn(FAILURE_CODES, candidate)) {
        return {
          status: "failed" as const,
          category: FAILURE_CODES[candidate],
          code: candidate,
          diagnosticsRedacted: true,
        }
      }
      if (code === null && /^P\d{4}$/.test(candidate)) {
        category = "database_error"
        code = candidate
      }
    }
    if (
      field(current, "message") ===
      "The server does not support SSL connections"
    )
      category = "database_tls_unavailable"
    for (const key of ["cause", "meta", "driverAdapterError"])
      pending.push(field(current, key))
  }
  if (category === "database_error" && code) {
    const prismaCategories: Readonly<Record<string, string>> = {
      P1000: "database_authentication",
      P1001: "database_connection",
      P1002: "database_timeout",
      P1010: "database_permission",
      P1011: "database_tls",
      P2021: "database_schema",
      P2022: "database_schema",
      P2024: "database_pool_timeout",
      P2037: "database_capacity",
    }
    category = prismaCategories[code] ?? category
  }
  return {
    status: "failed" as const,
    category,
    code,
    diagnosticsRedacted: true,
  }
}

export function parseCowatchRebuildArguments(
  argv: readonly string[],
  now: Date,
) {
  const values = new Map<string, string>()
  let execute = false
  for (let index = 0; index < argv.length; index++) {
    const key = argv[index]
    if (key === "--execute") {
      if (execute) throw new RecommendationInputError("Duplicate --execute")
      execute = true
      continue
    }
    const value = argv[index + 1]
    if (
      !VALUE_OPTIONS.has(key) ||
      values.has(key) ||
      !value ||
      value.startsWith("--")
    ) {
      throw new RecommendationInputError(
        "Unknown, duplicate or incomplete co-watch rebuild option",
      )
    }
    values.set(key, value)
    index++
  }
  if (
    !["--window-start", "--window-end", "--evaluation-as-of"].every((key) =>
      values.has(key),
    )
  ) {
    throw new RecommendationInputError(
      "Required: --window-start ISO --window-end ISO --evaluation-as-of ISO; add --execute to publish",
    )
  }
  function timestamp(key: string) {
    const value = values.get(key)!
    if (
      !z.iso.datetime({ offset: true }).safeParse(value).success ||
      /\.\d{4,}/.test(value)
    ) {
      throw new RecommendationInputError(
        `${key} must be an ISO timestamp with a timezone and at most millisecond precision`,
      )
    }
    return new Date(value)
  }
  const sourceWindow: CowatchSourceWindow = {
    version: COWATCH_SOURCE_WINDOW_VERSION,
    windowStart: timestamp("--window-start"),
    windowEnd: timestamp("--window-end"),
    evaluationAsOf: timestamp("--evaluation-as-of"),
  }
  assertCowatchSourceWindow(sourceWindow, now)
  const admissionFile = values.get("--admission-file")
  if (
    admissionFile !== undefined &&
    (!execute || admissionFile.length > 4096 || admissionFile.includes("\0"))
  )
    throw new RecommendationInputError(
      "A valid --admission-file requires --execute",
    )
  return { execute, sourceWindow, admissionFile }
}

async function readPublicationAdmission(
  path: string,
  now: Date,
  sourceWindow: CowatchSourceWindow,
) {
  // NONBLOCK prevents a named pipe from blocking before the regular-file check.
  // Read at most bound+1 even if the file grows after stat.
  const file = await open(
    path,
    constants.O_RDONLY | constants.O_NONBLOCK,
  ).catch(() => {
    throw new RecommendationInputError("Cannot read publication admission file")
  })
  try {
    const stat = await file.stat()
    if (
      !stat.isFile() ||
      stat.size === 0 ||
      stat.size > MAX_ADMISSION_FILE_BYTES
    )
      throw new RecommendationInputError("Invalid publication admission file")
    const buffer = Buffer.alloc(MAX_ADMISSION_FILE_BYTES + 1)
    let length = 0
    while (length < buffer.length) {
      const { bytesRead } = await file.read(
        buffer,
        length,
        buffer.length - length,
        null,
      )
      if (bytesRead === 0) break
      length += bytesRead
    }
    if (length > MAX_ADMISSION_FILE_BYTES)
      throw new RecommendationInputError(
        "Publication admission file exceeds bound",
      )
    return parseCowatchPublicationAdmission(
      JSON.parse(buffer.subarray(0, length).toString("utf8")),
      now,
      sourceWindow,
    )
  } catch {
    throw new RecommendationInputError("Invalid publication admission file")
  } finally {
    await file.close()
  }
}

async function loadRuntime() {
  const { prisma } = await import("../db/client")
  const { preflightCowatchShadowGeneration, publishCowatchShadowGeneration } =
    await import("../services/recommendations/cowatch/projection.service")
  return {
    preflight: (now: Date, scope: CowatchSourceWindow) =>
      preflightCowatchShadowGeneration(prisma, now, scope),
    publish: (
      now: Date,
      scope: CowatchSourceWindow,
      admission?: CowatchPublicationAdmission,
    ) => publishCowatchShadowGeneration(prisma, now, scope, admission),
    disconnect: () => prisma.$disconnect(),
  }
}

export async function runCowatchRebuildCli(
  argv: readonly string[],
  options: {
    now?: () => Date
    write?: (receipt: string) => void
    loadRuntime?: typeof loadRuntime
  } = {},
) {
  const now = (options.now ?? (() => new Date()))()
  const input = parseCowatchRebuildArguments(argv, now)
  const admission = input.admissionFile
    ? await readPublicationAdmission(
        input.admissionFile,
        now,
        input.sourceWindow,
      )
    : undefined
  const runtime = await (options.loadRuntime ?? loadRuntime)()
  try {
    const result = input.execute
      ? admission
        ? await runtime.publish(now, input.sourceWindow, admission)
        : await runtime.publish(now, input.sourceWindow)
      : await runtime.preflight(now, input.sourceWindow)
    // Aggregate-only output; no session, profile, episode or outcome identities.
    const write = options.write ?? ((receipt) => process.stdout.write(receipt))
    write(`${JSON.stringify(result)}\n`)
    return result
  } finally {
    await runtime.disconnect()
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  void runCowatchRebuildCli(process.argv.slice(2))
    .then((result) => {
      if (
        result.status === "source_overflow" ||
        result.status === "work_overflow" ||
        result.status === "admission_refused"
      )
        process.exitCode = 2
    })
    .catch((error: unknown) => {
      process.stdout.write(
        `${JSON.stringify(cowatchRebuildFailureReceipt(error))}\n`,
      )
      process.exitCode = 1
    })
}
