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
  `fragment ShortsCatalogFields on ShortsCatalogRelease { id projectId revision renderAttemptId title languageSlug durationMs width height fps muxAssetId muxPlaybackId snapshot }`,
)
const stage = adminGraphql(
  `mutation StageShortsCatalog($input: JSON!) { stageShortsCatalog(input: $input) { ...ShortsCatalogFields } }`,
  [fields],
)
const read = adminGraphql(
  `query ShortsCatalogRelease($id: ID!) { shortsCatalogRelease(id: $id) { ...ShortsCatalogFields } }`,
  [fields],
)
/** Server-only caller transport must carry trusted service authority for stage. */
export function createStudioCatalogAdapter(transport: StudioAdminTransport) {
  return {
    async stage(input: z.input<typeof studioStageCatalogSchema>) {
      return z.object({ stageShortsCatalog: studioCatalogReleaseSchema }).parse(
        await transport(print(stage), {
          input: studioStageCatalogSchema.parse(input),
        }),
      ).stageShortsCatalog
    },
    async read(id: string) {
      return z
        .object({ shortsCatalogRelease: studioCatalogReleaseSchema })
        .parse(await transport(print(read), { id: studioIdSchema.parse(id) }))
        .shortsCatalogRelease
    },
  }
}
