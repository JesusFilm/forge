// Manual mock for the native keychain, backed by an in-memory map so tests can
// assert real round trips (write then read back) rather than only that a call
// happened. Call `__reset()` between tests that share keys.
const store = new Map<string, string>()

export async function setItemAsync(key: string, value: string): Promise<void> {
  store.set(key, value)
}

export async function getItemAsync(key: string): Promise<string | null> {
  return store.has(key) ? (store.get(key) as string) : null
}

export async function deleteItemAsync(key: string): Promise<void> {
  store.delete(key)
}

export async function isAvailableAsync(): Promise<boolean> {
  return true
}

export function __reset(): void {
  store.clear()
}
