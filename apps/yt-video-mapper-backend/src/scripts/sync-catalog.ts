import { assertAdminCatalogSyncEnv, RuntimeEnvError } from "../config/env.js"
import { prisma } from "../db/client.js"
import { AdminGraphqlClient } from "../services/admin-graphql-client.js"
import {
  CatalogSyncService,
  PrismaCatalogRepository,
} from "../services/catalog-sync.js"

async function main() {
  const { adminGraphqlUrl, adminServiceBearerToken } =
    assertAdminCatalogSyncEnv()
  const service = new CatalogSyncService({
    client: new AdminGraphqlClient({
      url: adminGraphqlUrl,
      bearerToken: adminServiceBearerToken,
    }),
    repository: new PrismaCatalogRepository(prisma),
  })

  const result = await service.syncCatalog()
  console.log(
    JSON.stringify(
      {
        status: result.status,
        syncRunId: result.id,
        cursor: result.cursor,
        videosSeen: result.videosSeen,
        variantsSeen: result.variantsSeen,
        variantsIndexable: result.variantsIndexable,
        missingVariantsMarked: result.missingVariantsMarked,
        failureSummary: result.failureSummary,
      },
      null,
      2,
    ),
  )

  if (result.status === "failed") {
    process.exitCode = 1
  }
}

main()
  .catch((error) => {
    process.exitCode = 1
    const message =
      error instanceof RuntimeEnvError
        ? error.message
        : error instanceof Error
          ? error.message
          : "catalog sync failed"
    console.error(message)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
