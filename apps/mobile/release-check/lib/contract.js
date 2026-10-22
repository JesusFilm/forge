"use strict"
/* global module */
// The command-line contract of the release check (KTD13): the modes, their
// flags, the exit codes, the refusal text, and the summary schema check. The
// parser reads MODES only, so a later unit adds a mode or a flag as data.

const COMMAND = "node apps/mobile/release-check/cli.mjs"

const EXIT = Object.freeze({ passed: 0, failed: 1, refused: 2 })

const FAILURE_CLASSES = Object.freeze([
  "assertion_failed",
  "selector_not_found",
  "app_crashed",
  "app_unresponsive",
  "device_unresponsive",
  "driver_failed",
  "rate_limited",
  "request_blocked",
  "missing_search_answer",
  "memory_pressure_kill",
])

const BOOLEAN = Object.freeze({ kind: "boolean" })
const JSON_FLAG = Object.freeze({ "--json": BOOLEAN })

function value(placeholder, rules = {}) {
  return Object.freeze({ kind: "value", placeholder, ...rules })
}

function list(placeholder) {
  return Object.freeze({ kind: "list", placeholder })
}

const MODES = Object.freeze({
  plan: { flags: JSON_FLAG, example: "plan --json" },
  setup: { flags: { "--check": BOOLEAN }, example: "setup --check" },
  run: {
    flags: {
      "--yes": BOOLEAN,
      "--expect-commit": value("<sha>", { pattern: /^[0-9a-f]{7,40}$/ }),
      "--allow-setup": BOOLEAN,
      "--detach": BOOLEAN,
      "--journey": list("<ids>"),
      "--device": list("<ids>"),
      "--platform": value("<ios|android>", { oneOf: ["ios", "android"] }),
      "--skip-speed-pass": BOOLEAN,
      "--reuse-build": BOOLEAN,
      // `run --detach` passes its run id to the child it starts.
      "--run-id": value("<id>", {
        pattern: /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z-[0-9a-f]{4}$/,
      }),
    },
    example: "run --yes --expect-commit <sha> --detach",
  },
  status: { flags: JSON_FLAG, example: "status --json" },
  stop: { example: "stop" },
  recover: { example: "recover" },
  "check-lists": { flags: JSON_FLAG, example: "check-lists --json" },
  "check-screens": { flags: JSON_FLAG, example: "check-screens --json" },
  "check-build": { positionals: ["<app>"], example: "check-build <app>" },
  "check-log": { positionals: ["<log>"], example: "check-log <log>" },
  "check-settings": { example: "check-settings" },
  "record-search": { example: "record-search" },
  session: {
    subcommands: {
      up: {
        flags: { "--device": value("<name>") },
        requiredFlags: ["--device"],
        example: "session up --device <name>",
      },
      try: { positionals: ["<journey>"], example: "session try <journey>" },
      down: { example: "session down" },
    },
    example: "session up --device <name>",
  },
})

const DEFAULT_EXAMPLE_MODE = "plan"

function usageOf(name, spec) {
  if (spec.subcommands) {
    return `${name} ${Object.keys(spec.subcommands).join("|")}`
  }
  const parts = [name, ...(spec.positionals ?? [])]
  for (const [flag, flagSpec] of Object.entries(spec.flags ?? {})) {
    const required = (spec.requiredFlags ?? []).includes(flag)
    const text =
      flagSpec.kind === "boolean" ? flag : `${flag} ${flagSpec.placeholder}`
    parts.push(required ? text : `[${text}]`)
  }
  return parts.join(" ")
}

function editDistance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index)
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = row[0]
    row[0] = i
    for (let j = 1; j <= b.length; j += 1) {
      const above = row[j]
      row[j] = Math.min(
        row[j] + 1,
        row[j - 1] + 1,
        diagonal + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
      diagonal = above
    }
  }
  return row[b.length]
}

