/** Display labels only; saved component property keys remain untouched. */
export function componentFieldLabel(key: string) {
  const words = key
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}
