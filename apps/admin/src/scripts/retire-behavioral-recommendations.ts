/** One explicitly acknowledged, finite retirement window. No scheduler. */
import { readFile } from "node:fs/promises"
import { Client } from "pg"
import { env } from "../config/env"
import { parseRetirementArguments } from "./retire-behavioral-recommendations-args"
import {
  parseRetirementCutoverProof,
  RetirementAdmissionError,
  RetirementBatchFailureError,
  RetirementUncertainCommitError,
  runBehavioralRetirementWindow,
} from "../services/recommendations/behavioral-retirement-cleanup"

async function main(): Promise<number> {
  try {
    const input = parseRetirementArguments(process.argv.slice(2))
    const sourceCommit = process.env.RAILWAY_GIT_COMMIT_SHA
    if (!sourceCommit || !/^[a-f0-9]{40}$/.test(sourceCommit))
      throw new RetirementAdmissionError(
        "Actual deployment revision unavailable",
      )
    const proofBytes = await readFile(input["cutover-proof"])
    if (proofBytes.byteLength > 8192)
      throw new RetirementAdmissionError("Cutover proof exceeds bound")
    const cutoverProof = parseRetirementCutoverProof({
      bytes: proofBytes,
      sha256: input["proof-sha256"],
      expectedReleaseA: input["release-a"],
      runningReleaseB: sourceCommit,
    })
    const client = new Client({ connectionString: env.DATABASE_URL })
    await client.connect()
    try {
      const result = await runBehavioralRetirementWindow(client, {
        operationId: input["operation-id"],
        sourceCommit,
        cutoverProof,
        batchSize: Number(input["batch-size"]),
        maxBatches: Number(input["max-batches"]),
        reconnectForReceipt: async () => {
          const receiptClient = new Client({
            connectionString: env.DATABASE_URL,
          })
          await receiptClient.connect()
          return receiptClient
        },
      })
      process.stdout.write(
        `${JSON.stringify({
          status: result.status,
          nextPhase: result.nextPhase,
          batches: result.batches,
          deleted: result.batches.reduce(
            (sum, batch) => sum + batch.deleted,
            0,
          ),
          updated: result.batches.reduce(
            (sum, batch) => sum + batch.updated,
            0,
          ),
        })}\n`,
      )
      return result.status === "complete" || result.status === "batch_limit"
        ? 0
        : 3
    } finally {
      await client.end().catch(() => undefined)
    }
  } catch (error) {
    if (error instanceof RetirementUncertainCommitError) {
      process.stderr.write(
        `Retirement ${error.phase} batch ${error.batchId}: durable receipt ${error.durableState}; stop for reconciliation.\n`,
      )
      return 4
    }
    if (error instanceof RetirementBatchFailureError) {
      process.stderr.write(
        `Retirement ${error.phase} batch ${error.batchId} failed and rolled back (SQLSTATE ${error.sqlstate ?? "unavailable"}); stop for diagnosis.\n`,
      )
      return 5
    }
    process.stderr.write(
      error instanceof RetirementAdmissionError
        ? `Retirement refused: ${error.message}.\n`
        : "Retirement failed; reconcile durable receipts before retrying.\n",
    )
    return 1
  }
}

void main().then(
  (code) => process.exit(code),
  () => process.exit(1),
)
