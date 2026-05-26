import { prisma } from "@/db/client"

export const dynamic = "force-dynamic"

export default async function AuditPage() {
  const events = await prisma.authAuditEvent.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      actorUser: { select: { email: true, name: true } },
      app: { select: { displayName: true, key: true } },
    },
  })

  return (
    <section className="grid gap-[22px]">
      <header className="flex items-end justify-between gap-4">
        <div>
          <p className="m-0 text-[11px] font-bold uppercase tracking-[0.08em] text-[#ef3340]">
            Audit
          </p>
          <h2 className="mb-0 mt-0.5 text-3xl font-bold">Recent Auth events</h2>
        </div>
      </header>

      <div className="overflow-auto rounded-lg border border-[#dedbd2] bg-white">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className="border-b border-[#ebe8df] px-3.5 py-3 text-left align-top text-[11px] uppercase tracking-[0.08em] text-[#57534e]">
                Event
              </th>
              <th className="border-b border-[#ebe8df] px-3.5 py-3 text-left align-top text-[11px] uppercase tracking-[0.08em] text-[#57534e]">
                Severity
              </th>
              <th className="border-b border-[#ebe8df] px-3.5 py-3 text-left align-top text-[11px] uppercase tracking-[0.08em] text-[#57534e]">
                Actor
              </th>
              <th className="border-b border-[#ebe8df] px-3.5 py-3 text-left align-top text-[11px] uppercase tracking-[0.08em] text-[#57534e]">
                App
              </th>
              <th className="border-b border-[#ebe8df] px-3.5 py-3 text-left align-top text-[11px] uppercase tracking-[0.08em] text-[#57534e]">
                Metadata
              </th>
              <th className="border-b border-[#ebe8df] px-3.5 py-3 text-left align-top text-[11px] uppercase tracking-[0.08em] text-[#57534e]">
                Created
              </th>
            </tr>
          </thead>
          <tbody>
            {events.map((event) => (
              <tr key={event.id}>
                <td className="border-b border-[#ebe8df] px-3.5 py-3 text-left align-top">
                  {event.eventType}
                </td>
                <td className="border-b border-[#ebe8df] px-3.5 py-3 text-left align-top">
                  {event.severity.toLowerCase()}
                </td>
                <td className="border-b border-[#ebe8df] px-3.5 py-3 text-left align-top">
                  {event.actorUser?.email ?? "system"}
                </td>
                <td className="border-b border-[#ebe8df] px-3.5 py-3 text-left align-top">
                  {event.app?.displayName ?? "none"}
                </td>
                <td className="border-b border-[#ebe8df] px-3.5 py-3 text-left align-top">
                  <code className="whitespace-normal break-words">
                    {JSON.stringify(event.metadata)}
                  </code>
                </td>
                <td className="border-b border-[#ebe8df] px-3.5 py-3 text-left align-top">
                  {event.createdAt.toISOString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
