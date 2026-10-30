import path from "node:path"

export class LocalFeedbackError extends Error {
  constructor(
    public readonly code: string,
    public readonly status = 400,
  ) {
    super(code)
  }
}

export function localFeedbackConfig() {
  if (
    process.env.NODE_ENV !== "development" ||
    process.env.FEEDBACK_LOCAL_ENABLED !== "true"
  )
    throw new LocalFeedbackError("not_found", 404)
  let base: URL
  try {
    base = new URL(process.env.FEEDBACK_LOCAL_BASE_URL ?? "")
  } catch {
    throw new LocalFeedbackError("local_origin_not_configured", 503)
  }
  const octets = base.hostname.split(".").map(Number)
  const privateIp =
    octets.length === 4 &&
    octets.every(
      (part) => Number.isInteger(part) && part >= 0 && part <= 255,
    ) &&
    (octets[0] === 10 ||
      (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
      (octets[0] === 192 && octets[1] === 168) ||
      base.hostname === "127.0.0.1")
  if (
    base.protocol !== "http:" ||
    (!privateIp && base.hostname !== "localhost") ||
    base.username ||
    base.password ||
    base.pathname !== "/" ||
    base.search ||
    base.hash
  )
    throw new LocalFeedbackError("invalid_local_origin", 503)
  return {
    origin: base.origin,
    // `next dev` runs with the app directory as cwd. Keep captures outside src/public.
    directory: path.resolve(
      process.env.FEEDBACK_LOCAL_STORAGE_DIR?.trim() ||
        "../../.local-tools/tv-feedback-captures",
    ),
    linearEnabled: process.env.FEEDBACK_LOCAL_LINEAR_ENABLED === "true",
  }
}

export function checkLocalRequest(request: Request) {
  const config = localFeedbackConfig()
  const origin = new URL(config.origin)
  if (
    request.headers.get("host") !== origin.host ||
    (request.method !== "GET" &&
      request.headers.get("origin") !== config.origin) ||
    (request.headers.has("origin") &&
      request.headers.get("origin") !== config.origin) ||
    request.headers.get("sec-fetch-site") === "cross-site"
  )
    throw new LocalFeedbackError("invalid_origin", 403)
  return config
}
