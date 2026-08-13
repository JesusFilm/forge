import { createHash } from "node:crypto"

export const TYPESENSE_WATCH_EXACT_TITLE_KEYS_FIELD = "title_exact_keys"
export const TYPESENSE_WATCH_EXACT_TITLE_KEY_BYTES = 16

export function normalizeTypesenseWatchExactTitle(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/([\p{Ll}\p{Nd}])(\p{Lu})/gu, "$1 $2")
    .replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, "$1 $2")
    .replace(/[\p{P}\p{S}_]+/gu, " ")
    .toLowerCase()
    .replace(/\u0307/gu, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .join(" ")
}

export function typesenseWatchExactTitleKey(value: string): string | null {
  const normalized = normalizeTypesenseWatchExactTitle(value)
  if (!normalized) return null

  return createHash("sha256")
    .update(normalized, "utf8")
    .digest("hex")
    .slice(0, TYPESENSE_WATCH_EXACT_TITLE_KEY_BYTES * 2)
}
