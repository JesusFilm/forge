// Shared OpenRouter client — all AI services import from here.
// Uses the openai SDK with OpenRouter's base URL.

import OpenAI from "openai"
import { env } from "@/config/env"

export const openrouter = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: env.OPENROUTER_API_KEY,
  timeout: 120_000,
  maxRetries: 3,
})

export const DEFAULT_MODEL = "google/gemini-2.5-flash"
