import type { SupportResearchConfig } from "../../config/env"
import {
  discardResponseBody,
  readResponseTextCapped,
} from "../devotional/bounded-response"
import type { WatchValidationEvidence } from "./schema"

type ValidatorConfig = Pick<
  SupportResearchConfig,
  "allowedWatchHosts" | "timeoutMs" | "maxResponseBytes"
>

function validatedWatchUrl(
  value: string,
  allowedHosts: ReadonlySet<string>,
): URL | undefined {
  try {
    const url = new URL(value)
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      !allowedHosts.has(url.hostname.toLowerCase())
    ) {
      return
    }
    url.hash = ""
    return url
  } catch {
    return
  }
}

function validatedRedirectTarget(
  location: string | null,
  base: URL,
  allowedHosts: ReadonlySet<string>,
): URL | undefined {
  if (!location) return
  try {
    return validatedWatchUrl(new URL(location, base).href, allowedHosts)
  } catch {
    return
  }
}

function fetchFailure(
  error: unknown,
  incomingUrl: string,
): WatchValidationEvidence {
  const name = (error as { name?: string } | undefined)?.name
  return {
    state: "blocked",
    incomingUrl,
    evidence: [],
    missingProof: "The bounded public request did not complete.",
    errorCode:
      name === "TimeoutError" || name === "AbortError"
        ? "timeout"
        : "network_error",
  }
}

export async function validateWatchReport(input: {
  urls: string[]
  config: ValidatorConfig
  fetchImpl?: typeof fetch
}): Promise<WatchValidationEvidence> {
  if (input.urls.length === 0) {
    return {
      state: "not_attempted",
      evidence: [],
      missingProof:
        "The support request did not contain an allowlisted Watch URL.",
    }
  }
  const allowedHosts = new Set(
    input.config.allowedWatchHosts.map((host) => host.toLowerCase()),
  )
  const fetchImpl = input.fetchImpl ?? fetch
  const first = validatedWatchUrl(input.urls[0] ?? "", allowedHosts)
  if (!first) {
    return {
      state: "blocked",
      evidence: [],
      missingProof:
        "The reported URL is outside the configured public Watch hosts.",
      errorCode: "url_not_allowed",
    }
  }

  let response: Response
  try {
    response = await fetchImpl(first, {
      method: "GET",
      headers: {
        accept: "text/html,application/xhtml+xml",
        "user-agent": "forge-mastra-support-research-validator/1.0",
      },
      redirect: "manual",
      signal: AbortSignal.timeout(input.config.timeoutMs),
    })
  } catch (error) {
    return fetchFailure(error, first.href)
  }

  const finalUrl = validatedWatchUrl(response.url || first.href, allowedHosts)
  if (!finalUrl) {
    await discardResponseBody(response)
    return {
      state: "blocked",
      incomingUrl: first.href,
      status: response.status,
      evidence: [
        `HTTP ${response.status} was returned for the exact reported URL.`,
      ],
      missingProof: "The response resolved outside the configured Watch hosts.",
      errorCode: "final_url_not_allowed",
    }
  }

  if (response.status >= 400) {
    await discardResponseBody(response)
    return {
      state: "confirmed",
      incomingUrl: first.href,
      finalUrl: finalUrl.href,
      status: response.status,
      evidence: [
        `HTTP ${response.status} was returned for the exact reported URL.`,
      ],
    }
  }

  if (response.status >= 300) {
    const location = response.headers.get("location")
    await discardResponseBody(response)
    const target = validatedRedirectTarget(location, first, allowedHosts)
    return {
      state: "unverified",
      incomingUrl: first.href,
      finalUrl: target?.href ?? finalUrl.href,
      status: response.status,
      evidence: [
        `HTTP ${response.status} redirect was returned for the exact URL.`,
      ],
      missingProof:
        "A redirect alone does not prove the reported user-visible failure.",
      errorCode: target ? undefined : "redirect_target_not_allowed",
    }
  }

  const contentType = response.headers.get("content-type") ?? ""
  if (!contentType.toLowerCase().includes("text/html")) {
    await discardResponseBody(response)
    return {
      state: "unverified",
      incomingUrl: first.href,
      finalUrl: finalUrl.href,
      status: response.status,
      evidence: [
        `HTTP ${response.status} returned ${contentType || "an unknown content type"}.`,
      ],
      missingProof: "The response was not an HTML Watch page.",
      errorCode: "unexpected_content_type",
    }
  }
  const body = await readResponseTextCapped(
    response,
    input.config.maxResponseBytes,
  )
  if (body === undefined) {
    return {
      state: "blocked",
      incomingUrl: first.href,
      finalUrl: finalUrl.href,
      status: response.status,
      evidence: [],
      missingProof: "The public page exceeded the validation response limit.",
      errorCode: "response_too_large",
    }
  }

  return {
    state: "unverified",
    incomingUrl: first.href,
    finalUrl: finalUrl.href,
    status: response.status,
    evidence: [`HTTP ${response.status} returned a bounded HTML response.`],
    missingProof:
      "A successful document request cannot prove interactive, playback, account, device, or intermittent behavior.",
  }
}
