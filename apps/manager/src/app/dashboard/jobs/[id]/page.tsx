import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { getJob, ALL_STEPS } from "@/lib/state"

export const metadata: Metadata = {
  title: "Job Detail — VideoForge Manager",
}

export default async function JobDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const job = await getJob(id)

  if (!job) notFound()

  return (
    <div>
      <h1
        style={{
          fontSize: "1.5rem",
          fontWeight: 700,
          marginBottom: "0.5rem",
        }}
      >
        Job {job.id.slice(0, 8)}...
      </h1>
      <p style={{ color: "#6b7280", marginBottom: "1.5rem" }}>
        Asset: <code>{job.assetId}</code>
      </p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "1.5rem",
        }}
      >
        {/* Status */}
        <section>
          <h2
            style={{
              fontSize: "1rem",
              fontWeight: 600,
              marginBottom: "0.75rem",
            }}
          >
            Status
          </h2>
          <div
            style={{
              padding: "1rem",
              border: "1px solid #e5e7eb",
              borderRadius: 8,
            }}
          >
            <div>
              <strong>Status:</strong> {job.status}
            </div>
            <div>
              <strong>Current Step:</strong> {job.currentStep ?? "—"}
            </div>
            <div>
              <strong>Created:</strong>{" "}
              {new Date(job.createdAt).toLocaleString()}
            </div>
            <div>
              <strong>Updated:</strong>{" "}
              {new Date(job.updatedAt).toLocaleString()}
            </div>
            {job.error && (
              <div style={{ color: "#ef4444", marginTop: "0.5rem" }}>
                <strong>Error:</strong> {job.error}
              </div>
            )}
          </div>
        </section>

        {/* Pipeline Progress */}
        <section>
          <h2
            style={{
              fontSize: "1rem",
              fontWeight: 600,
              marginBottom: "0.75rem",
            }}
          >
            Pipeline Progress
          </h2>
          <div
            style={{
              padding: "1rem",
              border: "1px solid #e5e7eb",
              borderRadius: 8,
            }}
          >
            {ALL_STEPS.map((step) => {
              const done = job.completedSteps.includes(step)
              const active = job.currentStep === step
              return (
                <div
                  key={step}
                  style={{
                    padding: "0.375rem 0",
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5rem",
                  }}
                >
                  <span
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: "50%",
                      background: done
                        ? "#10b981"
                        : active
                          ? "#3b82f6"
                          : "#d1d5db",
                      display: "inline-block",
                    }}
                  />
                  <span
                    style={{
                      fontWeight: active ? 600 : 400,
                      color: done ? "#10b981" : active ? "#3b82f6" : "#6b7280",
                    }}
                  >
                    {step}
                  </span>
                </div>
              )
            })}
          </div>
        </section>

        {/* Artifacts */}
        <section style={{ gridColumn: "1 / -1" }}>
          <h2
            style={{
              fontSize: "1rem",
              fontWeight: 600,
              marginBottom: "0.75rem",
            }}
          >
            Artifacts
          </h2>
          {Object.keys(job.artifacts).length === 0 ? (
            <p style={{ color: "#6b7280" }}>No artifacts generated yet.</p>
          ) : (
            <ul style={{ listStyle: "none", padding: 0 }}>
              {Object.entries(job.artifacts).map(([key, value]) => (
                <li
                  key={key}
                  style={{
                    padding: "0.5rem 0",
                    borderBottom: "1px solid #f3f4f6",
                    fontFamily: "monospace",
                    fontSize: "0.85rem",
                  }}
                >
                  <strong>{key}:</strong> {value}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}
