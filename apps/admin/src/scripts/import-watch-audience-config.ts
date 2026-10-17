#!/usr/bin/env tsx
/**
 * Import a reviewed Watch audience configuration into the default template's
 * Experience DRAFT through the normal Experience service.
 *
 * Local fixtures only. Dry-run is the default: it reads, reports the diff and
 * writes nothing. `--apply` stages a draft (existing validation, revision
 * check, no publish); a human publishes it through the existing publish
 * control. The script refuses any DATABASE_URL that is not a local connection,
 * so it cannot reach production content.
 *
 * `--apply` goes through the service's Watch Audience write gate, so it is
 * refused while `forge.watch.audience` is off (set
 * FORGE_WATCH_AUDIENCE_DEFAULT=true locally). Dry-run is unaffected.
 *
 * Idempotent: the same configuration yields `unchanged` and writes nothing;
 * a changed one replaces the template's single `watchAudience` block in place.
 *
 * Usage:
 *   DATABASE_URL='postgresql://forge:forge@localhost:5433/forge_admin' \
 *   pnpm --filter @forge/admin exec tsx --env-file=.env \
 *     src/scripts/import-watch-audience-config.ts [--apply] [--locale en] \
 *     [--config src/scripts/fixtures/watch-audience-default.json]
 */

import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"
import { isDeepStrictEqual } from "node:util"
import {
  WatchAudienceConfigurationSchema,
  type WatchAudienceConfig,
} from "@forge/experience-schema"
import type { PrismaClient } from "@prisma/client"
import type { Principal } from "@/auth/principal"
import { BlocksSchema } from "@/domain/blocks"
import {
  ExperienceService,
  localeDraftRevision,
} from "@/services/experience.service"

export const WATCH_AUDIENCE_BLOCK_SECTION_KEY = "watch-audience"
export const DEFAULT_FIXTURE_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures/watch-audience-default.json",
)

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"])
const OPERATOR: Principal = { id: null, role: "ADMIN" }

/**
 * Allow-list, not deny-list: only a loopback host is accepted (a `host=` query
 * may only name a unix-socket directory), so a renamed or proxied production
 * host cannot pass.
 */
export function assertLocalDatabaseUrl(rawUrl: string | undefined): void {
  if (!rawUrl) throw new Error("DATABASE_URL is required.")
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    throw new Error("Refusing to run: DATABASE_URL is not parseable.")
  }
  const socketHost = parsed.searchParams.get("host")
  const local = LOCAL_HOSTS.has(parsed.hostname.toLowerCase())
  if (!local || (socketHost !== null && !socketHost.startsWith("/"))) {
    throw new Error(
      "[import-watch-audience-config] Refusing to run: DATABASE_URL is not a local database connection.",
    )
  }
}

export type WatchAudienceImportAction =
  | "create-block"
  | "update-block"
  | "unchanged"

export type WatchAudienceImportPlan = {
  action: WatchAudienceImportAction
  blocks: unknown[]
}

function isAudienceBlock(block: unknown): block is Record<string, unknown> {
  return (
    typeof block === "object" &&
    block !== null &&
    !Array.isArray(block) &&
    (block as Record<string, unknown>).t === "watchAudience"
  )
}

/**
 * Pure: the blocks the draft should hold. Refuses to choose between several
 * `watchAudience` blocks (the public projection rejects duplicates, so
 * silently editing one would hide the problem).
 */
export function planWatchAudienceImport(
  existing: readonly unknown[],
  configuration: WatchAudienceConfig,
): WatchAudienceImportPlan {
  const indexes = existing.flatMap((block, index) =>
    isAudienceBlock(block) ? [index] : [],
  )
  if (indexes.length > 1) {
    throw new Error(
      `The draft has ${indexes.length} watchAudience blocks; remove the extras before importing.`,
    )
  }
  const [index] = indexes
  if (index === undefined) {
    return {
      action: "create-block",
      blocks: [
        ...existing,
        {
          t: "watchAudience",
          sectionKey: WATCH_AUDIENCE_BLOCK_SECTION_KEY,
          configuration,
        },
      ],
    }
  }
  const current = existing[index] as Record<string, unknown>
  if (isDeepStrictEqual(current.configuration, configuration)) {
    return { action: "unchanged", blocks: [...existing] }
  }
  const blocks = [...existing]
  blocks[index] = { ...current, configuration }
  return { action: "update-block", blocks }
}

