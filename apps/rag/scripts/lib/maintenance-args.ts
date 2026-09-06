import { RagOperationalError } from "../../src/contracts/index.js"

const invalidArgument = (message: string): RagOperationalError =>
  new RagOperationalError("argument_invalid", message)

const valueAfter = (argv: string[], flag: string): string | undefined => {
  const index = argv.indexOf(flag)
  const value = index < 0 ? undefined : argv[index + 1]
  return value?.startsWith("--") ? undefined : value
}

function validateArgs(
  argv: string[],
  values: readonly string[],
  booleans: readonly string[],
): void {
  const known = new Set([...values, ...booleans, "--production"])
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (!arg.startsWith("--"))
      throw invalidArgument(`unexpected argument '${arg}'`)
    if (!known.has(arg)) throw invalidArgument(`unknown flag '${arg}'`)
    if (booleans.includes(arg) && argv.indexOf(arg) !== index)
      throw invalidArgument(`${arg} may only be specified once`)
    if (values.includes(arg)) {
      const value = argv[++index]
      if (!value || value.startsWith("--"))
        throw invalidArgument(`${arg} requires a value`)
      if (argv.indexOf(arg) !== index - 1)
        throw invalidArgument(`${arg} may only be specified once`)
    }
  }
}

const positive = (argv: string[], flag: string): number | undefined => {
  const raw = valueAfter(argv, flag)
  if (raw === undefined) return undefined
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < 1)
    throw invalidArgument(`${flag} must be a positive integer`)
  return value
}

export type AcquireArgs = {
  all: boolean
  source?: string
  dryRun: boolean
  resume: boolean
  apply: boolean
}

export function parseAcquireArgs(argv: string[]): AcquireArgs {
  validateArgs(
    argv,
    ["--source"],
    ["--all", "--dry-run", "--resume", "--apply"],
  )
  const all = argv.includes("--all")
  const source = valueAfter(argv, "--source")
  if (all === Boolean(source))
    throw invalidArgument("use exactly one of --source <key> or --all")
  const apply = argv.includes("--apply")
  return {
    all,
    source,
    dryRun: !apply || argv.includes("--dry-run"),
    resume: argv.includes("--resume"),
    apply,
  }
}

export type IndexArgs = {
  all: boolean
  source?: string
  limit?: number
  concurrency: number
  force: boolean
  forceAll: boolean
  apply: boolean
}

export function parseIndexArgs(argv: string[]): IndexArgs {
  validateArgs(
    argv,
    ["--source", "--limit", "--concurrency"],
    ["--all", "--force", "--force-all", "--apply"],
  )
  const all = argv.includes("--all")
  const source = valueAfter(argv, "--source")
  if (all === Boolean(source))
    throw invalidArgument("use exactly one of --source <key> or --all")
  const concurrency = positive(argv, "--concurrency") ?? 4
  if (concurrency > 4) throw invalidArgument("--concurrency must be in 1..4")
  const forceAll = argv.includes("--force-all")
  const limit = positive(argv, "--limit")
  if (forceAll && limit !== undefined)
    throw invalidArgument(
      "--force-all cannot be combined with --limit; use --force for resumable bounded reindexing",
    )
  const apply = argv.includes("--apply")
  if (argv.includes("--production") && apply && limit === undefined)
    throw invalidArgument(
      "production indexing with --apply requires an explicit --limit",
    )
  return {
    all,
    source,
    limit,
    concurrency,
    force: argv.includes("--force") || forceAll,
    forceAll,
    apply,
  }
}

export type LanguageArgs =
  | {
      kind: "sweep"
      source?: string
      all: boolean
      mode: "blanks" | "full"
      limit?: number
      concurrency: number
      apply: boolean
      outDir?: string
      afterId?: string
    }
  | { kind: "revert"; changelog: string; apply: boolean; limit?: number }

export function parseLanguageArgs(argv: string[]): LanguageArgs {
  validateArgs(
    argv,
    [
      "--revert",
      "--source",
      "--mode",
      "--limit",
      "--concurrency",
      "--out-dir",
      "--after-id",
    ],
    ["--all", "--apply"],
  )
  const revert = valueAfter(argv, "--revert")
  if (revert) {
    const conflicting = [
      "--source",
      "--mode",
      "--concurrency",
      "--out-dir",
      "--after-id",
      "--all",
    ].find((flag) => argv.includes(flag))
    if (conflicting)
      throw invalidArgument(`${conflicting} cannot be combined with --revert`)
    const apply = argv.includes("--apply")
    const limit = positive(argv, "--limit")
    if (argv.includes("--production") && apply && limit === undefined)
      throw invalidArgument(
        "production language revert with --apply requires an explicit --limit",
      )
    return {
      kind: "revert",
      changelog: revert,
      apply,
      limit,
    }
  }
  const all = argv.includes("--all")
  const source = valueAfter(argv, "--source")
  if (all === Boolean(source))
    throw invalidArgument("use exactly one of --source <key> or --all")
  const mode = valueAfter(argv, "--mode") ?? "blanks"
  if (mode !== "blanks" && mode !== "full")
    throw invalidArgument("--mode must be blanks or full")
  const concurrency = positive(argv, "--concurrency") ?? 3
  if (concurrency > 4) throw invalidArgument("--concurrency must be in 1..4")
  const afterId = valueAfter(argv, "--after-id")
  if (all && afterId)
    throw invalidArgument(
      "--after-id requires --source; cursors are source-scoped",
    )
  const limit = positive(argv, "--limit")
  if (all && mode === "full" && limit !== undefined)
    throw invalidArgument(
      "--all --mode full cannot be combined with --limit; run each source with --after-id",
    )
  const apply = argv.includes("--apply")
  if (argv.includes("--production") && apply && all)
    throw invalidArgument(
      "production language sweep with --apply requires --source",
    )
  if (argv.includes("--production") && apply && limit === undefined)
    throw invalidArgument(
      "production language sweep with --apply requires an explicit --limit",
    )
  return {
    kind: "sweep",
    source,
    all,
    mode,
    limit,
    concurrency,
    apply,
    outDir: valueAfter(argv, "--out-dir"),
    afterId,
  }
}