// A typo of one or two letters gets that mode as its example; anything
// further from every mode gets the plan example.
function nearestName(input, names, fallback) {
  let best = fallback
  let bestDistance = 3
  for (const name of names) {
    const distance = editDistance(input, name)
    if (distance < bestDistance) {
      best = name
      bestDistance = distance
    }
  }
  return best
}

function refusal(error, usage, example, allowed) {
  return { ok: false, error, usage, example, allowed }
}

function modeRefusal(error, input) {
  const names = Object.keys(MODES)
  const nearest = nearestName(input ?? "", names, DEFAULT_EXAMPLE_MODE)
  return refusal(error, "<mode> [flags]", MODES[nearest].example, names)
}

function specRefusal(error, label, spec) {
  return refusal(error, usageOf(label, spec), spec.example)
}

function readFlag(flag, flagSpec, next) {
  if (flagSpec.kind === "boolean") return { value: true, consumed: 0 }
  if (next === undefined || next.startsWith("--")) {
    return { error: `\`${flag}\` needs a value ${flagSpec.placeholder}` }
  }
  if (flagSpec.kind === "list") {
    const items = next.split(",").map((item) => item.trim())
    if (items.some((item) => item === "")) {
      return { error: `\`${flag}\` takes a comma-separated list with no gaps` }
    }
    return { value: items, consumed: 1 }
  }
  if (flagSpec.oneOf && !flagSpec.oneOf.includes(next)) {
    return { error: `\`${flag}\` must be one of ${flagSpec.oneOf.join(", ")}` }
  }
  if (flagSpec.pattern && !flagSpec.pattern.test(next)) {
    return { error: `\`${flag}\` does not accept \`${next}\`` }
  }
  return { value: next, consumed: 1 }
}

function parseSpec(label, spec, args) {
  const flags = {}
  const positionals = []
  const flagSpecs = spec.flags ?? {}
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg.startsWith("--")) {
      const flagSpec = flagSpecs[arg]
      if (!flagSpec) {
        return specRefusal(
          `unknown flag \`${arg}\` for \`${label}\``,
          label,
          spec,
        )
      }
      const read = readFlag(arg, flagSpec, args[index + 1])
      if (read.error) return specRefusal(read.error, label, spec)
      flags[arg.slice(2)] = read.value
      index += read.consumed
    } else {
      positionals.push(arg)
    }
  }
  const expected = spec.positionals ?? []
  if (positionals.length > expected.length) {
    return specRefusal(
      `unexpected argument \`${positionals[expected.length]}\` for \`${label}\``,
      label,
      spec,
    )
  }
  if (positionals.length < expected.length) {
    return specRefusal(
      `\`${label}\` needs ${expected[positionals.length]}`,
      label,
      spec,
    )
  }
  for (const flag of spec.requiredFlags ?? []) {
    if (!(flag.slice(2) in flags)) {
      return specRefusal(`\`${label}\` needs \`${flag}\``, label, spec)
    }
  }
  return { ok: true, flags, positionals }
}

function parseArgs(argv) {
  const [modeName, ...rest] = argv
  if (modeName === undefined) return modeRefusal("mode required", "")
  if (!Object.hasOwn(MODES, modeName)) {
    return modeRefusal(`unknown mode \`${modeName}\``, modeName)
  }
  const spec = MODES[modeName]
  if (!spec.subcommands) {
    const parsed = parseSpec(modeName, spec, rest)
    return parsed.ok ? { ...parsed, mode: modeName, subcommand: null } : parsed
  }
  const [subName, ...subRest] = rest
  if (subName === undefined || !Object.hasOwn(spec.subcommands, subName)) {
    const error =
      subName === undefined
        ? `\`${modeName}\` needs one of ${Object.keys(spec.subcommands).join(", ")}`
        : `unknown \`${modeName}\` step \`${subName}\``
    return specRefusal(error, modeName, spec)
  }
  const parsed = parseSpec(
    `${modeName} ${subName}`,
    spec.subcommands[subName],
    subRest,
  )
  return parsed.ok ? { ...parsed, mode: modeName, subcommand: subName } : parsed
}

