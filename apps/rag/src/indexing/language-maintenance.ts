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
  previewLanguageReverts(
    changes: ReadonlyArray<{
      id: string
      sourceKey: string
      expectedLanguage: string | null
    }>,
  ): Promise<number>
}

const reversalRows = (changes: readonly LanguageChange[]) =>
  changes.map(({ id, sourceKey, oldLanguage, newLanguage }) => ({
    id,
    sourceKey,
    expectedLanguage: newLanguage,
    restoreLanguage: oldLanguage,
  }))

export async function applySourceChanges(
  store: LanguageMaintenanceStore,
  sourceKey: string,
  changes: ReadonlyArray<Omit<LanguageChange, "sourceKey">>,
  append: (content: string) => void | Promise<void>,
  detectorModel?: string,
): Promise<LanguageChange[]> {
  const committed = await store.applyLanguageChanges(sourceKey, changes)
  const recorded = committed.map((change) => ({
    ...change,
    ...(detectorModel ? { detectorModel } : {}),
  }))
  if (recorded.length === 0) return recorded

  try {
    await append(
      recorded.map((change) => JSON.stringify(change)).join("\n") + "\n",
    )
  } catch (error) {
    const reverted = await store.revertLanguageChanges(reversalRows(recorded))
    if (reverted !== recorded.length)
      throw new AggregateError(
        [error],
        `language audit failed and compensation reverted ${reverted}/${recorded.length} rows`,
      )
    throw error
  }
  return recorded
}

export function previewReverts(
  store: LanguageMaintenanceStore,
  changes: readonly LanguageChange[],
): Promise<number> {
  return store.previewLanguageReverts(
    reversalRows(changes).map(({ id, sourceKey, expectedLanguage }) => ({
      id,
      sourceKey,
      expectedLanguage,
    })),
  )
}

export function revertChanges(
  store: LanguageMaintenanceStore,
  changes: readonly LanguageChange[],
): Promise<number> {
  return store.revertLanguageChanges(reversalRows(changes))
}
