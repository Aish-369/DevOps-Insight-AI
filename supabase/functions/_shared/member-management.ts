export type TeamRole = "owner" | "admin" | "member";
export type MemberAction = "remove" | "set_role";

export interface MemberManagementRequest {
  actorRole: TeamRole;
  targetRole: TeamRole;
  action: MemberAction;
  requestedRole?: unknown;
}

/**
 * Returns a stable authorization error code, or null when the requested
 * membership operation is permitted by the product RBAC contract.
 */
export function getMemberManagementDenial(
  request: MemberManagementRequest,
): string | null {
  const { actorRole, targetRole, action, requestedRole } = request;

  if (actorRole === "member") return "TEAM_ADMIN_REQUIRED";
  if (targetRole === "owner") return "OWNER_MEMBERSHIP_PROTECTED";

  if (actorRole === "admin" && targetRole !== "member") {
    return "OWNER_PERMISSION_REQUIRED";
  }

  if (action === "set_role") {
    if (requestedRole !== "member" && requestedRole !== "admin") {
      return "INVALID_ROLE";
    }
    if (actorRole !== "owner" && requestedRole !== "member") {
      return "OWNER_PERMISSION_REQUIRED";
    }
  }

  return null;
}
