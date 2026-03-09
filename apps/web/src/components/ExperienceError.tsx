type ExperienceErrorProps = {
  message: string
}

const KNOWN_ERRORS: Record<string, string> = {
  "GraphQL URL not configured": "Content service is not configured.",
  "No experience found": "No content is available.",
  "Response not successful: Received status code 401":
    "Unable to authenticate with the content service. Please contact support if this persists.",
  "Missing or invalid credentials":
    "Unable to authenticate with the content service. Please contact support if this persists.",
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
