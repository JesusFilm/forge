// The typed failures of the Bible text repository (feat-553 U4). Every public
// call returns one of these instead of throwing, so the reader never sees an
// unhandled rejection.

/** Why a chapter cannot show. The reader shows R31's message for each. */
export const CHAPTER_FAILURE_REASONS = [
  /** The request did not reach bible.helloao.org. */
  "offline",
  /** No complete answer came within `CHAPTER_FETCH_TIMEOUT_MS`. */
  "timeout",
  /** The body passed `CHAPTER_MAX_BYTES`. */
  "too-large",
  /** HTTP 404: the translation has no such chapter. */
  "not-found",
  /** Another status that is not 2xx. */
  "http-status",
  /** The body was not JSON, U1 refused it, or it named another chapter. */
  "malformed-text",
  /** A device read failed in a way that no other reason names. */
  "unavailable",
] as const

export type ChapterFailureReason = (typeof CHAPTER_FAILURE_REASONS)[number]

export type ChapterFailure = {
  status: "failed"
  reason: ChapterFailureReason
  /** Set for `not-found` and `http-status`. */
  httpStatus?: number
}

export function chapterFailure(
  reason: ChapterFailureReason,
  httpStatus?: number,
): ChapterFailure {
  return httpStatus === undefined
    ? { status: "failed", reason }
    : { status: "failed", reason, httpStatus }
}

/** Why a whole-translation download stopped. Each one offers a retry (R29). */
export const DOWNLOAD_FAILURE_REASONS = [
  /** The transfer failed or stopped. */
  "network",
  /** The device has less free space than the download needs. */
  "no-space",
  /** The catalog size or the transfer passed `MAX_DOWNLOAD_BYTES`. */
  "too-large",
  /** The file was not a translation that U1 accepts. */
  "invalid-data",
  /** A book file or the manifest did not write. */
  "write-failed",
] as const

export type DownloadFailureReason = (typeof DOWNLOAD_FAILURE_REASONS)[number]

/** Thrown inside a download to stop it. The store turns it into a state. */
export class BibleDownloadError extends Error {
  readonly reason: DownloadFailureReason

  constructor(reason: DownloadFailureReason) {
    super(`Bible download stopped: ${reason}`)
    this.name = "BibleDownloadError"
    this.reason = reason
  }
}
