"use client"

export default function ErrorPage({
  reset,
}: {
  error: Error
  reset: () => void
}) {
  return (
    <main className="form-shell">
      <h1>Feedback form is unavailable</h1>
      <p>Please try again.</p>
      <button className="primary" onClick={reset}>
        Retry
      </button>
    </main>
  )
}
