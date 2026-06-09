export type UploadSignals = {
  visualHashes: string[]
  audioFingerprints: string[]
  transcriptText?: string
  durationMilliseconds?: number
}

export type UploadSignalExtractionInput = {
  bytes: Buffer
  contentType: string
}

export type UploadSignalExtractor = {
  extract(input: UploadSignalExtractionInput): Promise<UploadSignals>
}

export class PlaceholderUploadSignalExtractor implements UploadSignalExtractor {
  async extract(): Promise<UploadSignals> {
    return {
      visualHashes: [],
      audioFingerprints: [],
    }
  }
}
