import { mkdtemp, realpath, rm } from "node:fs/promises"
import { dirname, join } from "node:path"

import {
  GaCaptureImportError,
  gaImportPreparedDigest,
  validateGaImportBinding,
  type createGaCaptureImportClient,
  type GaImportDestination,
} from "./ga-capture-import-client"
import { createSealedGaWatchHistoryReader } from "./ga-watch-capture"
import {
  gaCaptureCanonicalJson,
  openGaWatchCaptureArtifact,
} from "./ga-watch-capture-artifact"
import type { GaCaptureTransport } from "./ga-watch-capture-transport"
import {
  readHistoricalDefinition,
  type HistoricalAnalyticsReader,
} from "./historical-analytics"

/** Opens only the verified destination copy; it has no GA request capability. */
export async function loadImportedGaWatchHistory(input: {
  destination: GaImportDestination
  client: Pick<ReturnType<typeof createGaCaptureImportClient>, "status">
  transport: Pick<GaCaptureTransport, "download">
  directory: string
}) {
  const status = await input.client.status({ destination: input.destination })
  if (
    status.state !== "bound" ||
    status.preparedDigest !== gaImportPreparedDigest(input.destination) ||
    !/^[a-f0-9]{64}$/u.test(status.qualificationDigest)
  )
    throw new GaCaptureImportError("ga_import_identity_mismatch")
  const importBinding = validateGaImportBinding(
    status.importBinding,
    input.destination,
  )
  const directory = await mkdtemp(join(input.directory, "ga-import-copy-"))
  const dispose = () => rm(directory, { recursive: true, force: true })
  try {
    const path = await input.transport.download({
      generationId: importBinding.destination.generationId,
      generationInputDigest: importBinding.destination.generationInputDigest,
      artifactSha256: importBinding.copy.artifactSha256,
      artifactBytes: importBinding.copy.artifactBytes,
      directory,
    })
    // Neither use nor remove a transport-supplied file outside our staging dir.
    if (dirname(await realpath(path)) !== (await realpath(directory)))
      throw new GaCaptureImportError("ga_import_artifact_mismatch")
    const artifact = await openGaWatchCaptureArtifact({
      path,
      expectedSha256: importBinding.copy.artifactSha256,
      expectedBytes: importBinding.copy.artifactBytes,
    })
    const { artifactSha256, artifactBytes, headerSha256, ...originHeader } =
      importBinding.origin
    if (
      artifact.headerSha256 !== headerSha256 ||
      Object.entries(originHeader).some(
        ([key, value]) =>
          artifact.header[key as keyof typeof artifact.header] !== value,
      )
    )
      throw new GaCaptureImportError("ga_import_artifact_mismatch")
    const sealed = await createSealedGaWatchHistoryReader({
      artifact,
      artifactSha256,
    })
    const definition = await readHistoricalDefinition(
      sealed,
      importBinding.destination.inputCutoff,
    )
    if (
      definition.provider !== "ga_data_api" ||
      gaCaptureCanonicalJson(definition.qualification.sourceAvailability) !==
        gaCaptureCanonicalJson(artifact.header.sourceAvailability)
    )
      throw new GaCaptureImportError("ga_import_artifact_mismatch")
    const reader: HistoricalAnalyticsReader = {
      evidenceKind: "referrer_navigation_v1",
      describe: () => sealed.describe(),
      readPage: (page) => sealed.readPage(page),
      async readNavigationSnapshot(snapshot) {
        if (
          gaCaptureCanonicalJson(snapshot.definition) !==
          gaCaptureCanonicalJson(definition)
        )
          throw new GaCaptureImportError("ga_import_identity_mismatch")
        const result = await sealed.readNavigationSnapshot!(snapshot)
        if (
          result.queryUsage.size !== 0 ||
          result.provenance.queryExecutionCount !== 0
        )
          throw new GaCaptureImportError("ga_import_artifact_mismatch")
        return {
          ...result,
          provenance: {
            ...result.provenance,
            captureMode: "imported_capture_derived_v1",
            importBindingDigest: importBinding.bindingDigest,
          },
        }
      },
    }
    return {
      reader,
      definition,
      importBinding,
      // Opaque Admin receipt: its hash uses Admin's schema-normalized order.
      qualificationDigest: status.qualificationDigest,
      artifactBytes,
      dispose,
    }
  } catch (error) {
    await dispose()
    throw error
  }
}
