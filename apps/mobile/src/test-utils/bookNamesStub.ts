// A book-name store for reader suites: nothing on the device, and a "network"
// that answers from `byTranslation`. An absent translation reads English.
import {
  createBookNamesStore,
  type BookNames,
  type BookNamesStore,
} from "../lib/bible/repository/bookNames"

export function stubBookNamesStore(
  byTranslation: Record<string, BookNames> = {},
): BookNamesStore {
  return createBookNamesStore({
    fetchNames: async (id) => byTranslation[id] ?? null,
    readStored: async () => null,
    writeStored: () => {},
  })
}
