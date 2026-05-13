// Single source of truth for the language-preference cookie name. Both the
// client write helper (apps/web/src/lib/language-preference-client.ts) and
// the server read helper (apps/web/src/lib/language-preference-server.ts)
// import this. A rename touches one file instead of two.
export const LANGUAGE_PREFERENCE_COOKIE = "forge_watch_lang"
