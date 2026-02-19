type ExperienceErrorProps = {
  message: string
}

const KNOWN_ERRORS: Record<string, string> = {
  "GraphQL URL not configured": "Content service is not configured.",
  "No experience found": "No content is available.",
}

function sanitizeMessage(raw: string): string {
  return KNOWN_ERRORS[raw] ?? "An unexpected error occurred."
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
