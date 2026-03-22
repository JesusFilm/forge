import type { Core } from "@strapi/strapi"

const WEBHOOK_NAME = "revalidate-watch"

type Webhook = {
  id: string
  name: string
  url: string
  headers: Record<string, string>
  events: string[]
  isEnabled: boolean
}

type WebhookStore = {
  findWebhooks: () => Promise<Webhook[]>
  createWebhook: (data: Omit<Webhook, "id">) => Promise<Webhook>
  updateWebhook: (
    id: string,
    data: Omit<Webhook, "id">,
  ) => Promise<Webhook | null>
}

export async function ensureRevalidationWebhook(
  strapi: Core.Strapi,
  url?: string,
  secret?: string,
): Promise<void> {
  if (!url || !secret) return

  const webhookStore = strapi.get("webhookStore") as WebhookStore

  const webhookData = {
    name: WEBHOOK_NAME,
    url,
    headers: { "x-revalidation-secret": secret },
    events: [
      "entry.create",
      "entry.update",
      "entry.delete",
      "entry.publish",
      "entry.unpublish",
    ],
    isEnabled: true,
  }

  const existing = await webhookStore.findWebhooks()
  const match = existing.find((w) => w.name === WEBHOOK_NAME)

  if (match) {
    await webhookStore.updateWebhook(match.id, webhookData)
  } else {
    await webhookStore.createWebhook(webhookData)
  }

  strapi.log.info(`Ensured revalidation webhook → ${url}`)
}
