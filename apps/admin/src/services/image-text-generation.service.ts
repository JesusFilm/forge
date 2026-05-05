import { z } from "zod"
import { env } from "@/config/env"
import { TOP_GLOBAL_IMAGE_LOCALES } from "@/services/media-asset.service"

export type GeneratedImageLocaleText = {
  locale: string
  displayName: string
  altText: string
}

export type GenerateImageTextResult =
  | { status: "generated"; values: GeneratedImageLocaleText[] }
  | {
      status: "skipped"
      reason: "missing_provider" | "provider_rate_limited"
      message?: string
    }

const IMAGE_TEXT_REQUEST_TIMEOUT_MS = 45_000
export const DEFAULT_OPENROUTER_IMAGE_TEXT_MODELS = [
  "nvidia/nemotron-nano-12b-v2-vl:free",
  "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
  "baidu/qianfan-ocr-fast:free",
  "google/gemma-4-26b-a4b-it:free",
  "google/gemma-4-31b-it:free",
  "google/gemma-3-27b-it:free",
  "openrouter/free",
] as const
const OPENROUTER_CHAT_COMPLETIONS_URL =
  "https://openrouter.ai/api/v1/chat/completions"

const ImageTextResponseSchema = z.object({
  locales: z.array(
    z.object({
      locale: z.string().min(2).max(35),
      displayName: z.string().trim().min(1).max(300),
      altText: z.string().trim().min(1).max(500),
    }),
  ),
})

function extractOutputText(payload: unknown): string | null {
  if (payload == null || typeof payload !== "object") return null
  const record = payload as Record<string, unknown>
  const choices = record.choices
  if (!Array.isArray(choices)) return null
  const firstChoice = choices[0]
  if (firstChoice == null || typeof firstChoice !== "object") return null
  const message = (firstChoice as Record<string, unknown>).message
  if (message == null || typeof message !== "object") return null
  const content = (message as Record<string, unknown>).content
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return null

  for (const part of content) {
    if (part == null || typeof part !== "object") continue
    const text = (part as Record<string, unknown>).text
    if (typeof text === "string") return text
  }

  return null
}

function normalizeConfiguredModels(value: string): string[] {
  return value
    .split(",")
    .map((model) => model.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean)
}

function openRouterImageTextModels(): string[] {
  if (env.OPENROUTER_IMAGE_TEXT_MODELS) {
    return normalizeConfiguredModels(env.OPENROUTER_IMAGE_TEXT_MODELS)
  }

  if (env.OPENROUTER_IMAGE_TEXT_MODEL) {
    return normalizeConfiguredModels(env.OPENROUTER_IMAGE_TEXT_MODEL)
  }

  return [...DEFAULT_OPENROUTER_IMAGE_TEXT_MODELS]
}

function shouldTryNextModel(status: number, body: string): boolean {
  if (status === 404 || status === 429 || status >= 500) {
    return true
  }

  return /temporarily rate-limited|no endpoints available|no allowed providers/i.test(
    body,
  )
}

function isRateLimitFailure(value: string): boolean {
  return /status 429|rate-limited|rate limit/i.test(value)
}

function openRouterRequestBody({
  model,
  imageDataUrl,
  sourceName,
  locales,
}: {
  model: string
  imageDataUrl: string
  sourceName: string
  locales: readonly string[]
}) {
  return {
    model,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `Generate concise localized display names and accessible alt text for these locales: ${locales.join(", ")}. Return only the requested locales. Source file name: ${sourceName}`,
          },
          {
            type: "image_url",
            image_url: {
              url: imageDataUrl,
            },
          },
        ],
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "image_localizations",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            locales: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  locale: { type: "string" },
                  displayName: { type: "string" },
                  altText: { type: "string" },
                },
                required: ["locale", "displayName", "altText"],
              },
            },
          },
          required: ["locales"],
        },
      },
    },
    max_tokens: 1600,
    temperature: 0.2,
  }
}

