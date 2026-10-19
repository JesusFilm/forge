import { execFileSync } from "node:child_process"
import { resolve } from "node:path"

import {
  CodexLocalAccountError,
  createLocalCodexAccountReader,
  type CodexAccountAttestation,
} from "../services/precomputed-recommendations/codex-local-account"

export function preflightReport(
  attestation: CodexAccountAttestation,
  minimumRemainingPercent: 0 | 25 = 25,
) {
  return {
    accountRef: attestation.identity.accountRef,
    modelId: attestation.modelId,
    plan: attestation.plan,
    weeklyRemainingPercent: attestation.allowance.weeklyRemainingPercent,
    fiveHour: attestation.allowance.fiveHour,
    admission: attestation.admission,
    minimumRemainingPercent,
    billingBasis: attestation.allowance.billingBasis,
    providerEnforcedIncludedOnlySpendCap: false,
  }
}

async function main() {
  try {
    const args = process.argv.slice(2)
    if (
      args.length !== 0 &&
      !(
        args.length === 2 &&
        args[0] === "--minimum-remaining-percent" &&
        (args[1] === "0" || args[1] === "25")
      )
    )
      throw new CodexLocalAccountError("operator_only")
    const minimumRemainingPercent = args[1] === "0" ? 0 : 25
    const executable = resolve(
      execFileSync("which", ["codex"], {
        encoding: "utf8",
        timeout: 1_000,
        stdio: ["ignore", "pipe", "ignore"],
      }).trim(),
    )
    const report = preflightReport(
      await createLocalCodexAccountReader({
        codexExecutable: executable,
        minimumRemainingPercent,
      }).readAttestation(),
      minimumRemainingPercent,
    )
    process.stdout.write(JSON.stringify(report) + "\n")
    if (report.admission !== "admitted") process.exitCode = 1
  } catch (error) {
    const code =
      error instanceof CodexLocalAccountError ? error.code : "rpc_unavailable"
    process.stderr.write(JSON.stringify({ admission: "denied", code }) + "\n")
    process.exitCode = 1
  }
}

if (process.argv[1]?.endsWith("check-precomputed-subscription.ts")) {
  void main()
}
