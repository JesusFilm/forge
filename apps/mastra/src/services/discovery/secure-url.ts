export function requireHttpsUrl(value: string, label: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(`${label} must be a valid HTTPS URL`)
  }

  if (url.protocol !== "https:") {
    throw new Error(`${label} must use HTTPS`)
  }

  return url.toString()
}
