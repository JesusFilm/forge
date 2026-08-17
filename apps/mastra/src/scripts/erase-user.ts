/**
 * `erase-user` — the operator CLI for a subject-erasure request (feat-337).
 *
 * A thin wrapper over `src/mastra/ai-chat-erasure.ts`: this file owns argument
 * parsing, the confirm gate, the operator-facing report, and the exit-code map.
 * All erasure logic lives in the module so the future apps/auth
 * account-deletion cascade (feat-356) calls the same code and consumes the same
 * typed per-store outcomes — never this file's exit codes.
 *
 * Usage (the runbook in `apps/mastra/CLAUDE.md` is the authority on WHEN):
 *
 *   pnpm --filter @forge/mastra erase-user -- --resource=user:<auth-user-id>
 *   pnpm --filter @forge/mastra erase-user -- --resource=user:<auth-user-id> \
 *       --execute --confirm-database=<hash printed by the preview>
 *
 * Safety shape, in the order it fires:
 *
 *  1. **A bare run is a read-only preview** (KD6/R3). It deletes nothing and
 *     prints the blast radius — per-store counts plus the targets it would act
 *     on — so the destructive run is always second.
 *  2. **The confirm gate is checked BEFORE any store client is constructed**
 *     (the `backfill-video-relation-order` precedent). `--execute` alone is not
 *     enough: it must carry `--confirm-database=<hash>` matching the CURRENT
 *     target identity.
 *  3. **The hash pins BOTH stores AND the subject** (KTD3). Erasure spans the
 *     `ai_chat` Postgres schema AND the always-production `forge-mastra`
 *     Langfuse project, so the identity covers the redacted Postgres connection
 *     identity, the configured Langfuse host, and `sha256(resourceId)`: a hash
 *     minted against a throwaway database must never authorize a production
 *     trace delete, and one minted while previewing one subject must never
 *     authorize erasing another. It covers target identity ONLY, never counts —
 *     an actively chatting subject would otherwise deadlock the confirm loop —
 *     and execute re-reports its own execute-time counts so preview→execute
 *     drift is visible rather than hidden.
 *     *Emitted on the preview path only.* An execute run never prints the
 *     token, not even on refusal — see the comment at the emit site for why
 *     echoing it would reduce the subject pin to one extra keystroke.
 *     *PR 1 scope:* the Langfuse component is the configured HOST. The
 *     resolved-project component lands in PR 2 alongside the project-identity
 *     probe (KTD11), which changes the hash — operators re-read it from the
 *     preview, which is the flow anyway.
 *  4. **`DATABASE_URL` is read from `env.DATABASE_URL`** (post-
 *     `emptyToUndefined`, so a blank sourced value is `undefined`), never
 *     `getMastraDatabaseUrl()` — whose silent localhost fallback would let a
 *     destructive run land on the wrong database.
 *
 * Exit codes (KTD5):
 *   0 — the run completed and claimed nothing it cannot support: any clean
 *       read-only preview.
 *   2 — incomplete but safe to rerun. In THIS build every `--execute` run ends
 *       here even when Postgres erased cleanly, because the Langfuse half is
 *       `not_implemented`: traces may still exist and no run may imply
 *       otherwise. PR 2 makes a fully-erased key exit 0.
 *   1 — hard refusal or fault: bad arguments, a refused resourceId, absent
 *       `DATABASE_URL`, a missing/mismatched confirm hash, or a store
 *       connectivity-probe failure (never a zero count).
 *
 * Output is enum-and-count only (R4): `[erase-user] event=… key=value` plain
 * strings — never conversation text, thread ids, the resource key, or caught
 * exception text. The resource key is deliberately absent from every line: it
 * is the subject's stable identifier and the operator already has it on the
 * command line.
 */

import { createHash } from "node:crypto"
import { pathToFileURL } from "node:url"

import { env } from "../config/env"
import {
  closeAiChatErasureStore,
  executeAiChatErasure,
  formatPostgresOutcome,
  previewAiChatErasure,
  type AiChatErasureResult,
} from "../mastra/ai-chat-erasure"

