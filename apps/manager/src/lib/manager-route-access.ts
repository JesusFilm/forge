export type ManagerInteractiveRole = "OPERATOR" | "REVIEWER"

export function managerLandingPath(role: ManagerInteractiveRole): string {
  return role === "REVIEWER" ? "/subtitle-review" : "/dashboard/coverage"
}

export function isManagerReturnPathAllowedForRole(
  pathname: string,
  role: ManagerInteractiveRole,
): boolean {
  if (role === "REVIEWER") {
    return (
      pathname === "/subtitle-review" ||
      pathname.startsWith("/subtitle-review/")
    )
  }

  return (
    pathname === "/dashboard" ||
    pathname.startsWith("/dashboard/") ||
    pathname === "/design" ||
    pathname.startsWith("/design/")
  )
}

export function resolveRoleCompatibleManagerReturnToURL({
  returnTo,
  role,
  managerBaseUrl,
}: {
  returnTo: string | undefined
  role: ManagerInteractiveRole
  managerBaseUrl: string
}): string {
  const base = new URL(managerBaseUrl)
  const fallback = new URL(managerLandingPath(role), base)
  if (!returnTo) return fallback.toString()

  try {
    const parsed = new URL(returnTo, fallback)
    return parsed.origin === base.origin &&
      isManagerReturnPathAllowedForRole(parsed.pathname, role)
      ? parsed.toString()
      : fallback.toString()
  } catch {
    return fallback.toString()
  }
}
