type ExperienceErrorProps = {
  message: string
}

export function ExperienceError({ message }: ExperienceErrorProps) {
  return (
    <main className="flex min-h-[40vh] flex-col items-center justify-center p-8">
      <p className="text-lg text-red-600">
        Failed to load experience: {message}
      </p>
    </main>
  )
}
