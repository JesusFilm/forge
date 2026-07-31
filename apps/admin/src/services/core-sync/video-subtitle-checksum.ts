import { createHash } from "node:crypto"

import { coreQuery } from "./core-client"
import {
  CoreVideoSubtitleChecksumManifestSchema,
  type CoreVideoSubtitleChecksumBucket,
  type CoreVideoSubtitleChecksumDetail,
  type CoreVideoSubtitleChecksumManifest,
  type CoreVideoSubtitleChecksumRecord,
} from "./schemas/video-subtitle-manifest"

export const VIDEO_SUBTITLE_CHECKSUM_VERSION = 1 as const
export const MAX_VIDEO_SUBTITLE_DETAIL_IDS = 100

const VIDEO_SUBTITLE_BUCKET_DOMAIN = "jfp.subtitle-sync.video"
const VIDEO_SUBTITLE_ROOT_DOMAIN = "jfp.subtitle-sync.root"

export type VideoSubtitleChecksumSourceRecord = Omit<
  CoreVideoSubtitleChecksumRecord,
  "value"
>

type VideoSubtitleChecksumTuple = readonly [
  id: string,
  videoId: string,
  languageId: string,
  edition: string,
  primary: boolean,
  vttSrc: string | null,
  vttVersion: number,
  srtSrc: string | null,
  srtVersion: number,
  value: string,
]

type VideoSubtitleChecksumBucketTuple = readonly [
  videoId: string,
  count: number,
  checksum: string,
]

export function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"))
}

export function videoSubtitleChecksum(canonicalValue: string): string {
  return `sha256:${createHash("sha256")
    .update(canonicalValue, "utf8")
    .digest("hex")}`
}

function toChecksumRecord(
  source: VideoSubtitleChecksumSourceRecord,
): CoreVideoSubtitleChecksumRecord {
  return {
    ...source,
    value: source.vttSrc ?? source.srtSrc ?? "",
  }
}

function toChecksumTuple(
  record: CoreVideoSubtitleChecksumRecord,
): VideoSubtitleChecksumTuple {
  return [
    record.id,
    record.videoId,
    record.languageId,
    record.edition,
    record.primary,
    record.vttSrc,
    record.vttVersion,
    record.srtSrc,
    record.srtVersion,
    record.value,
  ]
}

function sortChecksumRecords(
  sources: readonly VideoSubtitleChecksumSourceRecord[],
): CoreVideoSubtitleChecksumRecord[] {
  return sources
    .map(toChecksumRecord)
    .sort((left, right) => compareUtf8(left.id, right.id))
}

function serializeChecksumRecords(
  videoId: string,
  records: readonly CoreVideoSubtitleChecksumRecord[],
): string {
  return JSON.stringify([
    VIDEO_SUBTITLE_BUCKET_DOMAIN,
    VIDEO_SUBTITLE_CHECKSUM_VERSION,
    videoId,
    records.map(toChecksumTuple),
  ])
}

export function serializeVideoSubtitleChecksumBucket(
  videoId: string,
  sources: readonly VideoSubtitleChecksumSourceRecord[],
): string {
  return serializeChecksumRecords(videoId, sortChecksumRecords(sources))
}

export function serializeVideoSubtitleChecksumRoot(
  totalCount: number,
  buckets: readonly CoreVideoSubtitleChecksumBucket[],
): string {
  const bucketTuples: VideoSubtitleChecksumBucketTuple[] = [...buckets]
    .sort((left, right) => compareUtf8(left.videoId, right.videoId))
    .map(({ videoId, count, checksum }) => [videoId, count, checksum])

  return JSON.stringify([
    VIDEO_SUBTITLE_ROOT_DOMAIN,
    VIDEO_SUBTITLE_CHECKSUM_VERSION,
    totalCount,
    bucketTuples,
  ])
}

