"use client"

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div style={{ padding: "2rem" }}>
      <h2
        style={{ fontSize: "1.25rem", fontWeight: 600, marginBottom: "1rem" }}
      >
        Something went wrong
      </h2>
      <p style={{ color: "#6b7280", marginBottom: "1rem" }}>
        {error.message || "An unexpected error occurred."}
      </p>
      <button
        onClick={reset}
        style={{
          padding: "0.5rem 1rem",
          background: "#111827",
          color: "#fff",
          borderRadius: 6,
          border: "none",
          cursor: "pointer",
        }}
      >
        Try again
      </button>
    </div>
  )
}
