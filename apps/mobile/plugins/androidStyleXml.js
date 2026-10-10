/**
 * Shared helpers for the config plugins that write Android `styles.xml`.
 *
 * More than one plugin mutates the SAME `AppTheme` style in a single prebuild
 * pass. Two copies of the item-matching logic can drift apart and then disagree
 * about how items land on that one style, which no compiler or per-plugin suite
 * would catch. This module is the single place that logic may live.
 *
 * Dependency-free on purpose: it must be requirable from a plugin whose own
 * `expo/config-plugins` require failed.
 */

/** Replace-or-append one <item name=…> on a style object, in place. */
function setItem(style, name, value) {
  if (!Array.isArray(style.item)) style.item = []
  const existing = style.item.find((entry) => entry.$?.name === name)
  if (existing) {
    existing._ = value
    return
  }
  style.item.push({ $: { name }, _: value })
}

/** Find a style by name, or undefined. Never throws. */
function findStyle(resources, name) {
  return (resources.style ?? []).find((entry) => entry.$?.name === name)
}

/**
 * Find a style by name, throwing `message` when it is absent.
 * Used for styles a plugin's output is worthless without, so prebuild fails
 * loudly instead of emitting items that reach nothing.
 */
function getRequiredStyle(resources, name, message) {
  const style = findStyle(resources, name)
  if (!style) throw new Error(message)
  return style
}

module.exports = { setItem, findStyle, getRequiredStyle }
