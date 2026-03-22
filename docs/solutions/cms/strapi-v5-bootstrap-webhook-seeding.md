---
title: "Seeding Webhooks Programmatically in Strapi v5 Bootstrap"
category: cms
date: 2026-03-23
tags: [strapi, webhook, bootstrap, revalidation, isr]
---

# Seeding Webhooks in Strapi v5 Bootstrap

## Problem

Strapi webhooks configured via the admin UI don't survive fresh deployments or database resets. We need webhooks provisioned as code for the ISR revalidation flow.

## Solution

Use `strapi.get('webhookStore')` in the bootstrap lifecycle. The webhook store is a first-class Strapi service registered as `'webhookStore'`.

### API

```ts
const webhookStore = strapi.get("webhookStore") as WebhookStore

// Key methods:
webhookStore.findWebhooks() // → Webhook[]
webhookStore.createWebhook(data) // → Webhook
webhookStore.updateWebhook(id, data) // → Webhook | null
```

### Webhook Shape

```ts
{
  name: string
  url: string
  headers: Record<string, string>
  events: string[]    // 'entry.create' | 'entry.update' | 'entry.delete' | 'entry.publish' | 'entry.unpublish' | 'entry.draft-discard'
  isEnabled: boolean  // maps to `enabled` column in strapi_webhooks table
}
```

Note: `isEnabled` (not `enabled`) — the store maps between the two internally.

### Idempotent Pattern

Find by name, update if exists, create if not:

```ts
const existing = await webhookStore.findWebhooks()
const match = existing.find((w) => w.name === WEBHOOK_NAME)
if (match) {
  await webhookStore.updateWebhook(match.id, webhookData)
} else {
  await webhookStore.createWebhook(webhookData)
}
```

## Key Constraints

1. `strapi.get('webhookStore')` — not `strapi.webhookStore` (v5 uses the service container)
2. Webhook IDs are strings (even though the DB column is `increments`)
3. Events are validated against the allowed events list — invalid events throw `ValidationError`
4. No advisory lock needed (unlike API tokens) because webhooks are not security-sensitive

## Related

- PR #511: feat(cms): seed revalidation webhook in bootstrap
- PR #500: feat(web): add ISR with Strapi webhook on-demand revalidation
- `docs/solutions/web/nextjs16-cachecomponents-isr.md` — the consuming revalidation endpoint
