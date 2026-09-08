import { fileURLToPath } from "node:url"

import { PrismaClient } from "../src/generated/prisma/index.js"
import { getSource } from "../src/registry/index.js"
import { RagOperationalError } from "../src/contracts/index.js"

import {
  parseRawDocumentVerificationArgs,
  PrismaRawDocumentPromotionStore,
  rawDocumentPromotionErrorMessage,
  resolveRawDocumentVerificationEnvironment,
  type PromotionReader,
  type RawDocumentVerificationSummary,
  verifyRawDocumentPromotion,
} from "./lib/raw-document-promotion.js"

export type RawDocumentVerificationCliDependencies = {
  sourceExists(sourceKey: string): boolean
  createTarget(databaseUrl: string): {
    target: PromotionReader
    disconnect(): Promise<void>
  }
  write(summary: RawDocumentVerificationSummary): void
}

const defaultDependencies: RawDocumentVerificationCliDependencies = {
  sourceExists: (sourceKey) => Boolean(getSource(sourceKey)),
  createTarget: (databaseUrl) => {
    const client = new PrismaClient({ datasourceUrl: databaseUrl })
    return {
      target: new PrismaRawDocumentPromotionStore(client),
      disconnect: () => client.$disconnect(),
    }
  },
  write: (summary) => console.log(JSON.stringify(summary)),
}

export async function runRawDocumentPromotionVerification(
  argv: string[],
  processEnvironment: NodeJS.ProcessEnv,
  dependencies: RawDocumentVerificationCliDependencies = defaultDependencies,
): Promise<RawDocumentVerificationSummary> {
  const args = parseRawDocumentVerificationArgs(argv)
  if (!dependencies.sourceExists(args.source))
    throw new RagOperationalError(
      "argument_invalid",
      `unknown source '${args.source}'`,
    )
  const { targetUrl } =
    resolveRawDocumentVerificationEnvironment(processEnvironment)
  const target = dependencies.createTarget(targetUrl)
  try {
    const summary = await verifyRawDocumentPromotion(target.target, args)
    dependencies.write(summary)
    return summary
  } finally {
    await target.disconnect()
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void runRawDocumentPromotionVerification(
    process.argv.slice(2),
    process.env,
  ).catch((error) => {
    console.error(rawDocumentPromotionErrorMessage(error))
    process.exitCode = 1
  })
}
