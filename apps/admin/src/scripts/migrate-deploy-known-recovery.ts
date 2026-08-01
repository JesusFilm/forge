#!/usr/bin/env tsx

import { spawn } from "node:child_process"

export const RECOVERABLE_MIGRATIONS = [
  "0027_video_localized_language_slug_identity",
  "0032_video_embedding_qwen",
  "0047_video_locale_search_social_metadata",
] as const

export const RECOVERABLE_MIGRATION = RECOVERABLE_MIGRATIONS[0]

export type CommandResult = {
  code: number
  output: string
}

export type PrismaRunner = (args: readonly string[]) => Promise<CommandResult>

type DeployRecoveryOptions = {
  transientDeployAttempts?: number
  transientDeployDelayMs?: number
  sleep?: (ms: number) => Promise<void>
}

const TRANSIENT_DEPLOY_FAILURE_PATTERNS = [
  /too many clients already/i,
  /remaining connection slots are reserved/i,
  /connection limit exceeded/i,
] as const

function positiveIntegerEnv(name: string, fallback: number) {
  const value = Number.parseInt(process.env[name] ?? "", 10)
  return Number.isFinite(value) && value > 0 ? value : fallback
}

const DEFAULT_TRANSIENT_DEPLOY_ATTEMPTS = positiveIntegerEnv(
  "MIGRATE_DEPLOY_TRANSIENT_ATTEMPTS",
  8,
)
const DEFAULT_TRANSIENT_DEPLOY_DELAY_MS = positiveIntegerEnv(
  "MIGRATE_DEPLOY_TRANSIENT_DELAY_MS",
  10_000,
)

function defaultSleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

export function getKnownRecoverableP3009Migration(
  output: string,
): (typeof RECOVERABLE_MIGRATIONS)[number] | undefined {
  if (!output.includes("P3009")) return undefined
  return RECOVERABLE_MIGRATIONS.find((migration) => output.includes(migration))
}

export function isTransientPrismaDeployFailure(output: string): boolean {
  return TRANSIENT_DEPLOY_FAILURE_PATTERNS.some((pattern) =>
    pattern.test(output),
  )
}

export function isKnownRecoverableP3009(output: string): boolean {
  return getKnownRecoverableP3009Migration(output) !== undefined
}

export async function runPrisma(
  args: readonly string[],
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("prisma", args, {
      env: process.env,
      shell: process.platform === "win32",
    })
    let output = ""

    child.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString()
      output += text
      process.stdout.write(text)
    })
    child.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString()
      output += text
      process.stderr.write(text)
    })
    child.on("error", reject)
    child.on("close", (code) => resolve({ code: code ?? 1, output }))
  })
}

async function runMigrateDeployWithTransientRetry(
  runner: PrismaRunner,
  options: DeployRecoveryOptions,
): Promise<CommandResult> {
  const attempts =
    options.transientDeployAttempts ?? DEFAULT_TRANSIENT_DEPLOY_ATTEMPTS
  const delayMs =
    options.transientDeployDelayMs ?? DEFAULT_TRANSIENT_DEPLOY_DELAY_MS
  const sleep = options.sleep ?? defaultSleep

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const result = await runner(["migrate", "deploy"])
    if (result.code === 0) return result

    if (
      !isTransientPrismaDeployFailure(result.output) ||
      attempt === attempts
    ) {
      return result
    }

    process.stderr.write(
      `[migrate-deploy] transient prisma migrate deploy failure; retrying attempt ${attempt + 1}/${attempts}\n`,
    )
    await sleep(delayMs)
  }

  return runner(["migrate", "deploy"])
}

export async function deployWithKnownRecovery(
  runner: PrismaRunner = runPrisma,
  options: DeployRecoveryOptions = {},
): Promise<void> {
  const firstDeploy = await runMigrateDeployWithTransientRetry(runner, options)
  if (firstDeploy.code === 0) return

  const recoverableMigration = getKnownRecoverableP3009Migration(
    firstDeploy.output,
  )

  if (!recoverableMigration) {
    throw new Error("prisma migrate deploy failed without known P3009 recovery")
  }

  process.stderr.write(
    `[migrate-deploy] recovering known failed migration ${recoverableMigration}\n`,
  )
  const resolve = await runner([
    "migrate",
    "resolve",
    "--rolled-back",
    recoverableMigration,
  ])
  if (resolve.code !== 0) {
    const retryAfterResolveFailure = await runMigrateDeployWithTransientRetry(
      runner,
      options,
    )
    if (retryAfterResolveFailure.code === 0) return

    throw new Error(
      `prisma migrate resolve --rolled-back ${recoverableMigration} failed`,
    )
  }

  const secondDeploy = await runMigrateDeployWithTransientRetry(runner, options)
  if (secondDeploy.code !== 0) {
    throw new Error("prisma migrate deploy failed after known recovery")
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  deployWithKnownRecovery().catch((error) => {
    process.stderr.write(
      `[migrate-deploy] failed error=${error instanceof Error ? error.message : String(error)}\n`,
    )
    process.exit(1)
  })
}
