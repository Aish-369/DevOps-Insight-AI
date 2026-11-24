import {
  assertAllowedOrigin,
  handleError,
  HttpError,
  jsonResponse,
  preflight,
  readJsonObject,
} from "../_shared/http.ts";
import { requireAuth, writeAudit } from "../_shared/auth.ts";
import { sha256Hex } from "../_shared/security.ts";

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
    const token = typeof body.token === "string" ? body.token.trim() : "";
    if (!/^[0-9a-f]{64}$/i.test(token)) {
      throw new HttpError(
        400,
        "INVALID_INVITATION_TOKEN",
        "The invitation link is invalid or expired.",
      );
    }
    if (!context.user.email || !context.user.email_confirmed_at) {
      throw new HttpError(
        403,
        "VERIFIED_EMAIL_REQUIRED",
        "Sign in with a verified email address to accept this invitation.",
      );
    }

    const tokenHash = await sha256Hex(token);
    const { data: invitation, error: lookupError } = await context.admin
      .from("team_invitations")
      .select("id,team_id,email,role,status,expires_at,accepted_at,revoked_at")
      .eq("token_hash", tokenHash)
      .maybeSingle();

    if (
      lookupError || !invitation || invitation.status !== "pending" ||
      invitation.accepted_at || invitation.revoked_at
    ) {
      throw new HttpError(
        404,
        "INVITATION_NOT_AVAILABLE",
        "The invitation link is invalid, expired or already used.",
      );
    }
    if (Date.parse(invitation.expires_at) <= Date.now()) {
      await context.admin.from("team_invitations").update({ status: "expired" })
        .eq("id", invitation.id).eq("status", "pending");
      throw new HttpError(
        410,
        "INVITATION_EXPIRED",
        "This invitation has expired. Ask a team administrator to send a new one.",
      );
    }
    if (
      String(invitation.email).toLowerCase() !==
        context.user.email.toLowerCase()
    ) {
      throw new HttpError(
        403,
        "INVITATION_EMAIL_MISMATCH",
        "Sign in with the email address that received this invitation.",
      );
    }

    const { data: existingMembership, error: memberLookupError } = await context
      .admin
      .from("team_members")
      .select("role")
      .eq("team_id", invitation.team_id)
      .eq("user_id", context.user.id)
      .maybeSingle();
    if (memberLookupError) {
      throw new HttpError(
        500,
        "MEMBERSHIP_LOOKUP_FAILED",
        "Team membership could not be checked.",
      );
    }

    let assignedRole = String(invitation.role);
    if (existingMembership) {
      assignedRole = String(existingMembership.role);
    } else {
      const { error: insertMemberError } = await context.admin.from(
        "team_members",
      ).insert({
        team_id: invitation.team_id,
        user_id: context.user.id,
        role: assignedRole,
      });
      if (insertMemberError && insertMemberError.code !== "23505") {
        throw new HttpError(
          500,
          "MEMBERSHIP_CREATE_FAILED",
          "Your team membership could not be created.",
        );
      }
      if (insertMemberError?.code === "23505") {
        const { data: racedMembership } = await context.admin
          .from("team_members")
          .select("role")
          .eq("team_id", invitation.team_id)
          .eq("user_id", context.user.id)
          .maybeSingle();
        if (!racedMembership) {
          throw new HttpError(
            500,
            "MEMBERSHIP_CREATE_FAILED",
            "Your team membership could not be verified.",
          );
        }
        assignedRole = String(racedMembership.role);
      }
    }

    const { data: accepted, error: acceptError } = await context.admin
      .from("team_invitations")
      .update({ status: "accepted", accepted_at: new Date().toISOString() })
      .eq("id", invitation.id)
      .eq("status", "pending")
      .is("accepted_at", null)
      .select("id")
      .maybeSingle();

    if (acceptError || !accepted) {
      // Membership insert is idempotent. A retry can complete the invitation state transition.
      const { data: current } = await context.admin
        .from("team_invitations")
        .select("status,accepted_at")
        .eq("id", invitation.id)
        .maybeSingle();
      if (current?.status !== "accepted" || !current.accepted_at) {
        throw new HttpError(
          409,
          "INVITATION_ALREADY_USED",
          "This invitation has already been accepted or revoked.",
        );
      }
    }

    await writeAudit(
      context.admin,
      invitation.team_id,
      context.user.id,
      "team.invitation.accepted",
      {
        invitation_id: invitation.id,
      },
    );

    return jsonResponse(request, {
      ok: true,
      team_id: invitation.team_id,
      role: assignedRole,
    });
  } catch (error) {
    return handleError(request, error);
  }
});
