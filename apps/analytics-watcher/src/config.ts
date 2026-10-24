import { createHash } from "node:crypto"
import { z } from "zod"

export class WatcherError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "WatcherError"
  }
}

const HttpsUrl = z
  .string()
  .url()
  .refine((s) => {
    const url = new URL(s)
    return url.protocol === "https:" && !url.username && !url.password
  })
const BrowserConfigSchema = z.object({
  WATCH_URL: HttpsUrl.default("https://www.jesusfilm.org/watch/jesus.html"),
  WATCH_NEXT_PATH: z
    .string()
    .regex(/^\/watch\/[^?#]+$/)
    .default("/watch/jesus.html/the-beginning.html"),
  GA_MEASUREMENT_ID: z.string().regex(/^G-[A-Z0-9]+$/),
})
const ConfigSchema = BrowserConfigSchema.extend({
  DD_SITE: z
    .enum([
      "datadoghq.com",
      "datadoghq.eu",
      "us3.datadoghq.com",
      "us5.datadoghq.com",
      "ap1.datadoghq.com",
      "ap2.datadoghq.com",
      "ddog-gov.com",
    ])
    .default("datadoghq.com"),
  DD_API_KEY: z.string().min(1),
  DD_APP_KEY: z.string().min(1),
  GA4_PROPERTY_ID: z.string().regex(/^\d+$/),
  GA4_STREAM_ID: z.string().regex(/^\d+$/),
  GA4_CREDENTIALS_JSON: z.string().min(1),
  SLACK_BOT_TOKEN: z.string().startsWith("xoxb-"),
  SLACK_CHANNEL_ID: z.string().regex(/^[CG][A-Z0-9]+$/),
  STATE_PATH: z
    .string()
    .startsWith("/")
    .default("/data/analytics-watcher/state.json"),
  HEARTBEAT_URL: HttpsUrl,
})
export type Config = z.infer<typeof ConfigSchema>
export type BrowserConfig = z.infer<typeof BrowserConfigSchema>

export function readSlackConfig(env: NodeJS.ProcessEnv) {
  const result = ConfigSchema.pick({
    SLACK_BOT_TOKEN: true,
    SLACK_CHANNEL_ID: true,
    WATCH_URL: true,
  }).safeParse(env)
  if (!result.success)
    throw new WatcherError(
      "Configure SLACK_BOT_TOKEN and SLACK_CHANNEL_ID for #forge-development.",
    )
  return result.data
}

export function readConfig(env: NodeJS.ProcessEnv): Config {
  const result = ConfigSchema.safeParse(env)
  if (!result.success)
    throw new WatcherError(
      `Missing or invalid configuration: ${[...new Set(result.error.issues.map((i) => i.path[0]))].join(", ")}`,
    )
  return result.data
}
export function readBrowserConfig(env: NodeJS.ProcessEnv): BrowserConfig {
  const result = BrowserConfigSchema.safeParse(env)
  if (!result.success)
    throw new WatcherError(
      "Configure WATCH_URL, WATCH_NEXT_PATH and GA_MEASUREMENT_ID for the browser probe.",
    )
  return result.data
}
export function scopeFor(config: Config): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        config.WATCH_URL,
        config.WATCH_NEXT_PATH,
        config.GA_MEASUREMENT_ID,
        config.GA4_PROPERTY_ID,
        config.GA4_STREAM_ID,
        config.DD_SITE,
        config.SLACK_CHANNEL_ID,
      ]),
    )
    .digest("hex")
}