// The three parts of a refusal follow `.claude/commands/work.md`: the error,
// the expected format, and one corrected example command.
function formatRefusal(parsed) {
  const lines = [`release-check refused: ${parsed.error}.`]
  if (parsed.allowed) lines.push(`Allowed modes: ${parsed.allowed.join(", ")}.`)
  lines.push(`Usage: ${COMMAND} ${parsed.usage}`)
  lines.push(`Example: ${COMMAND} ${parsed.example}`)
  return lines.join("\n")
}

// A validator for the JSON Schema keywords that schema/summary.schema.json
// uses. An unknown keyword throws, so a schema edit cannot pass by omission.
const ANNOTATIONS = new Set(["$schema", "$id", "title", "description", "$defs"])
const KEYWORDS = new Set([
  "$ref",
  "type",
  "enum",
  "required",
  "properties",
  "additionalProperties",
  "items",
  "minLength",
  "pattern",
])

function typeOf(input) {
  if (input === null) return "null"
  if (Array.isArray(input)) return "array"
  if (Number.isInteger(input)) return "integer"
  return typeof input
}

function matchesType(input, type) {
  const actual = typeOf(input)
  return actual === type || (type === "number" && actual === "integer")
}

const LOCAL_REF = /^#\/\$defs\/([^/]+)$/

function resolveRef(root, ref) {
  const name = ref.match(LOCAL_REF)?.[1]
  if (name === undefined || !Object.hasOwn(root.$defs ?? {}, name)) {
    throw new Error(`summary schema $ref \`${ref}\` names no $defs entry`)
  }
  return root.$defs[name]
}

function validateNode(schema, input, where, errors, root) {
  for (const keyword of Object.keys(schema)) {
    if (!KEYWORDS.has(keyword) && !ANNOTATIONS.has(keyword)) {
      throw new Error(`summary schema keyword \`${keyword}\` is not supported`)
    }
  }
  if (schema.$ref !== undefined) {
    validateNode(resolveRef(root, schema.$ref), input, where, errors, root)
  }
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type]
    if (!types.some((type) => matchesType(input, type))) {
      errors.push(`${where} must be ${types.join(" or ")}`)
      return
    }
  }
  if (schema.enum && !schema.enum.some((option) => option === input)) {
    errors.push(`${where} must be one of ${JSON.stringify(schema.enum)}`)
  }
  if (typeof input === "string") {
    if (schema.minLength !== undefined && input.length < schema.minLength) {
      errors.push(`${where} is shorter than ${schema.minLength}`)
    }
    if (schema.pattern && !new RegExp(schema.pattern, "u").test(input)) {
      errors.push(`${where} does not match ${schema.pattern}`)
    }
  }
  if (Array.isArray(input) && schema.items) {
    input.forEach((item, index) =>
      validateNode(schema.items, item, `${where}[${index}]`, errors, root),
    )
  }
  if (typeOf(input) === "object") {
    for (const key of schema.required ?? []) {
      if (!Object.hasOwn(input, key)) errors.push(`${where}.${key} is required`)
    }
    const properties = schema.properties ?? {}
    for (const [key, item] of Object.entries(input)) {
      if (Object.hasOwn(properties, key)) {
        validateNode(properties[key], item, `${where}.${key}`, errors, root)
      } else if (schema.additionalProperties === false) {
        errors.push(`${where}.${key} is not allowed`)
      } else if (typeof schema.additionalProperties === "object") {
        validateNode(
          schema.additionalProperties,
          item,
          `${where}.${key}`,
          errors,
          root,
        )
      }
    }
  }
}

function validateAgainstSchema(schema, input) {
  const errors = []
  validateNode(schema, input, "summary", errors, schema)
  return errors
}

module.exports = {
  COMMAND,
  EXIT,
  FAILURE_CLASSES,
  MODES,
  formatRefusal,
  parseArgs,
  usageOf,
  validateAgainstSchema,
}
