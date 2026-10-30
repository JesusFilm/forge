import { z } from "zod"
import { type Config, WatcherError } from "./config.js"
import { requestJson, type Fetch } from "./http.js"
import type { Notification, State } from "./state.js"

export function messageFor(
  notification: Notification,
  watchUrl: string,
): string {
  const visibility = notification.check.endsWith(":visibility")
  const title =
    notification.kind === "recovered"
      ? visibility
        ? "Monitoring restored"
        : "Watch analytics recovered"
      : visibility
        ? "Watch analytics monitoring needs attention"
        : notification.check.endsWith("-intake")
          ? "Confirmed Watch analytics intake silence"
          : "Confirmed Watch analytics failure"
  return [
    title,
    `Check: ${notification.check}`,
    `Page: ${watchUrl}`,
    notification.detail,
    notification.kind === "opened"
      ? "Confirmed by 3 checks spanning at least 10 minutes."
      : "Confirmed by 2 successful checks spanning at least 5 minutes.",
    `Time: ${new Date(notification.at).toISOString()}`,
    `Incident: ${notification.incidentId}`,
  ].join("\n")
}
export async function postNotification(
  config: Pick<Config, "SLACK_CHANNEL_ID" | "SLACK_BOT_TOKEN" | "WATCH_URL">,
  notification: Notification,
  fetchImpl: Fetch = fetch,
  endpoint = "https://slack.com/api/chat.postMessage",
): Promise<void> {
  await postText(
    config,
    messageFor(notification, config.WATCH_URL),
    fetchImpl,
    endpoint,
  )
}

export async function postSlackTest(
  config: Pick<Config, "SLACK_CHANNEL_ID" | "SLACK_BOT_TOKEN" | "WATCH_URL">,
  fetchImpl: Fetch = fetch,
): Promise<void> {
  await postText(
    config,
    "TEST: Forge Analytics Watcher can post to this channel. This is an installation check; no production incident has been opened.",
    fetchImpl,
  )
}

async function postText(
  config: Pick<Config, "SLACK_CHANNEL_ID" | "SLACK_BOT_TOKEN" | "WATCH_URL">,
  text: string,
  fetchImpl: Fetch,
  endpoint = "https://slack.com/api/chat.postMessage",
): Promise<void> {
  const response = z
    .object({
      ok: z.boolean(),
      channel: z.string().optional(),
      ts: z.string().optional(),
    })
    .safeParse(
      await requestJson(
        endpoint,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.SLACK_BOT_TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            channel: config.SLACK_CHANNEL_ID,
            text,
            mrkdwn: false,
            unfurl_links: false,
            unfurl_media: false,
          }),
        },
        "Slack",
        fetchImpl,
      ),
    )
  if (
    !response.success ||
    !response.data.ok ||
    response.data.channel !== config.SLACK_CHANNEL_ID ||
    !response.data.ts
  ) {
    throw new WatcherError(
      "Slack did not acknowledge delivery to the configured channel.",
    )
  }
}

export async function flushOutbox(
  state: State,
  send: (item: Notification) => Promise<void>,
  persist: () => Promise<void>,
): Promise<void> {
  while (state.outbox.length) {
    await send(state.outbox[0])
    state.outbox.shift()
    await persist()
  }
}
