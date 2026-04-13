export function formatLanguageSummary(
  languageIds: string[],
  languageNamesByCoreId: ReadonlyMap<string, string>,
): string {
  if (languageIds.length === 0) return "None"
  return languageIds
    .map((languageId) => languageNamesByCoreId.get(languageId) ?? languageId)
    .join(", ")
}
