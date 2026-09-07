import { fileURLToPath } from "node:url"

import { RagOperationalError } from "../src/contracts/index.js"
import { PrismaClient } from "../src/generated/prisma/index.js"
import { getSource } from "../src/registry/index.js"

import {
  parseRawDocumentPromotionArgs,
  PrismaRawDocumentPromotionStore,
  promoteRawDocuments,
  rawDocumentPromotionErrorMessage,
  resolveRawDocumentPromotionEnvironment,
  type PromotionReader,
  type PromotionTarget,
  type RawDocumentPromotionSummary,
} from "./lib/raw-document-promotion.js"

type ReaderHandle = {
  reader: PromotionReader
  disconnect(): Promise<void>
}

type TargetHandle = {
  target: PromotionTarget
  disconnect(): Promise<void>
}

export type RawDocumentPromotionCliDependencies = {
  sourceExists(sourceKey: string): boolean
  createReader(databaseUrl: string): ReaderHandle
  createTarget(databaseUrl: string): TargetHandle
  write(summary: RawDocumentPromotionSummary): void
}

const defaultDependencies: RawDocumentPromotionCliDependencies = {
  sourceExists: (sourceKey) => Boolean(getSource(sourceKey)),
  createReader: (databaseUrl) => {
    const client = new PrismaClient({ datasourceUrl: databaseUrl })
    return {
      reader: new PrismaRawDocumentPromotionStore(client),
      disconnect: () => client.$disconnect(),
    }
  },
  createTarget: (databaseUrl) => {
    const client = new PrismaClient({ datasourceUrl: databaseUrl })
    return {
      target: new PrismaRawDocumentPromotionStore(client),
      disconnect: () => client.$disconnect(),
    }
  },
  write: (summary) => console.log(JSON.stringify(summary)),
}

export async function runRawDocumentPromotion(
  argv: string[],
  processEnvironment: NodeJS.ProcessEnv,
  dependencies: RawDocumentPromotionCliDependencies = defaultDependencies,
): Promise<RawDocumentPromotionSummary> {
  const args = parseRawDocumentPromotionArgs(argv)
  if (!dependencies.sourceExists(args.source))
    throw new RagOperationalError(
      "argument_invalid",
      `unknown source '${args.source}'`,
    )
  const environment = resolveRawDocumentPromotionEnvironment(
    processEnvironment,
    args.apply,
  )
  const source = dependencies.createReader(environment.sourceUrl)
  const target = dependencies.createTarget(environment.targetUrl)
  try {
    const summary = await promoteRawDocuments(
      source.reader,
      target.target,
      args,
    )
    dependencies.write(summary)
    return summary
  } finally {
    await Promise.all([source.disconnect(), target.disconnect()])
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void runRawDocumentPromotion(process.argv.slice(2), process.env).catch(
    (error) => {
      console.error(rawDocumentPromotionErrorMessage(error))
      process.exitCode = 1
    },
  )
}
