#!/usr/bin/env tsx
/**
 * Partner API key CLI — operator surface for issuing, listing, revoking,
 * and rotating partner search-API bearers.
 *
 * Subcommands (kubectl-style; first non-flag arg picks the subcommand):
 *
 *   create  --name=<label> --owner-email=<email> [--note=<text>] [--operator-email=<email>]
 *     Issues a fresh `jfp_search_*` token. Prints the plaintext exactly
 *     once to STDERR with a save-this banner. Structured JSON event on
 *     STDOUT carries no plaintext.
 *
 *   list  [--include-revoked]
 *     Prints one `partner-key.listed` event per row. Default hides
 *     revoked keys.
 *
 *   revoke <keyId> [--operator-email=<email>]
 *     Idempotent — already-revoked keys exit 0 with the existing record.
 *
 *   rotate <keyId> [--operator-email=<email>]
 *     Issues a fresh key for the same partner. Old key stays active so
 *     the partner can cutover; operator runs `revoke <oldKeyId>` after
 *     observing the new key's lastUsedAt in logs.
 *
 * Exit codes:
 *   0   — success
 *   1   — runtime failure (at least one item failed; details on stderr)
 *   2   — argv / config error before any DB work
 *   130 — SIGINT/SIGTERM
 *
 * `--operator-email` maps to `createdById` / `revokedById` via a lookup
 * on `User.email`. Missing email logs a warning to stderr and proceeds
 * with `null` FK (matches the SetNull cascade on the model).
 */

// -----------------------------------------------------------------------------
// argv helpers — mirror run-embeds.ts / trigger-enrichment.ts conventions
// -----------------------------------------------------------------------------

function parseSingle(
  argv: readonly string[],
  name: string,
): string | undefined {
  const flag = `--${name}=`
  const arg = argv.find((a) => a.startsWith(flag))
  return arg ? arg.slice(flag.length) : undefined
}

function parseFlag(argv: readonly string[], name: string): boolean {
  return argv.includes(`--${name}`)
}

/** First non-flag arg (typically the subcommand). */
function parsePositional(argv: readonly string[]): string[] {
  return argv.filter((a) => !a.startsWith("--"))
}

// -----------------------------------------------------------------------------
// Config shape — exported for tests
// -----------------------------------------------------------------------------

export type Subcommand = "create" | "list" | "revoke" | "rotate"

export type CliConfig =
  | {
      subcommand: "create"
      name: string
      ownerEmail: string
      note: string | null
      operatorEmail: string | null
    }
  | {
      subcommand: "list"
      includeRevoked: boolean
    }
  | {
      subcommand: "revoke"
      keyId: string
      operatorEmail: string | null
    }
  | {
      subcommand: "rotate"
      keyId: string
      operatorEmail: string | null
    }

export class CliConfigError extends Error {
  constructor(
    message: string,
    readonly exitCode: 2 = 2,
  ) {
    super(message)
    this.name = "CliConfigError"
  }
}

const SUBCOMMANDS: readonly Subcommand[] = [
  "create",
  "list",
  "revoke",
  "rotate",
]

function isSubcommand(v: string): v is Subcommand {
  return (SUBCOMMANDS as readonly string[]).includes(v)
}

/**
 * Pure argv → config transform. Exported so tests can exercise every
 * subcommand without instantiating Prisma or hitting the service layer.
 * Throws `CliConfigError` on any argv-parsing problem; the caller maps
 * to exit code 2.
 */
