/**
 * Builds a values object that lets next-intl format any ICU message without
 * a missing-argument error: numeric args (plural/selectordinal/number) get
 * 2, other args get "Sample", rich-text tags get a passthrough renderer.
 * Shared by the catalog tests that format whole catalogs.
 */
export function icuSampleValues(message: string): Record<string, unknown> {
  const values: Record<string, unknown> = {}
  const numericVariables = new Set(
    [
      ...message.matchAll(
        /\{([A-Za-z][A-Za-z0-9_]*)\s*,\s*(?:plural|selectordinal|number)\b/g,
      ),
    ].map((match) => match[1]),
  )
  for (const match of message.matchAll(
    /\{([A-Za-z][A-Za-z0-9_]*)\s*(?:,|\})/g,
  )) {
    values[match[1]] = numericVariables.has(match[1]) ? 2 : "Sample"
  }
  for (const match of message.matchAll(/<\/?([A-Za-z][A-Za-z0-9_]*)>/g)) {
    values[match[1]] = (chunks: unknown) => chunks
  }
  return values
}
