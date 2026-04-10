import { describe, expect, it } from "vitest"
import {
  buildMaterializationMetadata,
  ENRICH_CREATE_CONCURRENCY,
  GET_VIDEOS_WITH_MUX,
  mapWithConcurrencyLimit,
} from "@/app/api/enrich/route"

type QueryNode = {
  kind?: string
  name?: { value?: string }
  arguments?: Array<{
    name?: { value?: string }
    value?: {
      kind?: string
      fields?: Array<{
        name?: { value?: string }
        value?: { kind?: string; value?: string }
      }>
    }
  }>
  selectionSet?: { selections?: QueryNode[] }
}

function findField(
  selections: QueryNode[] | undefined,
  fieldName: string,
): QueryNode | undefined {
  for (const selection of selections ?? []) {
    if (selection.kind !== "Field") continue
    if (selection.name?.value === fieldName) return selection

    const nestedMatch = findField(selection.selectionSet?.selections, fieldName)
    if (nestedMatch) return nestedMatch
  }

  return undefined
}

function getLimitArgumentValue(field: QueryNode | undefined): string | null {
  const pagination = field?.arguments?.find(
    (argument) => argument.name?.value === "pagination",
  )
  if (!pagination?.value || pagination.value.kind !== "ObjectValue") {
    return null
  }

  const limit = pagination.value.fields?.find(
    (entry) => entry.name?.value === "limit",
  )
  if (!limit) {
    return null
  }

  return limit.value?.kind === "IntValue" ? (limit.value.value ?? null) : null
}

describe("GET_VIDEOS_WITH_MUX", () => {
  it("requests all nested variants explicitly", () => {
    const document = GET_VIDEOS_WITH_MUX as QueryNode & {
      definitions?: QueryNode[]
    }
    const operation = document.definitions?.[0]

    expect(operation?.kind).toBe("OperationDefinition")
    if (operation?.kind !== "OperationDefinition" || !operation.selectionSet) {
      return
    }

    const videosField = findField(operation.selectionSet.selections, "videos")
    const variantsField = findField(
      videosField?.selectionSet?.selections,
      "variants",
    )
    const downloadsField = findField(
      variantsField?.selectionSet?.selections,
      "downloads",
    )

    expect(getLimitArgumentValue(variantsField)).toBe("-1")
    expect(getLimitArgumentValue(downloadsField)).toBe("-1")
  })
})

describe("mapWithConcurrencyLimit", () => {
  it("caps concurrent work while preserving result order", async () => {
    let inFlight = 0
    let maxInFlight = 0

    const results = await mapWithConcurrencyLimit(
      Array.from(
        { length: ENRICH_CREATE_CONCURRENCY + 3 },
        (_, index) => index,
      ),
      ENRICH_CREATE_CONCURRENCY,
      async (value) => {
        inFlight += 1
        maxInFlight = Math.max(maxInFlight, inFlight)

        await new Promise((resolve) => setTimeout(resolve, 5))

        inFlight -= 1
        return value * 2
      },
    )

    expect(results).toEqual(
      Array.from(
        { length: ENRICH_CREATE_CONCURRENCY + 3 },
        (_, index) => index * 2,
      ),
    )
    expect(maxInFlight).toBe(ENRICH_CREATE_CONCURRENCY)
  })
})

describe("buildMaterializationMetadata", () => {
  it("builds clone-mode metadata with stage target fields", () => {
    const metadata = buildMaterializationMetadata({
      materialization: {
        status: "ready",
        materializationMode: "snapshot_to_stage_clone",
        sourceVideoCoreId: "video-1",
        sourceLanguage: { coreId: "529", bcp47: "en", iso3: "eng" },
        sourceLanguageCode: "en",
        sourceMuxAssetId: "source-asset-1",
        sourceMuxPlaybackId: "source-playback-1",
        sourceInputUrl: "https://stream.mux.com/source/720p.mp4?token=secret",
        sourceInputType: "download_mp4",
        sourceSelectionReason: "requested",
        sourceSelectionAttemptedCodes: ["en", "es", "fr"],
        targetMuxAssetId: "stage-asset-1",
        targetMuxPlaybackId: "stage-playback-1",
      },
      actualSourceLanguage: { coreId: "529", bcp47: "en", iso3: "eng" },
      actualSourceLanguageCode: "en",
      primaryRequestedTargetLanguageCode: "ru",
      requestedTargetLanguageIds: ["3934"],
      resolvedTargetLanguageCodes: ["ru"],
    })

    expect(metadata).toMatchObject({
      mode: "snapshot_to_stage_clone",
      sourceInputHost: "stream.mux.com",
      sourceInputType: "download_mp4",
      targetEnvironment: "mux-stage",
      stageMuxAssetId: "stage-asset-1",
      stageMuxPlaybackId: "stage-playback-1",
    })
  })

  it("builds direct-mode metadata with reused asset fields", () => {
    const metadata = buildMaterializationMetadata({
      materialization: {
        status: "ready",
        materializationMode: "direct_mux_asset_reuse",
        sourceVideoCoreId: "video-1",
        sourceLanguage: { coreId: "529", bcp47: "en", iso3: "eng" },
        sourceLanguageCode: "en",
        sourceMuxAssetId: "source-asset-1",
        sourceMuxPlaybackId: "source-playback-1",
        sourceInputType: "mux_asset",
        sourceSelectionReason: "fallback-en",
        sourceSelectionAttemptedCodes: ["ru", "en", "es", "fr"],
        targetMuxAssetId: "source-asset-1",
        targetMuxPlaybackId: "source-playback-1",
      },
      actualSourceLanguage: { coreId: "529", bcp47: "en", iso3: "eng" },
      actualSourceLanguageCode: "en",
      primaryRequestedTargetLanguageCode: "ru",
      requestedTargetLanguageIds: ["3934"],
      resolvedTargetLanguageCodes: ["ru"],
    })

    expect(metadata).toMatchObject({
      mode: "direct_mux_asset_reuse",
      sourceInputType: "mux_asset",
      targetEnvironment: "mux-production",
      reusedMuxAssetId: "source-asset-1",
      reusedMuxPlaybackId: "source-playback-1",
    })
    expect(metadata).not.toHaveProperty("sourceInputHost")
    expect(metadata).not.toHaveProperty("stageMuxAssetId")
  })
})
