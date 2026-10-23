"use strict"
/* global module */
// Reads a Maestro journey file (KTD11, KTD12, KTD14). The repo has no YAML
// parser, so this reads the block subset that journeys use, and it names a
// line it cannot read instead of guessing.

const PLATFORMS = ["ios", "android"]
const PLATFORM_TAG = /^platform:(ios|android)$/
const SCREEN_ID = /^screen-(.+)$/
// Each of these runs a nested `commands` list. Only `runFlow` and `repeat`
// can skip it, by `when` or `while`.
const NESTED_COMMANDS = ["runFlow", "repeat", "retry"]
const HOST_SCRIPT_RISK =
  "host-side JavaScript can reach production admin without the read-only server"
const HOST_SCRIPT_COMMAND = /\b(runScript|evalScript)\b/gi
const RUN_FLOW = /\brunFlow\b/i
const NAME = "[A-Za-z_][A-Za-z0-9_]*"
const OPERAND = `(?:maestro\\.copiedText|${NAME}|"[^"\\\\]*"|'[^'\\\\]*')`
const SAFE_EXPRESSION = new RegExp(
  `^\\s*${OPERAND}(?:\\s*(?:[=!]==?|&&|\\|\\|)\\s*${OPERAND})*\\s*$`,
)

class FlowError extends Error {
  constructor(line, message) {
    super(`line ${line}: ${message}`)
    this.name = "FlowError"
    this.line = line
  }
}

// YAML starts a comment at a `#` that begins the line or follows a space,
// outside quotes.
function withoutComment(line) {
  let quote = null
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    if (quote) {
      if (char === quote) quote = null
    } else if (char === '"' || char === "'") {
      quote = char
    } else if (char === "#" && (index === 0 || /\s/.test(line[index - 1]))) {
      return line.slice(0, index)
    }
  }
  return line
}

/** The index of the `:` that ends a key, or -1. A `:` in a link has no space after it. */
function keyEnd(text) {
  let quote = null
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (quote) {
      if (char === quote) quote = null
    } else if (char === '"' || char === "'") {
      quote = char
    } else if (
      char === ":" &&
      (index === text.length - 1 || text[index + 1] === " ")
    ) {
      return index
    }
  }
  return -1
}

function splitOutsideQuotes(text, separator) {
  const parts = []
  let quote = null
  let start = 0
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (quote) {
      if (char === quote) quote = null
    } else if (char === '"' || char === "'") {
      quote = char
    } else if (char === separator) {
      parts.push(text.slice(start, index))
      start = index + 1
    }
  }
  parts.push(text.slice(start))
  return parts
}

function scalar(text, line) {
  const trimmed = text.trim()
  const first = trimmed[0]
  if (first === '"' || first === "'") {
    if (trimmed.length < 2 || !trimmed.endsWith(first)) {
      throw new FlowError(line, `the quoted text ${trimmed} has no end quote`)
    }
    return trimmed.slice(1, -1)
  }
  if (trimmed === "true") return true
  if (trimmed === "false") return false
  if (trimmed === "null" || trimmed === "~" || trimmed === "") return null
  return trimmed
}

// A flow map or list on one line, with no nesting: `{ link: "x" }`, `[a, b]`.
function inline(text, line) {
  const trimmed = text.trim()
  if (trimmed.startsWith("{")) {
    if (!trimmed.endsWith("}")) {
      throw new FlowError(line, "a `{` map must end on the same line")
    }
    const body = trimmed.slice(1, -1).trim()
    const map = {}
    if (body === "") return map
    for (const part of splitOutsideQuotes(body, ",")) {
      const end = keyEnd(part.trim())
      if (end < 0) throw new FlowError(line, `\`${part.trim()}\` has no key`)
      const entry = part.trim()
      map[scalar(entry.slice(0, end), line)] = scalar(
        entry.slice(end + 1),
        line,
      )
    }
    return map
  }
  if (trimmed.startsWith("[")) {
    if (!trimmed.endsWith("]")) {
      throw new FlowError(line, "a `[` list must end on the same line")
    }
    const body = trimmed.slice(1, -1).trim()
    return body === ""
      ? []
      : splitOutsideQuotes(body, ",").map((part) => scalar(part, line))
  }
  return scalar(trimmed, line)
}

function isItem(content) {
  return content === "-" || content.startsWith("- ")
}

// One token per line. `- key: value` becomes `-` and `key: value` at the
// column where the key starts, so a list item is a map like any other.
function tokenize(text, firstLine) {
  const tokens = []
  text.split(/\r?\n/).forEach((raw, offset) => {
    const line = firstLine + offset
    const stripped = withoutComment(raw).replace(/\s+$/, "")
    if (stripped.trim() === "") return
    if (/^\t/.test(stripped) || /^ *\t/.test(stripped)) {
      throw new FlowError(line, "a tab indents this line; use spaces")
    }
    let indent = stripped.length - stripped.trimStart().length
    let content = stripped.trimStart()
    while (isItem(content) && content !== "-") {
      tokens.push({ indent, content: "-", line })
      const rest = content.slice(1)
      const shift = rest.length - rest.trimStart().length + 1
      indent += shift
      content = rest.trimStart()
    }
    tokens.push({ indent, content, line })
  })
  return tokens
}

