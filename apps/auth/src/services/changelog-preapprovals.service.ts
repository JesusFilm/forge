import {
  ContributorManagementError,
  withChangelogAdmin,
} from "./changelog-contributors.service"

export type PreapprovalOperation =
  | { action: "create"; id: string; email: string }
  | { action: "cancel" | "renew"; id: string; version: number }

export async function manageChangelogPreapprovals(
  bearer: string | null,
  clientId: string,
  operation?: PreapprovalOperation,
) {
  return withChangelogAdmin(
    bearer,
    clientId,
    async ({ tx, environment, actorId, kind }) => {
      const now = new Date()
      const display = <T extends { state: string; expiresAt: Date }>(
        approval: T,
      ) => ({
        ...approval,
        state:
          approval.state === "pending" && approval.expiresAt <= now
            ? "expired"
            : approval.state,
      })
      if (!operation) {
        const approvals = await tx.changelogPreapproval.findMany({
          where: { environmentId: environment.id },
          orderBy: { createdAt: "desc" },
        })
        return {
          environment: kind.toLowerCase(),
          preapprovals: approvals.map(display),
        }
      }
      const existing = await tx.changelogPreapproval.findUnique({
        where: { id: operation.id },
      })
      if (operation.action === "create") {
        const email = operation.email.trim().toLowerCase()
        if (existing) {
          if (
            existing.environmentId !== environment.id ||
            existing.email !== email ||
            existing.approverId !== actorId
          )
            throw new ContributorManagementError(409, "approval-conflict")
          return display(existing)
        }
        return display(
          await tx.changelogPreapproval.create({
            data: {
              id: operation.id,
              email,
              environmentId: environment.id,
              approverId: actorId,
              createdAt: now,
              expiresAt: new Date(now.getTime() + 30 * 86400000),
            },
          }),
        )
      }
      if (!existing || existing.environmentId !== environment.id)
        throw new ContributorManagementError(404, "approval-not-found")
      if (
        existing.state === "redeemed" ||
        existing.version !== operation.version
      )
        throw new ContributorManagementError(409, "approval-conflict")
      return display(
        await tx.changelogPreapproval.update({
          where: { id: existing.id, version: operation.version },
          data: {
            version: { increment: 1 },
            ...(operation.action === "cancel"
              ? { state: "canceled" }
              : {
                  state: "pending",
                  approverId: actorId,
                  expiresAt: new Date(now.getTime() + 30 * 86400000),
                }),
          },
        }),
      )
    },
  )
}
