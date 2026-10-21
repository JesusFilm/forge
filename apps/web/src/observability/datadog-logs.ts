import dgram, { type Socket } from "node:dgram"
import os from "node:os"
import util from "node:util"

import tracer from "dd-trace"

import { env } from "@/env"

type ConsoleLevel = "debug" | "error" | "info" | "log" | "warn"

type DatadogLogForwarderOptions = {
  agentHost?: string
  agentSyslogPort?: number
  hostname?: string
  service?: string
  environment?: string
  version?: string
}

type ResolvedForwardingOptions = Required<
  Pick<
    DatadogLogForwarderOptions,
    "agentHost" | "agentSyslogPort" | "environment" | "hostname" | "service"
  >
> &
  Pick<DatadogLogForwarderOptions, "version">

type SyslogDestination = Required<
  Pick<DatadogLogForwarderOptions, "agentHost" | "agentSyslogPort">
>

type SyslogPayloadInput = Required<
  Pick<DatadogLogForwarderOptions, "environment" | "hostname" | "service">
> &
  Pick<DatadogLogForwarderOptions, "version"> & {
    attributes?: Record<string, unknown>
    level: ConsoleLevel
    message: string
    spanId?: string
    timestamp?: Date
    traceId?: string
  }

type StructuredLogInput = {
  attributes?: Record<string, unknown>
  level?: ConsoleLevel
  message: string
}

type SocketWithErrorEvents = Socket & {
  on?: (event: "error", listener: (error: Error) => void) => unknown
}

const SYSLOG_PORT = 514
const MAX_SYSLOG_MESSAGE_BYTES = 16 * 1024
const MAX_ATTRIBUTE_KEY_LENGTH = 160
const MAX_ATTRIBUTE_STRING_LENGTH = 2048

const levelToSeverity = {
  debug: 7,
  error: 3,
  info: 6,
  log: 6,
  warn: 4,
} satisfies Record<ConsoleLevel, number>

const levelToStatus = {
  debug: "debug",
  error: "error",
  info: "info",
  log: "info",
  warn: "warn",
} satisfies Record<ConsoleLevel, string>

let configured = false
let structuredSocket: Socket | null = null

const MAX_TRANSPORT_CAUSE_NODES = 8
const TRANSPORT_ERROR_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "EAI_AGAIN",
  "ENOTFOUND",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EPIPE",
  "UND_ERR_SOCKET",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_CLOSED",
  "UND_ERR_DESTROYED",
  "CERT_HAS_EXPIRED",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "ERR_TLS_CERT_ALTNAME_INVALID",
])

function ownDataValue(value: object, key: string): unknown {
  try {
    return Object.getOwnPropertyDescriptor(value, key)?.value
  } catch {
    // A diagnostic must not evaluate getters or fail on a hostile proxy.
    return undefined
  }
}

function transportCauseCodes(error: Error): string[] {
  const pending: unknown[] = [error]
  const seen = new Set<object>()
  const codes = new Set<string>()
  for (
    let visited = 0;
    pending.length > 0 && visited < MAX_TRANSPORT_CAUSE_NODES;
    visited += 1
  ) {
    const value = pending.shift()
    if (!value || typeof value !== "object" || seen.has(value)) continue
    seen.add(value)
    const code = ownDataValue(value, "code")
    if (typeof code === "string" && TRANSPORT_ERROR_CODES.has(code)) {
      codes.add(code)
    }
    const cause = ownDataValue(value, "cause")
    if (cause && typeof cause === "object") pending.push(cause)
    const members = ownDataValue(value, "errors")
    try {
      if (!Array.isArray(members)) continue
      const length = ownDataValue(members, "length")
      if (typeof length !== "number") continue
      for (
        let index = 0;
        index < Math.min(length, MAX_TRANSPORT_CAUSE_NODES);
        index += 1
      ) {
        pending.push(ownDataValue(members, String(index)))
      }
    } catch {
      // Array.isArray can throw for a revoked proxy; ignore that branch.
    }
  }
  return [...codes]
}

