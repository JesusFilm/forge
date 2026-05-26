import { revokeTokenRecord } from "@/app/dashboard/tokens/actions"
import { prisma } from "@/db/client"

export const dynamic = "force-dynamic"

export default async function TokensPage() {
  const tokens = await prisma.tokenRecord.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      app: { select: { displayName: true } },
      environment: { select: { kind: true } },
      user: { select: { email: true } },
    },
  })

  return (
    <section className="grid gap-[22px]">
      <header className="flex items-end justify-between gap-4">
        <div>
          <p className="m-0 text-[11px] font-bold uppercase tracking-[0.08em] text-[#ef3340]">
            Tokens
          </p>
          <h2 className="mb-0 mt-0.5 text-3xl font-bold">
            Issued token records
          </h2>
        </div>
      </header>

      <div className="overflow-auto rounded-lg border border-[#dedbd2] bg-white">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className="border-b border-[#ebe8df] px-3.5 py-3 text-left align-top text-[11px] uppercase tracking-[0.08em] text-[#57534e]">
                App
              </th>
              <th className="border-b border-[#ebe8df] px-3.5 py-3 text-left align-top text-[11px] uppercase tracking-[0.08em] text-[#57534e]">
                Family
              </th>
              <th className="border-b border-[#ebe8df] px-3.5 py-3 text-left align-top text-[11px] uppercase tracking-[0.08em] text-[#57534e]">
                Status
              </th>
              <th className="border-b border-[#ebe8df] px-3.5 py-3 text-left align-top text-[11px] uppercase tracking-[0.08em] text-[#57534e]">
                Audience
              </th>
              <th className="border-b border-[#ebe8df] px-3.5 py-3 text-left align-top text-[11px] uppercase tracking-[0.08em] text-[#57534e]">
                Scopes
              </th>
              <th className="border-b border-[#ebe8df] px-3.5 py-3 text-left align-top text-[11px] uppercase tracking-[0.08em] text-[#57534e]">
                Expires
              </th>
              <th className="border-b border-[#ebe8df] px-3.5 py-3 text-left align-top text-[11px] uppercase tracking-[0.08em] text-[#57534e]">
                Action
              </th>
            </tr>
          </thead>
          <tbody>
            {tokens.map((token) => (
              <tr key={token.id}>
                <td className="border-b border-[#ebe8df] px-3.5 py-3 text-left align-top">
                  <strong>{token.app.displayName}</strong>
                  <small className="block text-[#78716c]">
                    {token.environment.kind.toLowerCase()}
                  </small>
                </td>
                <td className="border-b border-[#ebe8df] px-3.5 py-3 text-left align-top">
                  {token.family.toLowerCase()}
                </td>
                <td className="border-b border-[#ebe8df] px-3.5 py-3 text-left align-top">
                  {token.status.toLowerCase()}
                </td>
                <td className="border-b border-[#ebe8df] px-3.5 py-3 text-left align-top">
                  {token.audience}
                </td>
                <td className="border-b border-[#ebe8df] px-3.5 py-3 text-left align-top">
                  {token.scopes.join(", ")}
                </td>
                <td className="border-b border-[#ebe8df] px-3.5 py-3 text-left align-top">
                  {token.expiresAt.toISOString()}
                </td>
                <td className="border-b border-[#ebe8df] px-3.5 py-3 text-left align-top">
                  {token.status === "ACTIVE" ? (
                    <form action={revokeTokenRecord}>
                      <input type="hidden" name="tokenId" value={token.id} />
                      <button
                        className="min-h-8 cursor-pointer rounded border border-red-200 bg-red-50 px-2.5 font-semibold text-red-800 hover:bg-red-100"
                        type="submit"
                      >
                        Revoke
                      </button>
                    </form>
                  ) : (
                    "none"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
