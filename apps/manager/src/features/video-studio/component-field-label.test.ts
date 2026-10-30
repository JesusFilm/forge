import { expect, it } from "vitest"
import { componentFieldLabel } from "./component-field-label"

it.each([
  ["fadeoutsec", "Fadeoutsec"],
  ["fadeInSec", "Fade In Sec"],
  ["fadeOutSeconds", "Fade Out Seconds"],
  ["fontSize", "Font Size"],
  ["backgroundColor", "Background Color"],
  ["HTTPResponse", "HTTP Response"],
  ["text_color", "Text color"],
  ["line-height", "Line height"],
  ["opacity", "Opacity"],
])("formats %s as %s", (key, expected) => {
  expect(componentFieldLabel(key)).toBe(expected)
})
