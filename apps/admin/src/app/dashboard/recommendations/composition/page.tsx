import { z } from "zod"
import Link from "next/link"
import { redirect } from "next/navigation"
import { hasPermission } from "@/auth/permissions"
import { requireSession } from "@/auth/session"
import { prisma } from "@/db/client"
import { inspectComposition } from "@/services/recommendations/composition/service"
import { CompositionControls } from "./CompositionControls"

export default async function CompositionPage({
  searchParams,
}: {
  searchParams?: Promise<{ protocolId?: string }>
}) {
  const session = await requireSession()
  if (!hasPermission(session, "read:recommendation-aggregates"))
    redirect("/dashboard")
  const id = (await searchParams)?.protocolId
  const result =
    id && z.string().uuid().safeParse(id).success
      ? await inspectComposition(prisma, session, id)
      : null
  return (
    <main className="mx-auto max-w-5xl space-y-6 p-6">
      <Link href="/dashboard/recommendations" className="text-sm underline">
        Recommendations
      </Link>
      <h1 className="text-2xl font-semibold">Composition evidence</h1>
      <p>
        Source, interest and theme MMR. Editorial adapters, series and speaker
        inputs are outside this policy. Candidate approval does not approve
        composition.
      </p>
      <form className="flex gap-3">
        <label className="grow">
          Protocol ID
          <input
            name="protocolId"
            defaultValue={id}
            required
            className="mt-1 block w-full rounded border p-2"
          />
        </label>
        <button className="self-end rounded border p-2">
          Inspect / refresh
        </button>
      </form>
      {result ? (
        <>
          <section className="space-y-2 rounded border p-4">
            <h2 className="text-lg font-semibold">Current qualification</h2>
            <p>{result.qualification.replaceAll("_", " ")}</p>
            <p>
              Calibration: {result.calibrationStatus.replaceAll("_", " ")}.
              Usefulness: not evaluated.
            </p>
            <p>Composer: {result.protocol.composerVersion}</p>
            <p>Challenger: {result.protocol.challengerManifestId}</p>
            <p>
              Evidence expiry:{" "}
              {result.protocol.decision?.validUntil.toISOString() ??
                "No decision"}
            </p>
            <p>
              Decision: {result.protocol.decision?.decision ?? "Not recorded"} —{" "}
              {result.protocol.decision?.reasonCode ??
                "Collect the frozen sample first"}
            </p>
          </section>
          <section className="rounded border p-4">
            <h2 className="font-semibold">Availability and fallback rates</h2>
            <pre className="overflow-auto text-sm">
              {JSON.stringify(result.protocol.decision?.summary ?? {}, null, 2)}
            </pre>
            <details>
              <summary>Frozen configuration and evidence identity</summary>
              <pre className="overflow-auto text-sm">
                {JSON.stringify(
                  {
                    config: result.protocol.config,
                    configDigest: result.protocol.configDigest,
                    evidenceDigest: result.protocol.decision?.evidenceDigest,
                    authorityRevision: result.protocol.authorityRevision,
                    revokedAt: result.protocol.revokedAt,
                  },
                  null,
                  2,
                )}
              </pre>
            </details>
          </section>
          {result.traces.length > 0 && (
            <section>
              <h2 className="text-lg font-semibold">
                Moved and removed positions (up to 10 retained requests)
              </h2>
              {result.traces.map((trace) => (
                <div
                  key={trace.inputDigest}
                  className="my-3 rounded border p-4"
                >
                  <p className="break-all text-xs">
                    Input: {trace.inputDigest}
                  </p>
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr>
                        <th>Content</th>
                        <th>Rank → position</th>
                        <th>Reasons</th>
                      </tr>
                    </thead>
                    <tbody>
                      {trace.run.nominations.map((entry, index) => {
                        const p =
                          entry.provenance !== null &&
                          typeof entry.provenance === "object" &&
                          !Array.isArray(entry.provenance)
                            ? entry.provenance
                            : {}
                        return (
                          <tr key={`${entry.targetMediaId}:${index}`}>
                            <td>{entry.targetMediaId}</td>
                            <td>
                              {String(p.slateRank ?? "—")} →{" "}
                              {String(p.compositionPosition ?? "removed")}
                            </td>
                            <td>
                              {String(p.compositionReasons ?? "unavailable")}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              ))}
            </section>
          )}
        </>
      ) : (
        <p>
          {id
            ? "No matching protocol found."
            : "Inspect a frozen protocol or prepare one before shadow evaluation starts."}
        </p>
      )}
      {hasPermission(session, "operate:recommendation-experiments") && (
        <CompositionControls
          protocolId={result?.protocol.id}
          configDigest={result?.protocol.configDigest}
          evidenceDigest={result?.protocol.decision?.evidenceDigest}
          canCalibrate={
            result?.protocol.decision?.decision ===
              "qualify_for_controlled_study" &&
            !result.protocol.revokedAt &&
            !result.protocol.calibration
          }
        />
      )}
    </main>
  )
}
