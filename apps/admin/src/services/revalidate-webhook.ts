// Best-effort revalidate webhook → apps/web.
//
// Fires after a successful publish / update on Experience, Video, or
// WatchSetting. apps/web's `/api/revalidate` route receives the
// payload and calls `revalidatePath` for the affected slug + locale,
// so ISR stays fresh after admin-side edits.
//
// Contract guarantees:
//   - NEVER throws. The publish must not fail because the webhook
//     POST failed. All transport / auth / config failures are caught,
//     structured-logged, and swallowed. The caller does not branch on
//     the result.
//   - Silent no-op when WEB_REVALIDATE_URL or WEB_REVALIDATE_TOKEN is
//     unset. Admin runs in some environments without web (preview,
//     local dev focused on workflows). Logs at info-level once per
//     attempt so the silence is auditable.
//   - Bearer auth with the SAME value web's `REVALIDATION_SECRET`
//     holds. Operator must keep them in lockstep — see
//     apps/admin/CLAUDE.md and the U21 deploy ordering note.
//
// Wire format mirrors the existing Strapi-shaped payload web's route
// already accepts: `{ model, entry: { slug, locale } }`. Web's route
// also accepts a bearer in `Authorization: Bearer …` (added in U21).

import { env } from "@/config/env"

const WEB_REVALIDATE_TIMEOUT_MS = 5_000

export type RevalidateModel =
  | "experience"
  | "video"
  | "watch-route-manifest"
  | "watch-seo-manifest"
  | "watch-setting"

export type RevalidateWebhookInput = {
  model: RevalidateModel
  slug?: string | null
  locale?: string | null
  /** Exact public Watch language slug; optional during receiver-first rollout. */
  languageSlug?: string | null
}

type RevalidateOutcome =
  | { status: "sent"; httpStatus: number }
  | { status: "skipped"; reason: "config_missing" }
  | { status: "failed"; reason: "network" | "remote_non_2xx"; detail: string }

/**
 * Fire-and-forget webhook to apps/web's `/api/revalidate` route.
 *
 * Returns a typed outcome for tests / log consumers but the caller
 * normally awaits-and-ignores. A `failed` outcome is NEVER thrown —
 * the publish lifecycle continues regardless.
 */
export async function emitRevalidateWebhook(
  input: RevalidateWebhookInput,
): Promise<RevalidateOutcome> {
  const startedAt = Date.now()

  if (!env.WEB_REVALIDATE_URL || !env.WEB_REVALIDATE_TOKEN) {
    const outcome: RevalidateOutcome = {
      status: "skipped",
      reason: "config_missing",
    }
    logOutcome(input, outcome, Date.now() - startedAt)
    return outcome
  }

  const body = JSON.stringify({
    model: input.model,
    entry: {
      slug: input.slug ?? undefined,
      locale: input.locale ?? undefined,
      languageSlug: input.languageSlug ?? undefined,
    },
  })

  try {
    const response = await fetch(env.WEB_REVALIDATE_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${env.WEB_REVALIDATE_TOKEN}`,
      },
      body,
      signal: AbortSignal.timeout(WEB_REVALIDATE_TIMEOUT_MS),
    })

    if (!response.ok) {
      const text = await response.text().catch(() => "<unreadable body>")
      const outcome: RevalidateOutcome = {
        status: "failed",
        reason: "remote_non_2xx",
        detail: `web returned ${response.status}: ${text.slice(0, 200)}`,
      }
      logOutcome(input, outcome, Date.now() - startedAt)
      return outcome
    }

    const outcome: RevalidateOutcome = {
      status: "sent",
      httpStatus: response.status,
    }
    logOutcome(input, outcome, Date.now() - startedAt)
    return outcome
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const outcome: RevalidateOutcome = {
      status: "failed",
      reason: "network",
      detail: message,
    }
    logOutcome(input, outcome, Date.now() - startedAt)
    return outcome
  }
}

function logOutcome(
  input: RevalidateWebhookInput,
  outcome: RevalidateOutcome,
  durationMs: number,
): void {
  // Structured log so ops can grep `event=web_revalidate.*` to see
  // every outbound webhook attempt. Never logs the bearer token.
  const base = {
    event: `web_revalidate.${outcome.status}`,
    model: input.model,
    slug: input.slug ?? null,
    locale: input.locale ?? null,
    languageSlug: input.languageSlug ?? null,
    durationMs,
  }
  if (outcome.status === "sent") {
    console.log(JSON.stringify({ ...base, httpStatus: outcome.httpStatus }))
  } else if (outcome.status === "skipped") {
    console.log(JSON.stringify({ ...base, reason: outcome.reason }))
  } else {
    console.warn(
      JSON.stringify({
        ...base,
        reason: outcome.reason,
        detail: outcome.detail.slice(0, 500),
      }),
    )
  }
}
