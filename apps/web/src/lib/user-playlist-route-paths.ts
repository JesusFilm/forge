/**
 * Server redirects are relative to Next's configured `/watch` base path.
 * Return-to values remain browser-visible public paths and therefore retain it.
 */
export function userPlaylistServerLoginPath(returnTo: string): string {
  return `/api/auth/login?returnTo=${encodeURIComponent(returnTo)}`
}
