import { execFileSync } from "node:child_process"
import { resolve } from "node:path"

import {
  CodexLocalAccountError,
  createLocalCodexAccountReader,
  type CodexAccountAttestation,
} from "../services/precomputed-recommendations/codex-local-account"

export function preflightReport(attestation: CodexAccountAttestation) {
  return {
    accountRef: attestation.identity.accountRef,
    modelId: attestation.modelId,
    plan: attestation.plan,
    weeklyRemainingPercent: attestation.allowance.weeklyRemainingPercent,
    fiveHour: attestation.allowance.fiveHour,
    admission: attestation.admission,
    billingBasis: attestation.allowance.billingBasis,
    providerEnforcedIncludedOnlySpendCap: false,
  }
}

async function main() {
  try {
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
      }).readAttestation(),
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
