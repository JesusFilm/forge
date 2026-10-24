// Core reference phases write large pages from the external Core API. The
// default Prisma interactive transaction budget is too small for production
// pages, especially language/country locale fan-out.
export const CORE_SYNC_TRANSACTION_OPTIONS = {
  timeout: 300_000,
  maxWait: 10_000,
} as const