export async function generateLocalizedImageText({
  imageDataUrl,
  sourceName,
  locales = [...TOP_GLOBAL_IMAGE_LOCALES],
}: {
  imageDataUrl: string
  sourceName: string
  locales?: readonly string[]
}): Promise<GenerateImageTextResult> {
  if (!env.OPENROUTER_API_KEY) {
    return { status: "skipped", reason: "missing_provider" }
  }

  const models = openRouterImageTextModels()
  const failures: string[] = []

  const controller = new AbortController()
  const timeoutHandle = setTimeout(
    () => controller.abort(),
    IMAGE_TEXT_REQUEST_TIMEOUT_MS,
  )

  try {
    for (const [index, model] of models.entries()) {
      const response = await fetch(OPENROUTER_CHAT_COMPLETIONS_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://admin.jesusfilm.org",
          "X-OpenRouter-Title": "Forge Admin",
        },
        body: JSON.stringify(
          openRouterRequestBody({
            model,
            imageDataUrl,
            sourceName,
            locales,
          }),
        ),
        signal: controller.signal,
      })

      if (!response.ok) {
        const errorBody = await response.text()
        const detail = errorBody.trim()
        failures.push(
          `${model}: status ${response.status}${
            detail ? `: ${detail.slice(0, 500)}` : ""
          }`,
        )

        if (
          index < models.length - 1 &&
          shouldTryNextModel(response.status, detail)
        ) {
          continue
        }

        const message = `Image text generation failed after trying ${
          index + 1
        } model${index === 0 ? "" : "s"}: ${failures.join(" | ")}`

        if (
          failures.length === models.length &&
          failures.every(isRateLimitFailure)
        ) {
          return {
            status: "skipped",
            reason: "provider_rate_limited",
            message,
          }
        }

        throw new Error(message)
      }

      const outputText = extractOutputText(await response.json())
      if (!outputText) {
        failures.push(`${model}: response did not include text output`)

        if (index < models.length - 1) {
          continue
        }

        throw new Error(
          `Image text generation response did not include text output after trying ${models.length} models: ${failures.join(" | ")}`,
        )
      }

      let parsedJson: unknown
      try {
        parsedJson = JSON.parse(outputText)
      } catch (error) {
        failures.push(
          `${model}: response was not valid JSON${
            error instanceof Error ? ` (${error.message})` : ""
          }`,
        )

        if (index < models.length - 1) {
          continue
        }

        throw new Error(
          `Image text generation response was not valid JSON after trying ${models.length} models: ${failures.join(" | ")}`,
        )
      }

      const parsed = ImageTextResponseSchema.safeParse(parsedJson)
      if (!parsed.success) {
        failures.push(`${model}: response validation failed`)

        if (index < models.length - 1) {
          continue
        }

        throw new Error(
          `Image text generation response validation failed after trying ${models.length} models: ${failures.join(" | ")}`,
        )
      }

      const requestedLocales = locales.map((locale) => locale.toLowerCase())
      const wanted = new Set(locales.map((locale) => locale.toLowerCase()))
      const generatedLocales = new Set(
        parsed.data.locales.map((item) => item.locale.toLowerCase()),
      )
      const missingLocales = requestedLocales.filter(
        (locale) => !generatedLocales.has(locale),
      )
      if (missingLocales.length > 0) {
        failures.push(
          `${model}: response omitted requested locales ${missingLocales.join(", ")}`,
        )

        if (index < models.length - 1) {
          continue
        }

        throw new Error(
          `Image text generation response omitted requested locales after trying ${models.length} models: ${failures.join(" | ")}`,
        )
      }

      return {
        status: "generated",
        values: parsed.data.locales
          .map((item) => ({
            locale: item.locale.toLowerCase(),
            displayName: item.displayName.trim(),
            altText: item.altText.trim(),
          }))
          .filter((item) => wanted.has(item.locale)),
      }
    }

    throw new Error("Image text generation has no OpenRouter models configured")
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(
        `Image text generation timed out after ${IMAGE_TEXT_REQUEST_TIMEOUT_MS}ms`,
      )
    }
    throw error
  } finally {
    clearTimeout(timeoutHandle)
  }
}
