const ROMANIAN_JESUS_QUERY = /^(?:iisus|isus)$/u

function normalizedQueryKey(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("ro")
}

export function watchSearchQueryVariants(
  query: string,
  targetLanguageSlug: string,
): string[] {
  const variants = [query]
  if (
    targetLanguageSlug === "romanian" &&
    ROMANIAN_JESUS_QUERY.test(normalizedQueryKey(query))
  ) {
    variants.push("JESUS")
  }
  return variants.filter(
    (value, index, all) =>
      all.findIndex(
        (candidate) =>
          normalizedQueryKey(candidate) === normalizedQueryKey(value),
      ) === index,
  )
}