export function buildVideoSubtitleChecksumManifest(
  sources: readonly VideoSubtitleChecksumSourceRecord[],
  detailsForVideoIds: readonly string[] = [],
): CoreVideoSubtitleChecksumManifest {
  const requestedVideoIds = [...new Set(detailsForVideoIds)].sort(compareUtf8)
  const requestedVideoIdSet = new Set(requestedVideoIds)
  const sourcesByVideoId = new Map<
    string,
    VideoSubtitleChecksumSourceRecord[]
  >()

  for (const source of sources) {
    const bucket = sourcesByVideoId.get(source.videoId)
    if (bucket == null) {
      sourcesByVideoId.set(source.videoId, [source])
    } else {
      bucket.push(source)
    }
  }

  const recordsByVideoId = new Map<string, CoreVideoSubtitleChecksumRecord[]>()
  const buckets = [...sourcesByVideoId.entries()]
    .sort(([left], [right]) => compareUtf8(left, right))
    .map(([videoId, videoSources]): CoreVideoSubtitleChecksumBucket => {
      const records = sortChecksumRecords(videoSources)
      if (requestedVideoIdSet.has(videoId)) {
        recordsByVideoId.set(videoId, records)
      }
      return {
        videoId,
        count: records.length,
        checksum: videoSubtitleChecksum(
          serializeChecksumRecords(videoId, records),
        ),
      }
    })

  const totalCount = sources.length
  const rootChecksum = videoSubtitleChecksum(
    serializeVideoSubtitleChecksumRoot(totalCount, buckets),
  )
  const bucketsByVideoId = new Map(
    buckets.map((bucket) => [bucket.videoId, bucket]),
  )
  const details = requestedVideoIds.map(
    (videoId): CoreVideoSubtitleChecksumDetail => {
      const records = recordsByVideoId.get(videoId) ?? []
      const bucket = bucketsByVideoId.get(videoId)
      return {
        videoId,
        count: records.length,
        checksum:
          bucket?.checksum ??
          videoSubtitleChecksum(serializeChecksumRecords(videoId, records)),
        records,
      }
    },
  )

  return {
    version: VIDEO_SUBTITLE_CHECKSUM_VERSION,
    snapshot: `subtitle-sync:v1:${rootChecksum}`,
    totalCount,
    rootChecksum,
    buckets,
    details,
  }
}

function assertUniqueRequestedIds(requestedVideoIds: readonly string[]): void {
  if (requestedVideoIds.length > MAX_VIDEO_SUBTITLE_DETAIL_IDS) {
    throw new Error(
      `Subtitle checksum details accept at most ${MAX_VIDEO_SUBTITLE_DETAIL_IDS} video IDs`,
    )
  }
  if (new Set(requestedVideoIds).size !== requestedVideoIds.length) {
    throw new Error(
      "Subtitle checksum detail request contains duplicate video IDs",
    )
  }
}

function assertSameVideoIdSet(
  actualVideoIds: readonly string[],
  requestedVideoIds: readonly string[],
): void {
  const actual = [...actualVideoIds].sort(compareUtf8)
  const requested = [...requestedVideoIds].sort(compareUtf8)
  if (
    actual.length !== requested.length ||
    actual.some((videoId, index) => videoId !== requested[index])
  ) {
    throw new Error(
      "Subtitle checksum details must exactly match requested video IDs",
    )
  }
}

/**
 * Parses and verifies the complete external manifest boundary. This is stricter
 * than shape validation: counts, root bytes, requested detail membership, and
 * every detailed bucket are independently recomputed before callers can write.
 */
