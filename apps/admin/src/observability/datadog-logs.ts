import dgram, { type Socket } from "node:dgram"
import os from "node:os"
import util from "node:util"

import tracer from "dd-trace"

import { env } from "@/config/env"

type ConsoleLevel = "debug" | "error" | "info" | "log" | "warn"

type DatadogLogForwarderOptions = {
  agentHost?: string
  agentSyslogPort?: number
  hostname?: string
  service?: string
  environment?: string
  version?: string
}

type SyslogPayloadInput = Required<
  Pick<DatadogLogForwarderOptions, "environment" | "hostname" | "service">
> &
  Pick<DatadogLogForwarderOptions, "version"> & {
    level: ConsoleLevel
    message: string
    spanId?: string
    timestamp?: Date
    traceId?: string
  }

const SYSLOG_PORT = 514
const MAX_SYSLOG_MESSAGE_BYTES = 16 * 1024

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

function inspectArgument(value: unknown): string {
  if (typeof value === "string") return value
  if (value instanceof Error) return value.stack ?? value.message

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

function patchConsoleLevel(
  socket: Socket,
  level: ConsoleLevel,
  options: Required<
    Pick<
      DatadogLogForwarderOptions,
      "agentHost" | "agentSyslogPort" | "environment" | "hostname" | "service"
    >
  > &
    Pick<DatadogLogForwarderOptions, "version">,
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

    socket.send(
      Buffer.from(message),
      options.agentSyslogPort,
      options.agentHost,
      (error) => {
        if (error && process.env.NODE_ENV !== "production") {
          process.stderr.write(
            `[datadog-logs] failed to forward log: ${error.message}\n`,
          )
        }
      },
    )
  }
}

export function configureDatadogLogForwarding(
  options: DatadogLogForwarderOptions = {},
): void {
  if (configured) return

  const agentHost = options.agentHost ?? env.DD_AGENT_HOST
  if (!agentHost) return

  configured = true

  const socket = dgram.createSocket("udp6")
  socket.unref()

  const resolvedOptions = {
    agentHost,
    agentSyslogPort:
      options.agentSyslogPort ?? env.DD_AGENT_SYSLOG_PORT ?? SYSLOG_PORT,
    environment: options.environment ?? env.DD_ENV ?? "development",
    hostname: options.hostname ?? os.hostname(),
    service: options.service ?? env.DD_SERVICE ?? "forge-admin",
    version: options.version ?? env.DD_VERSION,
  }

  for (const level of ["debug", "error", "info", "log", "warn"] as const) {
    patchConsoleLevel(socket, level, resolvedOptions)
  }
}
