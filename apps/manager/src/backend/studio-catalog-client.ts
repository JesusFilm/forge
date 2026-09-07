import { print } from "@apollo/client/utilities"
import { adminGraphql } from "@forge/admin-graphql"
import {
  studioStageCatalogSchema,
  studioCatalogReleaseSchema,
} from "@forge/studio-contracts/catalog"
import { studioIdSchema } from "@forge/studio-contracts"
import { z } from "zod"
import type { StudioAdminTransport } from "./studio-client"
const fields = adminGraphql(
  `fragment StudioCatalogFields on StudioCatalogRelease { id projectId revision renderAttemptId videoId dubId editionId muxId snapshot }`,
)
const stage = adminGraphql(
  `mutation StageStudioCatalog($input: JSON!) { stageStudioCatalog(input: $input) { ...StudioCatalogFields } }`,
  [fields],
)
const read = adminGraphql(
  `query StudioCatalogRelease($id: ID!) { studioCatalogRelease(id: $id) { ...StudioCatalogFields } }`,
  [fields],
)
/** Server-only caller transport must carry trusted service authority for stage. */
export function createStudioCatalogAdapter(transport: StudioAdminTransport) {
  return {
    async stage(input: z.input<typeof studioStageCatalogSchema>) {
      return z.object({ stageStudioCatalog: studioCatalogReleaseSchema }).parse(
        await transport(print(stage), {
          input: studioStageCatalogSchema.parse(input),
        }),
      ).stageStudioCatalog
    },
    async read(id: string) {
      return z
        .object({ studioCatalogRelease: studioCatalogReleaseSchema })
        .parse(await transport(print(read), { id: studioIdSchema.parse(id) }))
        .studioCatalogRelease
    },
  }
}