/** Flags that take a `=value`. Used WITHOUT one, they are a usage error. */
const VALUED_FLAGS = new Set(["--resource", "--confirm-database"])
/** Flags that are bare booleans. Used WITH a `=value`, they are a usage error. */
const BOOLEAN_FLAGS = new Set(["--execute"])

/** `--name=value` argv lookup — the house idiom (`evals/seeker/cli.ts`). */
function flag(argv: readonly string[], name: string): string | undefined {
  const prefix = `--${name}=`
  return argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length)
}

export type EraseUserArgs = {
  resource?: string
  execute: boolean
  confirmDatabase?: string
  /** Unrecognized names, known names in the wrong form, and repeats. */
  rejectedFlags: string[]
}

/**
 * Strict parsing, because every loose reading of argv on this tool is a
 * wrong-subject or wrong-mode hazard rather than an inconvenience:
 *
 *  - A known flag in the WRONG FORM is rejected, not ignored. `--execute=true`
 *    reads to a human as "execute" but does not match `argv.includes`, so a
 *    permissive parser would silently downgrade a destructive run to a preview
 *    — safe in direction, but it teaches the operator that a flag they will
 *    later type correctly "did nothing", and the same class in reverse
 *    (`--resource` bare) would target nothing at all.
 *  - A REPEATED flag is rejected. `flag()` returns the first match, so a
 *    recalled-and-edited shell line carrying `--resource=A --resource=B` would
 *    silently erase A while the operator reads B on their screen.
 */
export function parseEraseUserArgs(argv: readonly string[]): EraseUserArgs {
  const rejected: string[] = []
  const seen = new Set<string>()
  for (const arg of argv) {
    // A bare `--` is the standard end-of-options separator, and pnpm forwards
    // the one in `pnpm … erase-user -- --resource=…` verbatim into argv — it is
    // not a mistyped flag.
    if (arg === "--" || !arg.startsWith("--")) continue
    const eq = arg.indexOf("=")
    const name = eq === -1 ? arg : arg.slice(0, eq)
    const hasValue = eq !== -1
    const known = VALUED_FLAGS.has(name) || BOOLEAN_FLAGS.has(name)
    if (!known || hasValue !== VALUED_FLAGS.has(name)) {
      rejected.push(arg)
      continue
    }
    if (seen.has(name)) {
      rejected.push(arg)
      continue
    }
    seen.add(name)
  }
  return {
    resource: flag(argv, "resource"),
    execute: argv.includes("--execute"),
    confirmDatabase: flag(argv, "confirm-database"),
    rejectedFlags: rejected,
  }
}

export type EraseUserTargetIdentity = {
  /** sha256 prefix over BOTH stores' identities (KTD3). */
  hash: string
  /** Credential-free Postgres identity, safe to print. */
  postgresRedacted: string
  /** Langfuse host, or the literal `unconfigured`. */
  langfuseHost: string
}

/**
 * Query-parameter names treated as credential-bearing. Deliberately wider than
 * the obvious four: the printed `event=target` line is the one place a
 * connection string reaches an operator's terminal (and their shell history),
 * so a driver-specific spelling like `pwd=` or `sslpassword=` must not sail
 * through a narrower pattern. Name-based matching stays a heuristic — it is a
 * belt over the username/password redaction below, not the only control.
 */
const CREDENTIAL_PARAM_PATTERN =
  /(pass|pwd|secret|token|key|credential|auth|sig|signature)/i

function redactDatabaseUrl(url: URL): string {
  const redacted = new URL(url.toString())
  if (redacted.username || redacted.password) {
    redacted.username = "***"
    redacted.password = "***"
  }
  for (const key of [...redacted.searchParams.keys()]) {
    if (CREDENTIAL_PARAM_PATTERN.test(key)) {
      redacted.searchParams.set(key, "***")
    }
  }
  return redacted.toString()
}

/**
 * The confirm hash's input (KTD3). Covers WHICH STORES and WHICH SUBJECT this
 * run would act on — never credentials (which would put a secret in an
 * operator's shell history and in the CI logs of anyone who pastes a command)
 * and never counts. Query params whose names look credential-bearing are
 * dropped from the identity for the same reason; the rest are sorted so param
 * order cannot change the hash.
 *
 * The `resource` component closes the wrong-SUBJECT path the two store
 * components leave open: without it, a token minted while previewing
 * `user:alice` still authorizes `--execute --resource=user:bob` against the
 * same databases, so the confirm step would attest to the destination while
 * saying nothing about the person. It is hashed before it enters the identity,
 * so the token an operator pastes into a shell carries no subject identifier
 * (R4) — and unlike a count, a resource key is stable, so pinning it cannot
 * deadlock the confirm loop for an actively-chatting subject (the reason KTD3
 * excludes counts does not apply here).
 */