export function parseArgvToConfig(argv: readonly string[]): CliConfig {
  const positionals = parsePositional(argv)
  const subcommandArg = positionals[0]
  if (!subcommandArg) {
    throw new CliConfigError(
      `[partner-keys] subcommand required (one of: ${SUBCOMMANDS.join(", ")})`,
    )
  }
  if (!isSubcommand(subcommandArg)) {
    throw new CliConfigError(
      `[partner-keys] unknown subcommand '${subcommandArg}'; expected one of: ${SUBCOMMANDS.join(", ")}`,
    )
  }

  const operatorEmail = parseSingle(argv, "operator-email") ?? null

  switch (subcommandArg) {
    case "create": {
      const name = parseSingle(argv, "name")
      const ownerEmail = parseSingle(argv, "owner-email")
      if (!name) {
        throw new CliConfigError(
          "[partner-keys] create: --name=<label> is required",
        )
      }
      if (!ownerEmail) {
        throw new CliConfigError(
          "[partner-keys] create: --owner-email=<email> is required",
        )
      }
      const note = parseSingle(argv, "note") ?? null
      return {
        subcommand: "create",
        name,
        ownerEmail,
        note,
        operatorEmail,
      }
    }

    case "list": {
      return {
        subcommand: "list",
        includeRevoked: parseFlag(argv, "include-revoked"),
      }
    }

    case "revoke": {
      const keyId = positionals[1]
      if (!keyId) {
        throw new CliConfigError(
          "[partner-keys] revoke: positional <keyId> is required",
        )
      }
      return {
        subcommand: "revoke",
        keyId,
        operatorEmail,
      }
    }

    case "rotate": {
      const keyId = positionals[1]
      if (!keyId) {
        throw new CliConfigError(
          "[partner-keys] rotate: positional <keyId> is required",
        )
      }
      return {
        subcommand: "rotate",
        keyId,
        operatorEmail,
      }
    }
  }
}

// -----------------------------------------------------------------------------
// Output helpers — exported for tests
// -----------------------------------------------------------------------------

/**
 * Emit the "save this now" banner for a freshly-issued plaintext
 * token. Writes ONLY to the supplied stream (stderr in production).
 * Structured JSON events on stdout MUST NOT carry the plaintext.
 *
 * Exported so the test suite can capture and assert the exact banner
 * shape without scraping process.stderr.
 */
export function formatTokenBanner(rawToken: string): string {
  const rule = "=".repeat(64)
  return [
    rule,
    " SAVE THIS NOW — IT WILL NOT BE RETRIEVABLE LATER.",
    ` Token: ${rawToken}`,
    rule,
    "",
  ].join("\n")
}

// -----------------------------------------------------------------------------
// Main — wires the parsed config to the service layer
// -----------------------------------------------------------------------------

/**
 * Resolve `--operator-email` to a User.id. Missing email is a CLI
 * ergonomic concern, not a security gate — log a warning and return
 * `null` so the FK lands as SetNull per the model contract.
 *
 * Exported so a future caller (dashboard server-action; tests) can
 * share the lookup behavior.
 */
export async function resolveOperatorId(
  email: string | null,
  prisma: {
    user: {
      findUnique: (args: {
        where: { email: string }
        select: { id: true }
      }) => Promise<{ id: string } | null>
    }
  },
): Promise<string | null> {
  if (!email) return null
  const row = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  })
  if (!row) {
    process.stderr.write(
      `[partner-keys] --operator-email=${email} not found in User table; proceeding with null FK\n`,
    )
    return null
  }
  return row.id
}

