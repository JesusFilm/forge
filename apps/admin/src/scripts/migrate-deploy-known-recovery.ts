#!/usr/bin/env tsx

import { spawn } from "node:child_process"

export const RECOVERABLE_MIGRATION =
  "0027_video_localized_language_slug_identity"

export type CommandResult = {
  code: number
  output: string
}

export type PrismaRunner = (args: readonly string[]) => Promise<CommandResult>

export function isKnownRecoverableP3009(output: string): boolean {
  return output.includes("P3009") && output.includes(RECOVERABLE_MIGRATION)
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

export async function deployWithKnownRecovery(
  runner: PrismaRunner = runPrisma,
): Promise<void> {
  const firstDeploy = await runner(["migrate", "deploy"])
  if (firstDeploy.code === 0) return

  if (!isKnownRecoverableP3009(firstDeploy.output)) {
    throw new Error("prisma migrate deploy failed without known P3009 recovery")
  }

  process.stderr.write(
    `[migrate-deploy] recovering known failed migration ${RECOVERABLE_MIGRATION}\n`,
  )
  const resolve = await runner([
    "migrate",
    "resolve",
    "--rolled-back",
    RECOVERABLE_MIGRATION,
  ])
  if (resolve.code !== 0) {
    throw new Error(
      `prisma migrate resolve --rolled-back ${RECOVERABLE_MIGRATION} failed`,
    )
  }

  const secondDeploy = await runner(["migrate", "deploy"])
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
