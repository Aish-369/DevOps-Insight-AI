import { requireAuth, requireTeamRole, writeAudit } from "../_shared/auth.ts";
import {
  assertAllowedOrigin,
  handleError,
  HttpError,
  jsonResponse,
  preflight,
  readJsonObject,
} from "../_shared/http.ts";

Deno.serve(async (request: Request) => {
  const options = preflight(request);
  if (options) return options;

  try {
    assertAllowedOrigin(request);
    if (request.method !== "POST") {
      throw new HttpError(
        405,
        "METHOD_NOT_ALLOWED",
        "Use POST for this operation.",
      );
    }

    const context = await requireAuth(request);
    const body = await readJsonObject(request);
    const teamId = typeof body.team_id === "string" ? body.team_id : "";
    const userId = typeof body.user_id === "string" ? body.user_id : "";
    const action = body.action;
    const requestedRole = body.role;

    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
        .test(teamId) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
        .test(userId)
    ) {
      throw new HttpError(
        400,
        "INVALID_MEMBER",
        "A valid team and member ID are required.",
      );
    }
    if (action !== "remove" && action !== "set_role") {
      throw new HttpError(
        400,
        "INVALID_ACTION",
        "Choose a supported member-management action.",
      );
    }

    const actorRole = await requireTeamRole(context, teamId);
    if (actorRole === "member") {
      throw new HttpError(
        403,
        "TEAM_ADMIN_REQUIRED",
        "Only team owners and administrators can manage members.",
      );
    }
    if (context.user.id === userId) {
      throw new HttpError(
        400,
        "SELF_MANAGEMENT_BLOCKED",
        "You cannot change or remove your own membership here.",
      );
    }

    const { data: target, error: targetError } = await context.admin
      .from("team_members")
      .select("user_id,role")
      .eq("team_id", teamId)
      .eq("user_id", userId)
      .maybeSingle();

    if (targetError || !target) {
      throw new HttpError(
        404,
        "TEAM_MEMBER_NOT_FOUND",
        "The team member was not found.",
      );
    }

    if (actorRole === "admin" && target.role !== "member") {
      throw new HttpError(
        403,
        "OWNER_PERMISSION_REQUIRED",
        "Administrators can manage member accounts only.",
      );
    }

    if (action === "set_role") {
      if (requestedRole !== "member" && requestedRole !== "admin") {
        throw new HttpError(
          400,
          "INVALID_ROLE",
          "A member can be assigned only the member or admin role. Ownership transfer is a separate action.",
        );
      }
      if (actorRole !== "owner" && requestedRole !== "member") {
        throw new HttpError(
          403,
          "OWNER_PERMISSION_REQUIRED",
          "Only the owner can promote a member to administrator.",
        );
      }

      const { error } = await context.admin.from("team_members")
        .update({ role: requestedRole })
        .eq("team_id", teamId)
        .eq("user_id", userId);
      if (error) {
        throw new HttpError(
          500,
          "MEMBER_ROLE_UPDATE_FAILED",
          "The member role could not be updated.",
        );
      }

      await writeAudit(
        context.admin,
        teamId,
        context.user.id,
        "team.member.role_changed",
        {
          subject_user_id: userId,
          previous_role: target.role,
          new_role: requestedRole,
        },
      );
      return jsonResponse(request, {
        ok: true,
        user_id: userId,
        role: requestedRole,
      });
    }

    const { error } = await context.admin.from("team_members")
      .delete()
      .eq("team_id", teamId)
      .eq("user_id", userId);
    if (error) {
      if (String(error.message).includes("retain at least one owner")) {
        throw new HttpError(
          409,
          "LAST_OWNER_REQUIRED",
          "A team must retain at least one owner.",
        );
      }
      throw new HttpError(
        500,
        "MEMBER_REMOVE_FAILED",
        "The member could not be removed.",
      );
    }

    await writeAudit(
      context.admin,
      teamId,
      context.user.id,
      "team.member.removed",
      {
        subject_user_id: userId,
        previous_role: target.role,
      },
    );
    return jsonResponse(request, { ok: true, removed_user_id: userId });
  } catch (error) {
    return handleError(request, error);
  }
});