export function eraseUserTargetIdentity({
  databaseUrl,
  langfuseBaseUrl,
  resourceId,
}: {
  databaseUrl: string
  langfuseBaseUrl?: string
  resourceId: string
}): EraseUserTargetIdentity {
  const url = new URL(databaseUrl)
  const params = [...url.searchParams.entries()]
    .filter(([key]) => !CREDENTIAL_PARAM_PATTERN.test(key))
    .sort(([left], [right]) => left.localeCompare(right))
  const langfuseHost = langfuseBaseUrl
    ? new URL(langfuseBaseUrl).host
    : "unconfigured"
  const identity = JSON.stringify({
    postgres: {
      protocol: url.protocol,
      username: url.username,
      host: url.hostname,
      port: url.port,
      database: url.pathname.replace(/^\/+/, ""),
      params,
    },
    // PR 1: host only. PR 2 adds the RESOLVED project id beside it (KTD11).
    langfuse: { host: langfuseHost },
    resource: createHash("sha256").update(resourceId).digest("hex"),
  })
  return {
    hash: createHash("sha256").update(identity).digest("hex").slice(0, 16),
    postgresRedacted: redactDatabaseUrl(url),
    langfuseHost,
  }
}

export type EraseUserDeps = {
  preview?: typeof previewAiChatErasure
  execute?: typeof executeAiChatErasure
  databaseUrl?: string
  langfuseBaseUrl?: string
  stdout?: (line: string) => void
}

/**
 * The exit-code map (KTD5), kept as one pure function so the ladder is
 * readable and testable in isolation. Order matters: faults outrank
 * incompleteness, and incompleteness outranks a clean run.
 */
export function exitCodeFor(result: AiChatErasureResult): 0 | 1 | 2 {
  if (result.kind === "refused") return 1
  if (result.postgres.kind === "unreachable") return 1
  if (result.postgres.kind === "failed") return 2
  // A read-only preview claims nothing about either store's final state, so a
  // clean one exits 0 even with the Langfuse half unbuilt.
  if (result.mode === "preview") return 0
  // Execute: the Langfuse half is `not_implemented` in this build, so traces
  // may still exist for this key. Exiting 0 here would read as "erased
  // everywhere" — the one claim PR 1 cannot make.
  return result.langfuse.kind === "not_implemented" ? 2 : 0
}

