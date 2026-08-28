const valueAfter = (argv: string[], flag: string): string | undefined => {
  const index = argv.indexOf(flag)
  const value = index < 0 ? undefined : argv[index + 1]
  return value?.startsWith("--") ? undefined : value
}

const positive = (argv: string[], flag: string): number | undefined => {
  const raw = valueAfter(argv, flag)
  if (raw === undefined) return undefined
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < 1)
    throw new Error(`${flag} must be a positive integer`)
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
  const all = argv.includes("--all")
  const source = valueAfter(argv, "--source")
  if (all === Boolean(source))
    throw new Error("use exactly one of --source <key> or --all")
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
  source?: string
  limit?: number
  concurrency: number
  force: boolean
  forceAll: boolean
  apply: boolean
}

export function parseIndexArgs(argv: string[]): IndexArgs {
  const concurrency = positive(argv, "--concurrency") ?? 4
  if (concurrency > 4) throw new Error("--concurrency must be in 1..4")
  const forceAll = argv.includes("--force-all")
  return {
    source: valueAfter(argv, "--source"),
    limit: positive(argv, "--limit"),
    concurrency,
    force: argv.includes("--force") || forceAll,
    forceAll,
    apply: argv.includes("--apply"),
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
    }
  | { kind: "revert"; changelog: string; apply: boolean }

export function parseLanguageArgs(argv: string[]): LanguageArgs {
  const revert = valueAfter(argv, "--revert")
  if (revert)
    return {
      kind: "revert",
      changelog: revert,
      apply: argv.includes("--apply"),
    }
  const all = argv.includes("--all")
  const source = valueAfter(argv, "--source")
  if (all === Boolean(source))
    throw new Error("use exactly one of --source <key> or --all")
  const mode = valueAfter(argv, "--mode") ?? "blanks"
  if (mode !== "blanks" && mode !== "full")
    throw new Error("--mode must be blanks or full")
  const concurrency = positive(argv, "--concurrency") ?? 3
  if (concurrency > 4) throw new Error("--concurrency must be in 1..4")
  return {
    kind: "sweep",
    source,
    all,
    mode,
    limit: positive(argv, "--limit"),
    concurrency,
    apply: argv.includes("--apply"),
    outDir: valueAfter(argv, "--out-dir"),
  }
}