/** Dotted paths whose values differ, capped so a full replace stays readable. */
export function diffPaths(
  before: unknown,
  after: unknown,
  limit = 40,
): { paths: string[]; truncated: boolean } {
  const paths: string[] = []
  const walk = (a: unknown, b: unknown, path: string) => {
    if (paths.length > limit) return
    if (isDeepStrictEqual(a, b)) return
    const isObject = (value: unknown): value is Record<string, unknown> =>
      typeof value === "object" && value !== null
    if (isObject(a) && isObject(b) && Array.isArray(a) === Array.isArray(b)) {
      for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
        walk(a[key], b[key], path ? `${path}.${key}` : key)
      }
      return
    }
    paths.push(path || "(root)")
  }
  walk(before, after, "")
  return { paths: paths.slice(0, limit), truncated: paths.length > limit }
}

export type WatchAudienceImportReport = {
  event: "import-watch-audience-config"
  mode: "dry-run" | "apply"
  locale: string
  experienceLocaleId: string
  action: WatchAudienceImportAction
  hadDraft: boolean
  changedPaths: string[]
  truncated: boolean
  written: boolean
  published: false
}

export async function importWatchAudienceConfig({
  prisma,
  service = new ExperienceService(prisma),
  configuration,
  locale,
  apply,
}: {
  prisma: PrismaClient
  service?: Pick<ExperienceService, "getLocaleDraftState" | "updateLocaleDraft">
  configuration: WatchAudienceConfig
  locale: string
  apply: boolean
}): Promise<WatchAudienceImportReport> {
  // Same selection the public WatchSetting projection uses for the default
  // template: first non-archived template, deterministic order.
  const template = await prisma.experience.findFirst({
    where: { isTemplate: true, archivedAt: null },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    include: { locales: { where: { locale }, take: 1 } },
  })
  const row = template?.locales[0]
  if (!row) {
    throw new Error(
      `No non-archived default template has a "${locale}" locale; create it first (this script never creates templates).`,
    )
  }

  const state = await service.getLocaleDraftState({
    id: row.id,
    user: OPERATOR,
  })
  const existing = state.effective.blocks as unknown[]
  const plan = planWatchAudienceImport(existing, configuration)
  // Whole-array validation by the same schema the editor and publish use.
  BlocksSchema.parse(plan.blocks)

  const diff = diffPaths(existing, plan.blocks)
  let written = false
  if (apply && plan.action !== "unchanged") {
    await service.updateLocaleDraft({
      input: { id: row.id, blocks: plan.blocks },
      user: OPERATOR,
      expectedDraftRevision: state.activeDraft
        ? localeDraftRevision(state.activeDraft)
        : null,
    })
    written = true
  }
  return {
    event: "import-watch-audience-config",
    mode: apply ? "apply" : "dry-run",
    locale,
    experienceLocaleId: row.id,
    action: plan.action,
    hadDraft: state.activeDraft !== null,
    changedPaths: diff.paths,
    truncated: diff.truncated,
    written,
    published: false,
  }
}

type Options = { apply: boolean; locale: string; config: string }

export function parseArgs(argv: readonly string[]): Options {
  const options: Options = {
    apply: false,
    locale: "en",
    config: DEFAULT_FIXTURE_PATH,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === "--apply") options.apply = true
    else if (arg === "--locale" || arg === "--config") {
      const value = argv[(i += 1)]
      if (!value) throw new Error(`${arg} needs a value.`)
      options[arg === "--locale" ? "locale" : "config"] = value
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }
  return options
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))
  assertLocalDatabaseUrl(process.env.DATABASE_URL)
  const configuration = WatchAudienceConfigurationSchema.parse(
    JSON.parse(readFileSync(options.config, "utf8")),
  )
  const { prisma } = await import("@/db/client")
  try {
    const report = await importWatchAudienceConfig({
      prisma,
      configuration,
      locale: options.locale,
      apply: options.apply,
    })
    process.stdout.write(JSON.stringify(report) + "\n")
  } finally {
    await prisma.$disconnect()
  }
}

const isDirectInvoke =
  typeof process !== "undefined" &&
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])

if (isDirectInvoke) {
  main().catch((error) => {
    process.stderr.write(
      `[import-watch-audience-config] fatal: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
    )
    process.exit(1)
  })
}
