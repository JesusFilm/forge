export type MembershipStatus = "invited" | "active" | "suspended" | "disabled"

export function canUseFirstPartyApps(status: MembershipStatus) {
  return status === "active"
}

export function assertActiveMembership(status: MembershipStatus) {
  if (!canUseFirstPartyApps(status)) {
    throw new Error(
      `Membership status '${status}' cannot use first-party apps.`,
    )
  }
}

export function shouldPreserveExistingMembership(
  currentStatus: MembershipStatus,
  incomingStatus: MembershipStatus,
) {
  if (currentStatus === "disabled" || currentStatus === "suspended") {
    return true
  }

  return currentStatus === "active" && incomingStatus === "invited"
}