function inspectArgument(value: unknown): string {
  if (typeof value === "string") return value
  if (value instanceof Error) {
    const stack = value.stack ?? value.message
    const codes = transportCauseCodes(value)
    if (codes.length === 0) return stack
    // Keep the code before stack frames so the syslog byte limit preserves it.
    // Never serialize the cause itself: it can carry URLs, headers or bodies.
    const firstBreak = stack.indexOf("\n")
    const suffix = ` [transport_codes=${codes.join(",")}]`
    return firstBreak < 0
      ? stack + suffix
      : stack.slice(0, firstBreak) + suffix + stack.slice(firstBreak)
  }

  return util.inspect(value, {
    breakLength: Number.POSITIVE_INFINITY,
    depth: 4,
  })
}

export function formatConsoleArguments(args: readonly unknown[]): string {
  return args.map(inspectArgument).join(" ")
}

function truncateUtf8(value: string, maxBytes: number): string {
  const bytes = Buffer.byteLength(value)
  if (bytes <= maxBytes) return value

  return (
    Buffer.from(value)
      .subarray(0, maxBytes - 32)
      .toString("utf8") + " [truncated]"
  )
}

function activeTraceTags(): { spanId?: string; traceId?: string } {
  const span = tracer.scope().active()
  const context = span?.context()

  return {
    spanId: context?.toSpanId(),
    traceId: context?.toTraceId(),
  }
}

function normalizeAttributeValue(
  value: unknown,
  depth = 0,
): unknown | undefined {
  if (value == null) return value
  if (typeof value === "string") {
    return value.length > MAX_ATTRIBUTE_STRING_LENGTH
      ? `${value.slice(0, MAX_ATTRIBUTE_STRING_LENGTH)}...`
      : value
  }
  if (typeof value === "boolean") return value
  if (typeof value === "number")
    return Number.isFinite(value) ? value : undefined
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) {
    if (depth >= 2) return undefined
    return value
      .slice(0, 20)
      .map((item) => normalizeAttributeValue(item, depth + 1))
      .filter((item) => item !== undefined)
  }
  if (typeof value === "object") {
    if (depth >= 2) return undefined
    const output: Record<string, unknown> = {}
    for (const [key, nestedValue] of Object.entries(
      value as Record<string, unknown>,
    )) {
      if (!isSafeAttributeKey(key)) continue
      const normalized = normalizeAttributeValue(nestedValue, depth + 1)
      if (normalized !== undefined) output[key] = normalized
    }
    return Object.keys(output).length > 0 ? output : undefined
  }
  return undefined
}

function isSafeAttributeKey(key: string): boolean {
  return (
    key.length > 0 &&
    key.length <= MAX_ATTRIBUTE_KEY_LENGTH &&
    /^[A-Za-z0-9_.-]+$/.test(key)
  )
}

function normalizeAttributes(
  attributes: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!attributes) return {}

  const output: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(attributes)) {
    if (!isSafeAttributeKey(key)) continue
    const normalized = normalizeAttributeValue(value)
    if (normalized !== undefined) output[key] = normalized
  }
  return output
}

function escapeStructuredDataValue(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("]", "\\]")
}

export function buildDatadogSyslogMessage(input: SyslogPayloadInput): string {
  const status = levelToStatus[input.level]
  const tags = [
    `env:${input.environment}`,
    `service:${input.service}`,
    input.version ? `version:${input.version}` : undefined,
  ].filter(Boolean)

  const payload = {
    ...normalizeAttributes(input.attributes),
    ddsource: "nodejs",
    ddtags: tags.join(","),
    env: input.environment,
    message: input.message,
    service: input.service,
    status,
    ...(input.traceId ? { "dd.trace_id": input.traceId } : {}),
    ...(input.spanId ? { "dd.span_id": input.spanId } : {}),
  }

  const priority = 16 * 8 + levelToSeverity[input.level]
  const timestamp = (input.timestamp ?? new Date()).toISOString()
  const appName = input.service.replaceAll(/\s+/g, "-")
  const structuredData = `[metas ddsource="nodejs" ddtags="${escapeStructuredDataValue(tags.join(","))}"]`
  const syslogMessage = `<${priority}>1 ${timestamp} ${input.hostname} ${appName} - - ${structuredData} ${JSON.stringify(payload)}`

  return truncateUtf8(syslogMessage, MAX_SYSLOG_MESSAGE_BYTES)
}

