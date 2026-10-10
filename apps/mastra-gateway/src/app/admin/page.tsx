import Link from "next/link"

import { approveAccess, revokeAccess, updateAccessRole } from "./actions"

import { requireGatewaySession } from "@/lib/require-session"
import { createGatewayStudioAccessService } from "@/services/studio-access.factory"
import type { StudioAccessRecord } from "@/services/studio-access.service"

export const dynamic = "force-dynamic"

export default async function AdminPage() {
  const session = await requireGatewaySession({ admin: true })
  const records = await createGatewayStudioAccessService().list()

  return (
    <main className="page-shell">
      <header className="top-bar">
        <div>
          <p className="eyebrow">Mastra Gateway</p>
          <h1>Studio Access</h1>
        </div>
        <nav className="top-actions" aria-label="Gateway navigation">
          <Link href="/studio">Studio</Link>
          <form action="/api/auth/logout">
            <button type="submit">Sign out</button>
          </form>
        </nav>
      </header>

      <section className="summary-grid" aria-label="Access summary">
        <Summary label="Pending" value={count(records, "pending")} />
        <Summary label="Approved" value={count(records, "approved")} />
        <Summary label="Revoked" value={count(records, "revoked")} />
      </section>

      <section className="panel">
        <div className="panel-heading">
          <h2>Requests and Roles</h2>
          <p>Signed in as {session.email ?? session.subject}</p>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Email</th>
                <th>Name</th>
                <th>Status</th>
                <th>Role</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {records.map((record) => (
                <AccessRow key={record.id} record={record} />
              ))}
              {records.length === 0 ? (
                <tr>
                  <td colSpan={5} className="empty-cell">
                    No Studio access requests yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  )
}

function Summary({ label, value }: { label: string; value: number }) {
  return (
    <div className="summary-item">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function AccessRow({ record }: { record: StudioAccessRecord }) {
  return (
    <tr>
      <td>
        <strong>{record.email}</strong>
        {record.subject ? <small>{record.subject}</small> : null}
      </td>
      <td>{record.name ?? "-"}</td>
      <td>
        <span className={`status-pill status-${record.status}`}>
          {record.status}
        </span>
      </td>
      <td>
        <form action={updateAccessRole} className="inline-form">
          <input type="hidden" name="id" value={record.id} />
          <select
            name="role"
            defaultValue={record.role}
            aria-label={`Role for ${record.email}`}
          >
            <option value="editor">Editor</option>
            <option value="admin">Admin</option>
          </select>
          <button type="submit">Save</button>
        </form>
      </td>
      <td>
        {record.status === "pending" ? (
          <form action={approveAccess} className="inline-form">
            <input type="hidden" name="id" value={record.id} />
            <select
              name="role"
              defaultValue="editor"
              aria-label={`Approval role for ${record.email}`}
            >
              <option value="editor">Editor</option>
              <option value="admin">Admin</option>
            </select>
            <button type="submit">Approve</button>
          </form>
        ) : (
          <form action={revokeAccess}>
            <input type="hidden" name="id" value={record.id} />
            <button
              type="submit"
              className="danger-button"
              disabled={record.status === "revoked"}
            >
              Revoke
            </button>
          </form>
        )}
      </td>
    </tr>
  )
}

function count(
  records: StudioAccessRecord[],
  status: StudioAccessRecord["status"],
) {
  return records.filter((record) => record.status === status).length
}
