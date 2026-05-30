import {
  getDefaultWatchCallbackOrigins,
  resolveWatchCallbackURL as resolveSharedWatchCallbackURL,
} from "@forge/watch-url-policy"

export function resolveWatchCallbackURL(
  value: string | null | undefined,
  extraAllowedOrigins: string[] = [],
): string | undefined {
  return resolveSharedWatchCallbackURL(value, [
    ...getDefaultWatchCallbackOrigins(process.env.NODE_ENV),
    ...extraAllowedOrigins,
  ])
}
