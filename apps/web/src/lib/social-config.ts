/**
 * Social/share config (e.g. Facebook app id). Centralized so route logic does not branch on env.
 */

export function getSocialConfig(): { fbAppId?: string } {
  return {
    fbAppId: process.env.NEXT_PUBLIC_FACEBOOK_APP_ID,
  }
}
