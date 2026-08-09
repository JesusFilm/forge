// Manual mock for the native keychain. Backed by an in-memory map so tests can
// assert real round trips (write then read) rather than only that a call was
// made. Reset between tests with `require("expo-secure-store").__reset()`.
const store = new Map()

exports.setItemAsync = async (key, value) => {
  store.set(key, value)
}
exports.getItemAsync = async (key) => (store.has(key) ? store.get(key) : null)
exports.deleteItemAsync = async (key) => {
  store.delete(key)
}
exports.isAvailableAsync = async () => true

exports.__reset = () => store.clear()
exports.__store = store