export async function runEraseUserCli(
  argv: readonly string[],
  deps: EraseUserDeps = {},
): Promise<0 | 1 | 2> {
  const out =
    deps.stdout ?? ((line: string) => process.stdout.write(`${line}\n`))
  const emit = (line: string) => out(`[erase-user] ${line}`)

  const args = parseEraseUserArgs(argv)
  if (args.rejectedFlags.length > 0) {
    // Refuse rather than ignore: a mistyped `--confirm-databse=` must not
    // degrade into "no confirm supplied", `--execute=true` must not degrade
    // into a preview, and a repeated `--resource=` must not silently target
    // the first of two values. Counts only — an argv value can carry the
    // subject's key.
    emit(
      `event=refused reason=invalid_flags count=${args.rejectedFlags.length}`,
    )
    emit(
      "event=usage form=--resource=<resourceId> [--execute --confirm-database=<hash>] note=each_flag_at_most_once",
    )
    return 1
  }
  if (args.resource === undefined) {
    emit("event=refused reason=resource_required")
    emit(
      "event=usage form=--resource=<resourceId> [--execute --confirm-database=<hash>]",
    )
    return 1
  }

  // `in` rather than `??`: a test that injects an explicitly-absent
  // `databaseUrl` must observe the missing-config path deterministically, not
  // fall through to whatever `DATABASE_URL` the developer happens to export.
  const databaseUrl =
    "databaseUrl" in deps ? deps.databaseUrl : env.DATABASE_URL
  if (databaseUrl === undefined) {
    // No fallback connection is attempted: `getMastraDatabaseUrl()`'s localhost
    // default is exactly the wrong-database hazard for a destructive tool.
    emit("event=refused reason=database_url_missing")
    return 1
  }

  let identity: EraseUserTargetIdentity
  try {
    identity = eraseUserTargetIdentity({
      databaseUrl,
      langfuseBaseUrl:
        "langfuseBaseUrl" in deps
          ? deps.langfuseBaseUrl
          : env.LANGFUSE_BASE_URL,
      resourceId: args.resource,
    })
  } catch {
    // Enum-only: a URL parse error can embed the credential-bearing string.
    emit("event=refused reason=target_url_invalid")
    return 1
  }

  // The confirm token is emitted on the PREVIEW path ONLY, and never echoed by
  // an execute run — including its refusal. This is what makes the token worth
  // pinning: it is computed from the arguments just supplied, so a run that
  // printed it on refusal would hand the operator a valid token for whatever
  // they just typed. `--execute --resource=user:bob` carrying a token minted
  // for `user:alice` would refuse, print bob's token, and succeed on the very
  // next paste — with no preview of bob ever run. Pinning the subject would
  // then buy one extra keystroke rather than a forced look at the blast radius.
  // (The `backfill-video-relation-order` precedent does echo its hash on
  // refusal; it can afford to, because its token pins only a database the
  // operator is not changing between invocations.)
  emit(
    `event=target postgres_url=${identity.postgresRedacted} langfuse_host=${identity.langfuseHost}` +
      (args.execute ? "" : ` confirm_database=${identity.hash}`),
  )

  // The confirm gate — checked here, before the erasure module (and therefore
  // before any store client) is reached.
  if (args.execute && args.confirmDatabase !== identity.hash) {
    emit(
      `event=refused reason=${
        args.confirmDatabase === undefined
          ? "confirm_database_missing"
          : "confirm_database_mismatch"
      }`,
    )
    // Names the recovery WITHOUT supplying the token — the operator must run
    // the preview for this exact resource to obtain it.
    emit(
      "event=hint action=rerun_preview_for_this_exact_resource_to_obtain_the_token",
    )
    return 1
  }

  const run = args.execute
    ? (deps.execute ?? executeAiChatErasure)
    : (deps.preview ?? previewAiChatErasure)
  const result = await run({ resourceId: args.resource })

  if (result.kind === "refused") {
    emit(`event=refused reason=${result.reason}`)
    return 1
  }

  emit(
    `event=${result.mode}_report ${formatPostgresOutcome(result.postgres)} langfuse=${result.langfuse.kind}`,
  )
  if (result.postgres.kind === "no_data") {
    // AE7: a distinct outcome, never reported as a successful erasure. A 0/0
    // preview means re-derive the key before recording anything (runbook).
    emit("event=no_data_for_key store=postgres")
  }
  if (result.langfuse.kind === "not_implemented") {
    emit(
      "event=langfuse_half_unavailable reason=not_implemented fallback=langfuse_console_bulk_delete",
    )
  }

  const code = exitCodeFor(result)
  emit(
    `event=exit code=${code}${code === 2 ? " rerun_safe=1 note=exact_key_deletes_are_idempotent" : ""}`,
  )
  return code
}

async function main(): Promise<void> {
  try {
    process.exitCode = await runEraseUserCli(process.argv.slice(2))
  } catch {
    // R4: an unhandled rejection must never print a raw error.
    process.stdout.write("[erase-user] event=failed reason=unexpected_error\n")
    process.exitCode = 1
  } finally {
    // Release the pooled connections the module opened. An open `pg` pool
    // holds the event loop, so without this the command prints its report and
    // then appears to hang — the operator never sees the exit code the runbook
    // tells them to read. Kept OUT of `runEraseUserCli` so the injectable-seam
    // tests exercise the same function the operator runs, minus process-level
    // lifecycle. Mirrors `check-devotional-database-readiness.ts`.
    await closeAiChatErasureStore()
  }
}

// Portable main guard — the `file://` string form is fragile across platforms.
if (
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  await main()
}
