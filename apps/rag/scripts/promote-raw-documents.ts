import { RagOperationalError } from "../src/contracts/index.js"
import { PrismaClient } from "../src/generated/prisma/index.js"
import { getSource } from "../src/registry/index.js"

import {
  parseRawDocumentPromotionArgs,
  PrismaRawDocumentPromotionStore,
  promoteRawDocuments,
  rawDocumentPromotionErrorMessage,
  resolveRawDocumentPromotionEnvironment,
} from "./lib/raw-document-promotion.js"

async function main(): Promise<void> {
  const args = parseRawDocumentPromotionArgs(process.argv.slice(2))
  if (!getSource(args.source))
    throw new RagOperationalError(
      "argument_invalid",
      `unknown source '${args.source}'`,
    )
  const environment = resolveRawDocumentPromotionEnvironment(
    process.env,
    args.apply,
  )
  const source = new PrismaClient({ datasourceUrl: environment.sourceUrl })
  const target = new PrismaClient({ datasourceUrl: environment.targetUrl })
  try {
    const summary = await promoteRawDocuments(
      new PrismaRawDocumentPromotionStore(source),
      new PrismaRawDocumentPromotionStore(target),
      args,
    )
    console.log(JSON.stringify(summary))
  } finally {
    await Promise.all([source.$disconnect(), target.$disconnect()])
  }
}

main().catch((error) => {
  console.error(rawDocumentPromotionErrorMessage(error))
  process.exitCode = 1
})
