import { apiFetch } from "@/lib/api-fetch"

export class AutomationResponseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "AutomationResponseError"
  }
}

/** API failures can be HTML from an upstream proxy or a login redirect. */
export async function requestAutomation<T extends object>(
  url: string,
  init: RequestInit,
  fallbackMessage: string,
): Promise<T> {
  const response = await apiFetch(url, init)
  const unexpectedResponse = () =>
    new AutomationResponseError(
      `${fallbackMessage} The server returned an unexpected response (HTTP ${response.status}). Refresh the page and try again.`,
    )
  const contentType = response.headers.get("content-type")?.split(";")[0].trim()
  if (contentType !== "application/json" && !contentType?.endsWith("+json")) {
    throw unexpectedResponse()
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw unexpectedResponse()
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw unexpectedResponse()
  }
  if (!response.ok) {
    const error = "error" in payload ? payload.error : undefined
    const details = "details" in payload ? payload.details : undefined
    const messages = Array.isArray(details)
      ? details.filter((detail): detail is string => typeof detail === "string")
      : []
    throw new AutomationResponseError(
      messages.length > 0
        ? messages.join(" ")
        : typeof error === "string"
          ? error
          : fallbackMessage,
    )
  }
  return payload as T
}