async function main(): Promise<void> {
  let config: CliConfig
  try {
    config = parseArgvToConfig(process.argv.slice(2))
  } catch (err) {
    if (err instanceof CliConfigError) {
      process.stderr.write(err.message + "\n")
      process.exit(err.exitCode)
    }
    throw err
  }

  // Lazy-import the service + prisma client AFTER the argv guard so a
  // pure argv-parse failure doesn't pay the env-validation cost (and
  // can't crash on a missing DATABASE_URL in `pnpm partner-keys --help`-
  // style invocations).
  const {
    createPartnerKey,
    listPartnerKeys,
    revokePartnerKey,
    rotatePartnerKey,
    PartnerKeyNotFoundError,
  } = await import("@/services/partner-api-key.service")
  const { prisma } = await import("@/db/client")

  const onSignal = (signal: NodeJS.Signals) => {
    process.stderr.write(
      JSON.stringify({
        event: "partner-key.interrupted",
        signal,
      }) + "\n",
    )
    void prisma.$disconnect().finally(() => process.exit(130))
  }
  process.once("SIGINT", onSignal)
  process.once("SIGTERM", onSignal)

  let runtimeExitCode = 0

  try {
    switch (config.subcommand) {
      case "create": {
        const operatorId = await resolveOperatorId(config.operatorEmail, prisma)
        const { keyId, rawToken, record } = await createPartnerKey(
          {
            name: config.name,
            ownerEmail: config.ownerEmail,
            note: config.note,
            createdById: operatorId,
          },
          prisma,
        )
        // Plaintext to stderr ONCE, structured event on stdout WITHOUT
        // the plaintext.
        process.stderr.write(formatTokenBanner(rawToken))
        process.stdout.write(
          JSON.stringify({
            event: "partner-key.created",
            keyId,
            name: record.name,
            ownerEmail: record.ownerEmail,
            note: record.note,
            createdAt: record.createdAt,
            createdById: record.createdById,
          }) + "\n",
        )
        break
      }

      case "list": {
        const rows = await listPartnerKeys(
          { includeRevoked: config.includeRevoked },
          prisma,
        )
        for (const row of rows) {
          process.stdout.write(
            JSON.stringify({
              event: "partner-key.listed",
              keyId: row.keyId,
              name: row.name,
              ownerEmail: row.ownerEmail,
              note: row.note,
              createdAt: row.createdAt,
              lastUsedAt: row.lastUsedAt,
              revokedAt: row.revokedAt,
            }) + "\n",
          )
        }
        process.stdout.write(
          JSON.stringify({
            event: "partner-key.list.complete",
            total: rows.length,
            includeRevoked: config.includeRevoked,
          }) + "\n",
        )
        break
      }

      case "revoke": {
        const operatorId = await resolveOperatorId(config.operatorEmail, prisma)
        try {
          const record = await revokePartnerKey(
            { keyId: config.keyId, revokedById: operatorId },
            prisma,
          )
          process.stdout.write(
            JSON.stringify({
              event: "partner-key.revoked",
              keyId: record.keyId,
              name: record.name,
              ownerEmail: record.ownerEmail,
              revokedAt: record.revokedAt,
              revokedById: record.revokedById,
            }) + "\n",
          )
        } catch (err) {
          if (err instanceof PartnerKeyNotFoundError) {
            process.stderr.write(
              JSON.stringify({
                event: "partner-key.fatal",
                subcommand: "revoke",
                keyId: config.keyId,
                error: err.message,
              }) + "\n",
            )
            runtimeExitCode = 1
          } else {
            throw err
          }
        }
        break
      }

      case "rotate": {
        const operatorId = await resolveOperatorId(config.operatorEmail, prisma)
        try {
          const { old, fresh } = await rotatePartnerKey(
            { keyId: config.keyId, createdById: operatorId },
            prisma,
          )
          // Plaintext to stderr ONCE.
          process.stderr.write(formatTokenBanner(fresh.rawToken))
          process.stdout.write(
            JSON.stringify({
              event: "partner-key.rotated",
              oldKeyId: old.keyId,
              newKeyId: fresh.keyId,
              name: fresh.record.name,
              ownerEmail: fresh.record.ownerEmail,
              note: fresh.record.note,
              createdAt: fresh.record.createdAt,
              createdById: fresh.record.createdById,
            }) + "\n",
          )
        } catch (err) {
          if (err instanceof PartnerKeyNotFoundError) {
            process.stderr.write(
              JSON.stringify({
                event: "partner-key.fatal",
                subcommand: "rotate",
                keyId: config.keyId,
                error: err.message,
              }) + "\n",
            )
            runtimeExitCode = 1
          } else {
            throw err
          }
        }
        break
      }
    }
  } finally {
    process.off("SIGINT", onSignal)
    process.off("SIGTERM", onSignal)
    await prisma.$disconnect()
  }

  if (runtimeExitCode !== 0) {
    process.exit(runtimeExitCode)
  }
}

if (
  typeof process.argv[1] === "string" &&
  import.meta.url === `file://${process.argv[1]}`
) {
  main().catch((err) => {
    process.stderr.write(
      JSON.stringify({
        event: "partner-key.fatal",
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      }) + "\n",
    )
    process.exit(1)
  })
}
