import "server-only"
import type { PromptMeta } from "../protocol"
import { readBoundedJson } from "./bounded"
import { pinnedUrl, type PromptConfig } from "./config"

const FALLBACK = [
  "You are a helpful Christian apologist and spiritual guide.",
  "Be warm, empathetic, and conversational.",
  "Support your answers with relevant Bible passages when appropriate.",
  "Quote from the ESV Bible.",
  "Keep responses concise but thorough.",
  "Default to responding in English. If the user writes in a different language, respond in that language instead.",
].join("\n")
export type ResolvedPrompt = { system: string; meta: PromptMeta }

/** Read the production text prompt; cache successes only, never hide a failed refresh. */
export function createPromptReader(
  fetcher: typeof fetch = fetch,
  now = Date.now,
) {
  let cached:
    | { config: string; until: number; prompt: ResolvedPrompt }
    | undefined
  return async (
    config: PromptConfig | null,
    parent: AbortSignal,
  ): Promise<ResolvedPrompt> => {
    const fallback: ResolvedPrompt = {
      system: FALLBACK,
      meta: { source: "fallback" },
    }
    if (!config) return fallback
    const key = JSON.stringify(config)
    if (cached?.config === key && cached.until > now()) return cached.prompt
    try {
      const base = pinnedUrl(config.baseURL, config.hosts)
      const url = new URL(
        `${base.toString().replace(/\/$/, "")}/api/public/v2/prompts/apologist-world-cup-chat`,
      )
      url.searchParams.set("label", "production")
      const signal = AbortSignal.any([parent, AbortSignal.timeout(5000)])
      const response = await fetcher(url, {
        signal,
        redirect: "error",
        cache: "no-store",
        headers: {
          Authorization: `Basic ${Buffer.from(`${config.publicKey}:${config.secretKey}`).toString("base64")}`,
        },
      })
      if (!response.ok) {
        await response.body?.cancel()
        return fallback
      }
      const data = await readBoundedJson(response.body, 65536, signal)
      if (
        !data ||
        typeof data !== "object" ||
        !("type" in data) ||
        data.type !== "text" ||
        !("prompt" in data) ||
        typeof data.prompt !== "string" ||
        !("version" in data) ||
        typeof data.version !== "number" ||
        !Number.isInteger(data.version)
      )
        return fallback
      const system = data.prompt
        .replace(/{{\s*language\s*}}/g, "English")
        .replace(/{{\s*translation\s*}}/g, "ESV")
      if (!system.trim() || /{{|}}|@@@langfuse/.test(system)) return fallback
      const prompt: ResolvedPrompt = {
        system,
        meta: { source: "production", version: data.version },
      }
      cached = { config: key, until: now() + 60000, prompt }
      return prompt
    } catch {
      return fallback
    }
  }
}

export const resolvePrompt = createPromptReader()
