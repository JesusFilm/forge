import { RuntimeEnvError, assertMediaIndexEnv, env } from "../config/env.js"
import { prisma } from "../db/client.js"
import {
  FetchOfficialMediaFetcher,
  MediaIndexingService,
  PrismaMediaIndexRepository,
  type MediaIndexRunRecord,
} from "../services/media-indexing.js"

async function main() {
  assertMediaIndexEnv()

  const service = new MediaIndexingService({
    repository: new PrismaMediaIndexRepository(prisma),
    fetcher: new FetchOfficialMediaFetcher(),
    algorithmVersion: env.MEDIA_SIGNATURE_ALGORITHM_VERSION,
    pageSize: env.MEDIA_INDEX_PAGE_SIZE,
    maxMediaBytes: env.MEDIA_INDEX_MAX_FETCH_BYTES,
  })

  const result = await service.indexCatalog({
    resumeAfterVariantId: env.MEDIA_INDEX_RESUME_AFTER_VARIANT_ID,
  })

  console.log(
    JSON.stringify(
      {
        status: result.status,
        indexRunId: result.id,
        algorithmVersion: result.algorithmVersion,
        cursorVariantId: result.cursorVariantId,
        variantsAttempted: result.variantsAttempted,
        variantsIndexed: result.variantsIndexed,
        variantsFailed: result.variantsFailed,
        failureSummary: result.failureSummary,
      },
      null,
      2,
    ),
  )

  if (shouldFailMediaIndexCli(result)) {
    process.exitCode = 1
  }
}

export function shouldFailMediaIndexCli(
  result: Pick<
    MediaIndexRunRecord,
    "status" | "variantsAttempted" | "variantsIndexed" | "variantsFailed"
  >,
): boolean {
  return (
    result.status === "failed" ||
    (result.variantsAttempted > 0 &&
      result.variantsIndexed === 0 &&
      result.variantsFailed === result.variantsAttempted)
  )
}

if (env.NODE_ENV !== "test") {
  main()
    .catch((error) => {
      process.exitCode = 1
      const message =
        error instanceof RuntimeEnvError
          ? error.message
          : error instanceof Error
            ? error.message
            : "media indexing failed"
      console.error(message)
    })
    .finally(async () => {
      await prisma.$disconnect()
    })
}
