export type LanguageChange = {
  id: string
  sourceKey: string
  oldLanguage: string | null
  newLanguage: string | null
  detectorModel?: string
}

export interface LanguageMaintenanceStore {
  applyLanguageChanges(
    sourceKey: string,
    changes: ReadonlyArray<Omit<LanguageChange, "sourceKey">>,
  ): Promise<LanguageChange[]>
  revertLanguageChanges(
    changes: ReadonlyArray<{
      id: string
      sourceKey: string
      expectedLanguage: string | null
      restoreLanguage: string | null
    }>,
  ): Promise<number>
}

export async function applySourceChanges(
  store: LanguageMaintenanceStore,
  sourceKey: string,
  changes: ReadonlyArray<Omit<LanguageChange, "sourceKey">>,
  append: (line: string) => void | Promise<void>,
  detectorModel?: string,
): Promise<LanguageChange[]> {
  const committed = await store.applyLanguageChanges(sourceKey, changes)
  const withProvenance = committed.map((change) => ({
    ...change,
    ...(detectorModel ? { detectorModel } : {}),
  }))
  for (const change of withProvenance)
    await append(`${JSON.stringify(change)}\n`)
  return withProvenance
}

export async function revertChanges(
  store: LanguageMaintenanceStore,
  changes: readonly LanguageChange[],
): Promise<number> {
  return store.revertLanguageChanges(
    changes.map(({ id, sourceKey, oldLanguage, newLanguage }) => ({
      id,
      sourceKey,
      expectedLanguage: newLanguage,
      restoreLanguage: oldLanguage,
    })),
  )
}
