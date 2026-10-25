import {
  getDefaultWatchCallbackOrigins,
  resolveWatchCallbackURL as resolveSharedWatchCallbackURL,
} from "@forge/watch-url-policy/callbacks"

export function resolveWatchCallbackURL(
  value: string | null | undefined,
  extraAllowedOrigins: string[] = [],
): string | undefined {
  return resolveSharedWatchCallbackURL(value, [
    ...getDefaultWatchCallbackOrigins(process.env.NODE_ENV),
    ...extraAllowedOrigins,
  ])
}
