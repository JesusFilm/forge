export function buildWatchContentSecurityPolicy(options?: {
  adminGraphqlUrl?: string
  datadogSite?: string
}): string

export function datadogIntakeHost(site?: string): string

export const WATCH_ENFORCED_CSP: "frame-ancestors 'self'"

export const WATCH_REFERRER_POLICY: "strict-origin"

export function buildWatchSecurityHeaders(options?: {
  adminGraphqlUrl?: string
  datadogSite?: string
  enforceContentSecurityPolicy?: boolean
}): { key: string; value: string }[]
