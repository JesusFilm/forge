export function getRequestOrigin(request: Request) {
  const requestUrl = new URL(request.url)
  const forwardedHost = request.headers.get("x-forwarded-host")
  const host = forwardedHost ?? request.headers.get("host")
  if (!host) return requestUrl.origin

  const forwardedProto = request.headers.get("x-forwarded-proto")
  const protocol =
    forwardedProto === "https" || forwardedProto === "http"
      ? `${forwardedProto}:`
      : requestUrl.protocol

  return `${protocol}//${host}`
}
