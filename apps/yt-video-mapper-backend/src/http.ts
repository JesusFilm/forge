import type { ServerResponse } from "node:http"

export type JsonBody = Record<string, unknown>

export function sendJson(
  response: ServerResponse,
  statusCode: number,
  body: JsonBody,
): void {
  response.writeHead(statusCode, { "Content-Type": "application/json" })
  response.end(JSON.stringify(body))
}