export function validateVideoSubtitleChecksumManifest(
  input: unknown,
  requestedVideoIds: readonly string[] = [],
): CoreVideoSubtitleChecksumManifest {
  assertUniqueRequestedIds(requestedVideoIds)
  const manifest = CoreVideoSubtitleChecksumManifestSchema.parse(input)

  if (manifest.version !== VIDEO_SUBTITLE_CHECKSUM_VERSION) {
    throw new Error(
      `Unsupported video subtitle checksum version: ${manifest.version}`,
    )
  }

  const bucketVideoIds = new Set<string>()
  for (const bucket of manifest.buckets) {
    if (bucketVideoIds.has(bucket.videoId)) {
      throw new Error(
        `Subtitle checksum manifest has duplicate bucket videoId: ${bucket.videoId}`,
      )
    }
    bucketVideoIds.add(bucket.videoId)
  }

  const bucketCountSum = manifest.buckets.reduce(
    (sum, bucket) => sum + bucket.count,
    0,
  )
  if (bucketCountSum !== manifest.totalCount) {
    throw new Error(
      `Subtitle checksum bucket count sum ${bucketCountSum} does not match totalCount ${manifest.totalCount}`,
    )
  }

  const expectedRootChecksum = videoSubtitleChecksum(
    serializeVideoSubtitleChecksumRoot(manifest.totalCount, manifest.buckets),
  )
  if (manifest.rootChecksum !== expectedRootChecksum) {
    throw new Error("Subtitle checksum manifest root checksum is inconsistent")
  }
  if (manifest.snapshot !== `subtitle-sync:v1:${manifest.rootChecksum}`) {
    throw new Error("Subtitle checksum manifest snapshot is inconsistent")
  }

  const detailVideoIds = new Set<string>()
  const detailRecordIds = new Set<string>()
  const bucketsByVideoId = new Map(
    manifest.buckets.map((bucket) => [bucket.videoId, bucket]),
  )

  for (const detail of manifest.details) {
    if (detailVideoIds.has(detail.videoId)) {
      throw new Error(
        `Subtitle checksum manifest has duplicate detail videoId: ${detail.videoId}`,
      )
    }
    detailVideoIds.add(detail.videoId)

    if (detail.count !== detail.records.length) {
      throw new Error(
        `Subtitle checksum detail count is inconsistent for video ${detail.videoId}`,
      )
    }

    for (const record of detail.records) {
      if (record.videoId !== detail.videoId) {
        throw new Error(
          `Subtitle checksum detail contains a record for the wrong video: ${record.id}`,
        )
      }
      if (detailRecordIds.has(record.id)) {
        throw new Error(
          `Subtitle checksum details contain duplicate record ID: ${record.id}`,
        )
      }
      detailRecordIds.add(record.id)
      const expectedValue = record.vttSrc ?? record.srtSrc ?? ""
      if (record.value !== expectedValue) {
        throw new Error(
          `Subtitle checksum detail has an inconsistent derived value: ${record.id}`,
        )
      }
    }

    const detailSources: VideoSubtitleChecksumSourceRecord[] =
      detail.records.map(({ value: _value, ...record }) => record)
    const expectedDetailChecksum = videoSubtitleChecksum(
      serializeVideoSubtitleChecksumBucket(detail.videoId, detailSources),
    )
    if (detail.checksum !== expectedDetailChecksum) {
      throw new Error(
        `Subtitle checksum detail checksum is inconsistent for video ${detail.videoId}`,
      )
    }

    const bucket = bucketsByVideoId.get(detail.videoId)
    if (bucket == null) {
      if (detail.count !== 0) {
        throw new Error(
          `Subtitle checksum detail has records but no bucket for video ${detail.videoId}`,
        )
      }
    } else if (
      detail.count !== bucket.count ||
      detail.checksum !== bucket.checksum
    ) {
      throw new Error(
        `Subtitle checksum detail does not match its bucket for video ${detail.videoId}`,
      )
    }
  }

  assertSameVideoIdSet([...detailVideoIds], requestedVideoIds)
  return manifest
}

const VIDEO_SUBTITLE_CHECKSUM_MANIFEST_QUERY = /* GraphQL */ `
  query VideoSubtitleChecksumManifest(
    $detailsForVideoIds: [ID!]
    $expectedSnapshot: String
  ) {
    videoSubtitleChecksumManifest(
      detailsForVideoIds: $detailsForVideoIds
      expectedSnapshot: $expectedSnapshot
    ) {
      version
      snapshot
      totalCount
      rootChecksum
      buckets {
        videoId
        count
        checksum
      }
      details {
        videoId
        count
        checksum
        records: subtitles {
          id
          videoId
          languageId
          edition
          primary
          vttSrc
          vttVersion
          srtSrc
          srtVersion
          value
        }
      }
    }
  }
`

export type FetchVideoSubtitleChecksumManifestOptions = {
  detailsForVideoIds?: readonly string[]
  expectedSnapshot?: string
}

export async function fetchVideoSubtitleChecksumManifest(
  options: FetchVideoSubtitleChecksumManifestOptions = {},
): Promise<CoreVideoSubtitleChecksumManifest> {
  const detailsForVideoIds = options.detailsForVideoIds ?? []
  assertUniqueRequestedIds(detailsForVideoIds)

  const result = await coreQuery<{
    videoSubtitleChecksumManifest: unknown
  }>(
    VIDEO_SUBTITLE_CHECKSUM_MANIFEST_QUERY,
    {
      detailsForVideoIds: [...detailsForVideoIds],
      expectedSnapshot: options.expectedSnapshot,
    },
    { requireInteropToken: true },
  )
  if (result.data == null) {
    throw new Error("Core subtitle checksum manifest response has no data")
  }

  const manifest = validateVideoSubtitleChecksumManifest(
    result.data.videoSubtitleChecksumManifest,
    detailsForVideoIds,
  )
  if (
    options.expectedSnapshot != null &&
    manifest.snapshot !== options.expectedSnapshot
  ) {
    throw new Error("Core subtitle checksum manifest snapshot changed")
  }
  return manifest
}

export type {
  CoreVideoSubtitleChecksumBucket,
  CoreVideoSubtitleChecksumDetail,
  CoreVideoSubtitleChecksumManifest,
  CoreVideoSubtitleChecksumRecord,
} from "./schemas/video-subtitle-manifest"