function resolveForwardingOptions(
  options: DatadogLogForwarderOptions,
): ResolvedForwardingOptions | null {
  const agentHost = options.agentHost ?? env.DD_AGENT_HOST
  if (!agentHost) return null

  return {
    agentHost,
    agentSyslogPort:
      options.agentSyslogPort ?? env.DD_AGENT_SYSLOG_PORT ?? SYSLOG_PORT,
    environment: options.environment ?? env.DD_ENV ?? "development",
    hostname: options.hostname ?? os.hostname(),
    service: options.service ?? env.DD_SERVICE ?? "forge-web",
    version: options.version ?? env.DD_VERSION,
  }
}

function reportForwardingError(error: Error): void {
  if (process.env.NODE_ENV === "production") return
  process.stderr.write(
    `[datadog-logs] failed to forward log: ${error.message}\n`,
  )
}

function sendSyslogMessage(
  socket: Socket,
  message: string,
  options: SyslogDestination,
): void {
  try {
    socket.send(
      Buffer.from(message),
      options.agentSyslogPort,
      options.agentHost,
      (error) => {
        if (error) reportForwardingError(error)
      },
    )
  } catch (error) {
    if (error instanceof Error) reportForwardingError(error)
  }
}

function attachSocketErrorHandler(socket: Socket): void {
  const eventedSocket = socket as SocketWithErrorEvents
  eventedSocket.on?.("error", reportForwardingError)
}

function patchConsoleLevel(
  socket: Socket,
  level: ConsoleLevel,
  options: ResolvedForwardingOptions,
): void {
  const original = console[level].bind(console)

  console[level] = (...args: unknown[]) => {
    original(...args)

    const { spanId, traceId } = activeTraceTags()
    const message = buildDatadogSyslogMessage({
      environment: options.environment,
      hostname: options.hostname,
      level,
      message: formatConsoleArguments(args),
      service: options.service,
      spanId,
      traceId,
      version: options.version,
    })

    sendSyslogMessage(socket, message, options)
  }
}

export function sendDatadogStructuredLog(
  input: StructuredLogInput,
  options: DatadogLogForwarderOptions = {},
): void {
  const resolvedOptions = resolveForwardingOptions(options)
  if (!resolvedOptions) return

  try {
    if (!structuredSocket) {
      structuredSocket = dgram.createSocket("udp6")
      attachSocketErrorHandler(structuredSocket)
    }
    structuredSocket.unref()
  } catch (error) {
    if (error instanceof Error) reportForwardingError(error)
    return
  }

  const { spanId, traceId } = activeTraceTags()
  const message = buildDatadogSyslogMessage({
    attributes: input.attributes,
    environment: resolvedOptions.environment,
    hostname: resolvedOptions.hostname,
    level: input.level ?? "info",
    message: input.message,
    service: resolvedOptions.service,
    spanId,
    traceId,
    version: resolvedOptions.version,
  })

  sendSyslogMessage(structuredSocket, message, resolvedOptions)
}

export function configureDatadogLogForwarding(
  options: DatadogLogForwarderOptions = {},
): void {
  if (configured) return

  const resolvedOptions = resolveForwardingOptions(options)
  if (!resolvedOptions) return

  let socket: Socket
  try {
    socket = dgram.createSocket("udp6")
    socket.unref()
    attachSocketErrorHandler(socket)
  } catch (error) {
    if (error instanceof Error) reportForwardingError(error)
    return
  }

  configured = true

  for (const level of ["debug", "error", "info", "log", "warn"] as const) {
    patchConsoleLevel(socket, level, resolvedOptions)
  }
}
