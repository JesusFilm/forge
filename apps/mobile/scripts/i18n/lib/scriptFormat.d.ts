// Types for scriptFormat.js, the text helpers that the i18n scripts share.

export function formatWithPrettier(
  source: string,
  settings: {
    repoDir: string
    configFile: string
    options: Record<string, unknown>
    optional?: boolean
  },
): Promise<string>
export function objectKey(key: string): string
export function list(
  items: readonly string[],
  limit?: number,
  empty?: string,
): string
export function plural(count: number, word: string): string
