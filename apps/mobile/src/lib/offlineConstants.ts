// Offline-download tunables shared by the provider (per-call storage guard) and
// the series sheet's aggregate pre-check. Lives in lib so seriesDownloadEnqueue
// (a lib) never has to import from a context — keeps the dependency arrow lib→lib.

/**
 * Keep this much storage free; refuse a download that would breach it (U12).
 * The series download sheet runs the same aggregate pre-check the per-call guard
 * applies, before driving the batch (KTD6).
 */
export const STORAGE_RESERVE_BYTES = 250 * 1024 * 1024