function parseNode(tokens, index, indent) {
  const token = tokens[index]
  if (isItem(token.content)) return parseList(tokens, index, token.indent)
  if (keyEnd(token.content) < 0) {
    return { value: inline(token.content, token.line), next: index + 1 }
  }
  return parseMap(tokens, index, indent)
}

function parseList(tokens, index, indent) {
  const items = []
  const lines = []
  let at = index
  while (
    at < tokens.length &&
    tokens[at].indent === indent &&
    isItem(tokens[at].content)
  ) {
    const child = tokens[at + 1]
    lines.push(tokens[at].line)
    if (!child || child.indent <= indent) {
      items.push(null)
      at += 1
      continue
    }
    const parsed = parseNode(tokens, at + 1, child.indent)
    items.push(parsed.value)
    at = parsed.next
  }
  if (at < tokens.length && tokens[at].indent > indent) {
    throw new FlowError(tokens[at].line, "this line has an unexpected indent")
  }
  Object.defineProperty(items, "lines", { value: lines })
  return { value: items, next: at }
}

function parseMap(tokens, index, indent) {
  const map = {}
  let at = index
  while (
    at < tokens.length &&
    tokens[at].indent === indent &&
    !isItem(tokens[at].content)
  ) {
    const token = tokens[at]
    const end = keyEnd(token.content)
    if (end < 0) {
      throw new FlowError(token.line, `\`${token.content}\` is not a key`)
    }
    const key = scalar(token.content.slice(0, end), token.line)
    const rest = token.content.slice(end + 1)
    const next = tokens[at + 1]
    if (rest.trim() !== "") {
      map[key] = inline(rest, token.line)
      at += 1
    } else if (
      next &&
      (next.indent > indent || (next.indent === indent && isItem(next.content)))
    ) {
      const parsed = parseNode(tokens, at + 1, next.indent)
      map[key] = parsed.value
      at = parsed.next
    } else {
      map[key] = null
      at += 1
    }
  }
  if (at < tokens.length && tokens[at].indent > indent) {
    throw new FlowError(tokens[at].line, "this line has an unexpected indent")
  }
  return { value: map, next: at }
}

function parseDocument(text, firstLine) {
  const tokens = tokenize(text, firstLine)
  if (tokens.length === 0) return null
  const parsed = parseNode(tokens, 0, tokens[0].indent)
  if (parsed.next < tokens.length) {
    throw new FlowError(
      tokens[parsed.next].line,
      "this line is outside the document",
    )
  }
  return parsed.value
}

