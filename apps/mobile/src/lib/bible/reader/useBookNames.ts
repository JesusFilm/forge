// The shown translation's own book names, or null for the English names.
// The reader calls it for each translation it shows, so the names are ready
// in memory by the time the passage picker opens.
import { useEffect, useSyncExternalStore } from "react"

import type {
  BookNames,
  BookNamesKey,
  BookNamesStore,
} from "../repository/bookNames"
import { bookByUsfm, type UsfmBookId } from "../text/books"

export function useBookNames(
  store: Pick<BookNamesStore, "peek" | "load" | "subscribe">,
  translation: BookNamesKey | null,
): BookNames | null {
  const id = translation?.id ?? null
  const sha256 = translation?.sha256 ?? null
  const names = useSyncExternalStore(store.subscribe, () =>
    id === null ? null : store.peek(id),
  )
  useEffect(() => {
    if (id === null || sha256 === null) return
    void store.load({ id, sha256 })
  }, [store, id, sha256])
  return names
}

/** A book's name in the shown translation, else its English name. */
export function bookNameIn(names: BookNames | null, book: UsfmBookId): string {
  return names?.get(book) ?? bookByUsfm(book).name
}
