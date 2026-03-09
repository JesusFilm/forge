type ExperienceErrorProps = {
  message: string
}

const KNOWN_ERRORS: Record<string, string> = {
  "GraphQL URL not configured": "Content service is not configured.",
  "No experience found": "No content is available.",
  "Response not successful: Received status code 401":
    "Invalid or missing API token. Set STRAPI_API_TOKEN in apps/web/.env.local (create token in Strapi Admin → Settings → API Tokens).",
  "Missing or invalid credentials":
    "Invalid or missing API token. Set STRAPI_API_TOKEN in apps/web/.env.local (create token in Strapi Admin → Settings → API Tokens).",
}

function sanitizeMessage(raw: string): string {
  const trimmed = raw?.trim() || ""
  return KNOWN_ERRORS[trimmed] ?? (trimmed || "An unexpected error occurred.")
}

export function ExperienceError({ message }: ExperienceErrorProps) {
  return (
    <main className="flex min-h-[40vh] flex-col items-center justify-center p-8">
      <p className="text-lg text-red-600">
        Failed to load experience: {sanitizeMessage(message)}
      </p>
    </main>
  )
}
