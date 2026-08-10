type VideoLocaleCandidate = {
  locale: string | null
  languageSlug?: string | null
  title?: string | null
  description?: string | null
}

function baseLocale(locale: string): string {
  return locale.split("-")[0] ?? locale
}

export function videoDisplayLocaleFilters(locale: string) {
  const broadLocale = baseLocale(locale)

  return [
    { locale },
    ...(broadLocale !== locale ? [{ locale: broadLocale }] : []),
    { locale: "en" },
    { languageSlug: "english" },
  ]
}

export function selectVideoDisplayLocaleCandidates<
  Row extends VideoLocaleCandidate,
>(rows: readonly Row[], locale: string) {
  const broadLocale = baseLocale(locale)
  const exactRows = rows.filter((row) => row.locale === locale)
  const broadRows =
    broadLocale === locale
      ? []
      : rows.filter((row) => row.locale === broadLocale)
  const requestedRows = [...exactRows, ...broadRows]

  return {
    preferredRow: requestedRows[0] ?? null,
    requestedTitles: requestedRows.map((row) => row.title),
    englishTitles: rows
      .filter((row) => row.locale === "en" || row.languageSlug === "english")
      .map((row) => row.title),
  }
}
