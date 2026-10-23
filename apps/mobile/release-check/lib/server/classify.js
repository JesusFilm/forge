"use strict"
/* eslint-disable @typescript-eslint/no-require-imports */
/* global module, require */
// Routes one request body by config/operations.json (KTD8). It reads root
// field NAMES, never aliases, and blocks every body it cannot resolve.

const { Kind, parse } = require("graphql")

const { classifyCoordinate, isObject } = require("../lists")

const ROOT_TYPES = Object.freeze({
  query: "Query",
  mutation: "Mutation",
  subscription: "Subscription",
})

// The class of every root field, and the operation type, decide the action.
const ACTIONS = Object.freeze({
  readOnly: { action: "forward", opType: "query" },
  savedAnswer: { action: "search", opType: "query" },
  successReply: { action: "successReply", opType: "mutation" },
})

class UnresolvableDocumentError extends Error {
  constructor(reason) {
    super(reason)
    this.name = "UnresolvableDocumentError"
    this.reason = reason
  }
}

function collectRootFields(selectionSet, fragments, rootType, out, seen) {
  for (const selection of selectionSet.selections) {
    if (selection.kind === Kind.FIELD) {
      const name = selection.name.value
      if (name === "__typename") continue
      out.push({ coordinate: `${rootType}.${name}`, node: selection })
    } else if (selection.kind === Kind.INLINE_FRAGMENT) {
      collectRootFields(selection.selectionSet, fragments, rootType, out, seen)
    } else if (selection.kind === Kind.FRAGMENT_SPREAD) {
      const name = selection.name.value
      if (seen.has(name)) continue
      seen.add(name)
      const fragment = fragments.get(name)
      if (!fragment) throw new UnresolvableDocumentError("missing-fragment")
      collectRootFields(fragment.selectionSet, fragments, rootType, out, seen)
    } else {
      throw new UnresolvableDocumentError("unknown-selection")
    }
  }
}

function countByCoordinate(fieldNodes) {
  const counts = {}
  for (const { coordinate } of fieldNodes) {
    counts[coordinate] = (counts[coordinate] ?? 0) + 1
  }
  return counts
}

function blocked(reason, details = {}) {
  return {
    action: "block",
    reason,
    opType: null,
    opName: null,
    rootFields: {},
    fieldNodes: [],
    document: null,
    request: null,
    ...details,
  }
}

function readRequest(raw) {
  let body
  try {
    body = JSON.parse(raw)
  } catch {
    return { error: "invalid-json" }
  }
  if (Array.isArray(body)) return { error: "batch" }
  if (!isObject(body) || typeof body.query !== "string") {
    return { error: "no-query" }
  }
  return {
    request: {
      query: body.query,
      variables: body.variables,
      operationName: body.operationName ?? null,
    },
  }
}

// The action for one raw body: `forward`, `search`, `successReply`, or `block`
// with a short reason. `rootFields` counts every alias, as admin's limit does.
function classifyRequest(raw, operations) {
  const read = readRequest(raw)
  if (read.error) return blocked(read.error)
  const { request } = read

  let document
  try {
    document = parse(request.query)
  } catch {
    return blocked("parse-error")
  }
  const definitions = document.definitions.filter(
    (definition) => definition.kind === Kind.OPERATION_DEFINITION,
  )
  if (definitions.length === 0) return blocked("no-operation")
  if (definitions.length > 1) return blocked("multiple-operations")
  const [operation] = definitions
  const opType = operation.operation
  const opName = operation.name?.value ?? null
  if (request.operationName !== null && request.operationName !== opName) {
    return blocked("unknown-operation-name", { opType, opName })
  }

  const fragments = new Map(
    document.definitions
      .filter((definition) => definition.kind === Kind.FRAGMENT_DEFINITION)
      .map((definition) => [definition.name.value, definition]),
  )
  const fieldNodes = []
  try {
    collectRootFields(
      operation.selectionSet,
      fragments,
      ROOT_TYPES[opType],
      fieldNodes,
      new Set(),
    )
  } catch (error) {
    if (error instanceof UnresolvableDocumentError) {
      return blocked(error.reason, { opType, opName })
    }
    throw error
  }
  const rootFields = countByCoordinate(fieldNodes)
  const parsed = { opType, opName, rootFields, fieldNodes, document, request }
  const coordinates = Object.keys(rootFields).sort()
  if (coordinates.length === 0) return blocked("no-root-field", parsed)

  const classes = new Set()
  for (const coordinate of coordinates) {
    const found = classifyCoordinate(operations, coordinate)
    if (found === null) return blocked(`field-unlisted ${coordinate}`, parsed)
    if (found === "blocked")
      return blocked(`field-blocked ${coordinate}`, parsed)
    classes.add(found)
  }
  if (classes.size > 1) return blocked("mixed-classes", parsed)
  const route = ACTIONS[[...classes][0]]
  if (route.opType !== opType) return blocked(`wrong-type ${opType}`, parsed)
  return { action: route.action, reason: null, ...parsed }
}

module.exports = { classifyRequest }
