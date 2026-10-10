/**
 * `watch-bootstrap-v1`: the one same-origin, private/no-store read that the
 * Watch shell makes after hydration to learn who the visitor is.
 *
 * It folds three formerly independent GETs into one round trip:
 * - account session (`/watch/api/auth/session`) for `AccountControl`
 * - global beta tester CTA flag (`/watch/api/beta-tester-cta`)
 * - signed-in watch progress (`GET /watch/api/watch-progress`)
 *
 * Each section degrades independently to `null`, which consumers treat the
 * same way they treated a failed request to the old endpoint: the account
 * control hides, the floating CTA stays off, and watch progress stays local.
 *
 * Client-safe: types and parsers only, no server imports.
 */

export const WATCH_BOOTSTRAP_CONTRACT = "watch-bootstrap-v1"
export const WATCH_BOOTSTRAP_PATH = "/watch/api/bootstrap"

export type WatchAccountUser = {
  id?: string
  email?: string
  name?: string
  image?: string
}

export type WatchAccountSession =
  | {
      accountGateEnabled: boolean
      authenticated: true
      user?: WatchAccountUser
    }
  | {
      accountGateEnabled: boolean
      authenticated: false
      loginUrl?: string
    }

export type WatchBetaTesterCta = { enabled: boolean }

export type WatchBootstrapProgressEntry = {
  videoId: string
  languageSlug?: string | null
  positionSeconds: number
  durationSeconds: number
  updatedAt: string
}

export type WatchBootstrapProgress =
  | {
      authenticated: true
      userId: string
      entries: WatchBootstrapProgressEntry[]
    }
  | { authenticated: false; userId: null; entries: [] }

export type WatchBootstrapResponse = {
  contractVersion: typeof WATCH_BOOTSTRAP_CONTRACT
  account: WatchAccountSession | null
  betaTesterCta: WatchBetaTesterCta | null
  watchProgress: WatchBootstrapProgress | null
}

const ACCOUNT_USER_FIELDS = [
  "id",
  "email",
  "name",
  "image",
] as const satisfies readonly (keyof WatchAccountUser)[]

/**
 * Parses an untrusted bootstrap body section by section. Returns `null` only
 * when the envelope itself is unusable; an invalid section becomes `null`
 * without discarding its valid siblings.
 */
export function parseWatchBootstrapResponse(
  value: unknown,
): WatchBootstrapResponse | null {
  if (!isRecord(value)) return null
  if (value.contractVersion !== WATCH_BOOTSTRAP_CONTRACT) return null

  return {
    contractVersion: WATCH_BOOTSTRAP_CONTRACT,
    account: isAccountSession(value.account) ? value.account : null,
    betaTesterCta:
      isRecord(value.betaTesterCta) &&
      typeof value.betaTesterCta.enabled === "boolean"
        ? { enabled: value.betaTesterCta.enabled }
        : null,
    watchProgress: parseWatchProgress(value.watchProgress),
  }
}

function isAccountSession(value: unknown): value is WatchAccountSession {
  if (!isRecord(value)) return false
  if (typeof value.accountGateEnabled !== "boolean") return false
  if (typeof value.authenticated !== "boolean") return false
  if (!value.authenticated && value.user !== undefined) return false
  if (value.user !== undefined && !isAccountUser(value.user)) return false
  if (value.loginUrl !== undefined && typeof value.loginUrl !== "string") {
    return false
  }

  return true
}

function isAccountUser(value: unknown): value is WatchAccountUser {
  if (!isRecord(value)) return false

  return ACCOUNT_USER_FIELDS.every(
    (field) => value[field] === undefined || typeof value[field] === "string",
  )
}

function parseWatchProgress(value: unknown): WatchBootstrapProgress | null {
  if (!isRecord(value)) return null
  if (value.authenticated !== true) {
    return value.authenticated === false
      ? { authenticated: false, userId: null, entries: [] }
      : null
  }
  if (typeof value.userId !== "string") return null

  return {
    authenticated: true,
    userId: value.userId,
    entries: parseWatchProgressEntries(value.entries),
  }
}

export function parseWatchProgressEntries(
  value: unknown,
): WatchBootstrapProgressEntry[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry): WatchBootstrapProgressEntry[] =>
    isRecord(entry) &&
    typeof entry.videoId === "string" &&
    typeof entry.positionSeconds === "number" &&
    typeof entry.durationSeconds === "number" &&
    typeof entry.updatedAt === "string"
      ? [
          {
            videoId: entry.videoId,
            languageSlug:
              typeof entry.languageSlug === "string"
                ? entry.languageSlug
                : null,
            positionSeconds: entry.positionSeconds,
            durationSeconds: entry.durationSeconds,
            updatedAt: entry.updatedAt,
          },
        ]
      : [],
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value)
}
