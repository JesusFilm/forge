"use strict"
/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, module */
// Text helpers that the i18n scripts share: Prettier output, keys in generated
// objects, and short lists for the console and the CI job summary.

const { createRequire } = require("module")
const path = require("path")

// With `optional`, a missing Prettier returns `source` unchanged.
async function formatWithPrettier(
  source,
  { repoDir, configFile, options, optional = false },
) {
  let prettier
  try {
    prettier = createRequire(path.join(repoDir, "package.json"))("prettier")
  } catch (error) {
    if (!optional) throw error
    return source
  }
  const config = await prettier.resolveConfig(configFile)
  return prettier.format(source, { ...config, ...options })
}

const UNSAFE_CODE_CHARS = {
  "<": "\\u003C",
  ">": "\\u003E",
  "\b": "\\b",
  "\f": "\\f",
  "\n": "\\n",
  "\r": "\\r",
  "\t": "\\t",
  "\0": "\\0",
  "\u2028": "\\u2028",
  "\u2029": "\\u2029",
}

// A value as a JS literal for generated source. JSON.stringify alone leaves
// characters that can end a script tag or a line in some parsers.
function codeString(value) {
  return JSON.stringify(value).replace(
    /[<>\b\f\n\r\t\0\u2028\u2029]/g,
    (char) => UNSAFE_CODE_CHARS[char],
  )
}

function objectKey(key) {
  return /^[A-Za-z_$][\w$]*$/.test(key) ? key : codeString(key)
}

function list(items, limit = 12, empty = "") {
  if (items.length === 0) return empty
  const shown = items.slice(0, limit).join(", ")
  return items.length > limit
    ? `${shown}, and ${items.length - limit} more`
    : shown
}

function plural(count, word) {
  return `${count} ${word}${count === 1 ? "" : "s"}`
}

module.exports = { codeString, formatWithPrettier, list, objectKey, plural }
