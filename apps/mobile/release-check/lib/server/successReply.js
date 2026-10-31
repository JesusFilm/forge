"use strict"
/* eslint-disable @typescript-eslint/no-require-imports */
/* global module, require */
// Replies built from admin's own schema (KTD9): the server executes the app's
// document against `apps/admin/schema.graphql`, so a reply has exactly the
// selection set that the app asked for, and admin's validation errors too.

const { buildSchema, execute, validate } = require("graphql")

const FEEDBACK_ACCEPTED = Object.freeze({ accepted: true, refusal: null })

function buildAdminSchema(adminSchemaSdl) {
  return buildSchema(adminSchemaSdl)
}

async function executeWithRoot(schema, classified, rootValue) {
  const { document, request } = classified
  const errors = validate(schema, document)
  if (errors.length > 0) {
    return { errors: errors.map((error) => error.toJSON()) }
  }
  const result = await execute({
    schema,
    document,
    rootValue,
    variableValues: request.variables ?? undefined,
    operationName: request.operationName ?? undefined,
  })
  return JSON.parse(JSON.stringify(result))
}

function successReply(schema, classified) {
  return executeWithRoot(schema, classified, {
    submitFeedback: FEEDBACK_ACCEPTED,
  })
}

module.exports = { buildAdminSchema, executeWithRoot, successReply }