function isMap(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** A selector as Maestro reads it: a plain string is text. */
function selectorOf(value) {
  if (typeof value === "string") return { text: value }
  return isMap(value) ? value : null
}

function assertedTarget(command, args) {
  let selector = null
  if (command === "assertVisible") selector = selectorOf(args)
  if (command === "extendedWaitUntil" && isMap(args)) {
    selector = selectorOf(args.visible)
  }
  if (!selector) return null
  const id = typeof selector.id === "string" ? selector.id : null
  const screen = id?.match(SCREEN_ID)?.[1] ?? null
  const text = typeof selector.text === "string" ? selector.text : null
  return screen || text ? { screen, text } : null
}

function stepLabel(args) {
  return typeof args.label === "string" && args.label.trim() !== ""
    ? args.label
    : null
}

function readSteps(list, depth, conditional, out) {
  if (!Array.isArray(list)) {
    throw new FlowError(0, "the commands are not a list")
  }
  list.forEach((item, index) => {
    const line = list.lines?.[index] ?? 0
    let command
    let args = null
    if (typeof item === "string") {
      command = item
    } else if (isMap(item) && Object.keys(item).length === 1) {
      command = Object.keys(item)[0]
      args = item[command]
    } else {
      throw new FlowError(line, "a step must name exactly one command")
    }
    const label = isMap(args) ? stepLabel(args) : null
    const step = {
      command,
      args,
      label,
      line,
      depth,
      conditional,
      asserts: assertedTarget(command, args),
    }
    out.push(step)
    if (NESTED_COMMANDS.includes(command) && isMap(args) && args.commands) {
      const skips = args.when !== undefined || args.while !== undefined
      readSteps(args.commands, depth + 1, conditional || skips, out)
    }
  })
}

function parseFlow(source) {
  const lines = source.split(/\r?\n/)
  const separator = lines.findIndex((line) => line.trim() === "---")
  const headerText = separator < 0 ? "" : lines.slice(0, separator).join("\n")
  const bodyText = lines.slice(separator + 1).join("\n")
  const header = separator < 0 ? {} : (parseDocument(headerText, 1) ?? {})
  if (!isMap(header)) throw new FlowError(1, "the header is not a map")
  const body = parseDocument(bodyText, separator + 2) ?? []
  const steps = []
  readSteps(body, 0, false, steps)
  const tags = Array.isArray(header.tags)
    ? header.tags.filter((tag) => typeof tag === "string")
    : []
  return {
    appId: typeof header.appId === "string" ? header.appId : null,
    name: typeof header.name === "string" ? header.name : null,
    tags,
    pinnedPlatforms: PLATFORMS.filter((platform) =>
      tags.some((tag) => PLATFORM_TAG.exec(tag)?.[1] === platform),
    ),
    steps,
    topLevel: steps.filter((step) => step.depth === 0),
    sourceLines: lines,
  }
}

function assertedScreens(flow) {
  const screens = new Set()
  const texts = new Set()
  for (const step of flow.steps) {
    // A step that a condition can skip proves no coverage.
    if (step.conditional || !step.asserts) continue
    if (step.asserts.screen) screens.add(step.asserts.screen)
    if (step.asserts.text) texts.add(step.asserts.text)
  }
  return { screens: [...screens], texts: [...texts] }
}

// The raw lines, not the steps: the parser reads a YAML subset, so a flow
// map, an anchor, or a `#` can hide a command from it.
function hostScriptProblems(lines) {
  const problems = []
  lines.forEach((text, index) => {
    const line = index + 1
    for (const match of text.matchAll(HOST_SCRIPT_COMMAND)) {
      problems.push(`line ${line} runs ${match[1]}; ${HOST_SCRIPT_RISK}`)
    }
    const quote = text.indexOf('"')
    if (quote >= 0 && text.includes("\\", quote)) {
      problems.push(
        `line ${line} has a backslash after a double quote; YAML reads it as an escape, which can hide \`\${\` or a command name, so use single quotes`,
      )
    }
    let start = text.indexOf("${")
    while (start >= 0) {
      const end = text.indexOf("}", start + 2)
      if (end < 0) {
        problems.push(
          `line ${line} opens \`\${\` with no \`}\` on the same line, so the rules cannot check its JavaScript`,
        )
        break
      }
      const expression = text.slice(start + 2, end)
      if (!SAFE_EXPRESSION.test(expression)) {
        problems.push(
          `line ${line} runs \`\${${expression}}\`; \`\${}\` takes only names, \`maestro.copiedText\`, quoted text, ==, !=, && and ||, because ${HOST_SCRIPT_RISK}`,
        )
      }
      start = text.indexOf("${", end + 1)
    }
  })
  return problems
}

/** The file of each `runFlow` step, as written, with its line. */
function runFlowFiles(flow) {
  return flow.steps.flatMap((step) => {
    if (step.command !== "runFlow") return []
    if (typeof step.args === "string") {
      return [{ line: step.line, file: step.args }]
    }
    if (isMap(step.args) && Object.hasOwn(step.args, "file")) {
      return [{ line: step.line, file: String(step.args.file) }]
    }
    return []
  })
}

// A flow map or a header hook can hide a runFlow file from the parser, so
// each raw line that names runFlow must be a step that the parser read.
function hiddenRunFlowProblems(flow) {
  const stepLines = new Set(
    flow.steps
      .filter((step) => step.command === "runFlow")
      .map((step) => step.line),
  )
  const problems = []
  flow.sourceLines.forEach((text, index) => {
    const line = index + 1
    if (RUN_FLOW.test(text) && !stepLines.has(line)) {
      problems.push(
        `line ${line} names runFlow outside a \`- runFlow:\` step in the journey body, so the rules cannot check the file that it runs`,
      )
    }
  })
  return problems
}

function journeyRuleProblems(flow) {
  const problems = []
  for (const step of flow.steps) {
    if (step.command === "clearState") {
      problems.push(
        `line ${step.line} runs clearState, which removes the Android notification denial; the runner resets the app before each journey`,
      )
    }
    if (step.command !== "launchApp") continue
    const args = isMap(step.args) ? step.args : {}
    if (args.clearState === true) {
      problems.push(
        `line ${step.line} sets clearState in launchApp, which removes the Android notification denial; the runner resets the app before each journey`,
      )
    }
    const permissions = isMap(args.permissions) ? args.permissions : {}
    if (permissions.notifications !== "deny" && permissions.all !== "deny") {
      problems.push(
        `line ${step.line} launches the app without \`permissions: { notifications: deny }\`; every launchApp denies notifications (KTD12)`,
      )
    }
  }
  return [
    ...problems,
    ...hostScriptProblems(flow.sourceLines),
    ...hiddenRunFlowProblems(flow),
  ]
}

module.exports = {
  PLATFORMS,
  SCREEN_ID,
  assertedScreens,
  journeyRuleProblems,
  parseFlow,
  runFlowFiles,
  stepLabel,
}
